use crate::{
    config::Config,
    db::Database,
    error::{AppError, AppResult},
    filesystem,
    metrics::{MetricsCollector, SystemMetrics},
    models::{
        CreateProjectRequest, CreateSessionRequest, Project, SessionId, SessionSnapshot,
        UploadFileRequest,
    },
    protocol::{
        control_message, output_frame, parse_input, snapshot_frame, AttachMode, ClientMessage,
        ServerMessage,
    },
    security::WorkspacePolicy,
    supervisor::SessionSupervisor,
};
use axum::{
    extract::{
        ws::{Message, WebSocket},
        Path as AxumPath, Query, Request, State, WebSocketUpgrade,
    },
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::{get, patch, post},
    Json, Router,
};
use futures_util::StreamExt;
use serde::Deserialize;
use std::{collections::HashMap, path::PathBuf, sync::Arc, time::Duration};
use tokio::{
    fs,
    sync::{OwnedSemaphorePermit, Semaphore},
    time::{interval, timeout, MissedTickBehavior},
};
use tower_http::{
    limit::RequestBodyLimitLayer,
    services::{ServeDir, ServeFile},
};

const MAX_REQUEST_BYTES: usize = 96 * 1024 * 1024;
pub const MAX_IN_FLIGHT_REQUESTS: usize = 256;
pub const MAX_WEBSOCKET_CONNECTIONS: usize = 128;
const MAX_COMMAND_ARGS: usize = 128;
const MAX_COMMAND_BYTES: usize = 64 * 1024;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub db: Database,
    pub supervisor: SessionSupervisor,
    pub policy: WorkspacePolicy,
    pub metrics: Arc<MetricsCollector>,
    pub request_limit: Arc<Semaphore>,
    pub websocket_limit: Arc<Semaphore>,
}

pub fn router(state: AppState) -> Router {
    let static_dir = state.config.static_dir.clone();
    let assets = ServeDir::new(static_dir.join("assets")).append_index_html_on_directories(false);
    let fonts = ServeDir::new(static_dir.join("fonts"));
    let branding = ServeDir::new(static_dir.join("branding"));
    Router::new()
        .route("/healthz", get(health))
        .route("/api/auth", post(authenticate))
        .route("/api/projects", get(list_projects).post(create_project))
        .route(
            "/api/projects/{id}",
            patch(update_project).delete(delete_project),
        )
        .route("/api/terminals", get(list_terminals).post(create_terminal))
        .route("/api/sessions", get(list_terminals))
        .route(
            "/api/terminals/{id}",
            get(get_terminal)
                .patch(rename_terminal)
                .delete(delete_terminal_metadata),
        )
        .route("/api/terminals/{id}/terminate", post(terminate_terminal))
        .route("/api/terminals/{id}/restart", post(restart_terminal))
        .route("/api/files", get(list_files))
        .route("/api/files/content", get(read_file).put(write_file))
        .route("/api/files/upload", post(upload_file))
        .route("/api/settings", get(list_settings).put(set_setting))
        .route("/api/metrics", get(metrics))
        .route("/ws/terminal", get(upgrade_terminal))
        .route("/", get(index))
        .route_service(
            "/manifest.webmanifest",
            ServeFile::new(static_dir.join("manifest.webmanifest")),
        )
        .route_service(
            "/cliweb.webmanifest",
            ServeFile::new(static_dir.join("cliweb.webmanifest")),
        )
        .route_service(
            "/favicon.svg",
            ServeFile::new(static_dir.join("branding/cliweb-terminal.svg")),
        )
        .nest_service("/assets", assets)
        .nest_service("/fonts", fonts)
        .nest_service("/branding", branding)
        .with_state(state.clone())
        .layer(RequestBodyLimitLayer::new(MAX_REQUEST_BYTES))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            limit_requests,
        ))
        .layer(middleware::from_fn_with_state(state, authorize))
        .layer(middleware::from_fn(security_headers))
}

async fn health(State(state): State<AppState>) -> Response {
    match timeout(Duration::from_secs(2), state.db.ping()).await {
        Ok(Ok(())) => Json(
            serde_json::json!({ "status": "ok", "service": "projectclibox", "version": env!("CARGO_PKG_VERSION") }),
        )
            .into_response(),
        _ => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "status": "unhealthy",
                "service": "projectclibox",
                "code": "database_unavailable"
            })),
        )
            .into_response(),
    }
}

#[derive(Debug, Deserialize)]
struct AuthRequest {
    token: String,
}

async fn authenticate(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<AuthRequest>,
) -> Response {
    let Some(expected) = state.config.auth_token.as_deref() else {
        return StatusCode::NO_CONTENT.into_response();
    };
    if !constant_time_equal(body.token.as_bytes(), expected.as_bytes()) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({
                "error": "authentication required",
                "code": "unauthorized"
            })),
        )
            .into_response();
    }
    let secure = headers
        .get("x-forwarded-proto")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.eq_ignore_ascii_case("https"));
    let cookie = if secure {
        format!("projectclibox_auth={expected}; HttpOnly; SameSite=Strict; Path=/; Secure")
    } else {
        format!("projectclibox_auth={expected}; HttpOnly; SameSite=Strict; Path=/")
    };
    let mut response = StatusCode::NO_CONTENT.into_response();
    if let Ok(value) = HeaderValue::from_str(&cookie) {
        response.headers_mut().insert(header::SET_COOKIE, value);
    }
    response
}

async fn index(State(state): State<AppState>) -> impl IntoResponse {
    let path = state.config.static_dir.join("index.html");
    match fs::read_to_string(path).await {
        Ok(content) => Html(content).into_response(),
        Err(_) => Html(FALLBACK_INDEX).into_response(),
    }
}

async fn list_projects(State(state): State<AppState>) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(
        serde_json::json!({ "projects": state.db.list_projects().await? }),
    ))
}

async fn create_project(
    State(state): State<AppState>,
    Json(body): Json<CreateProjectRequest>,
) -> AppResult<(StatusCode, Json<Project>)> {
    let name = body.name.trim().to_owned();
    if name.is_empty() || name.len() > 120 {
        return Err(AppError::BadRequest(
            "project name must be 1–120 characters".to_owned(),
        ));
    }
    let path = state
        .policy
        .authorize_project_path(PathBuf::from(body.working_directory).as_path())?;
    let project = state
        .db
        .create_project(name, path.to_string_lossy().into_owned())
        .await?;
    Ok((StatusCode::CREATED, Json(project)))
}

async fn update_project(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Json(body): Json<CreateProjectRequest>,
) -> AppResult<Json<Project>> {
    let path = state
        .policy
        .authorize_project_path(PathBuf::from(body.working_directory).as_path())?;
    let project = state
        .db
        .update_project(
            id,
            body.name.trim().to_owned(),
            path.to_string_lossy().into_owned(),
            body.expanded,
        )
        .await?
        .ok_or_else(|| AppError::NotFound("project".to_owned()))?;
    Ok(Json(project))
}

async fn delete_project(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> AppResult<StatusCode> {
    if id == "uncategorized" {
        return Err(AppError::BadRequest(
            "the Uncategorized project cannot be deleted".to_owned(),
        ));
    }
    if !state.db.delete_project(id).await? {
        return Err(AppError::NotFound("project".to_owned()));
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn list_terminals(State(state): State<AppState>) -> AppResult<Json<Vec<SessionSnapshot>>> {
    let mut sessions = state.supervisor.list().await?;
    state.metrics.enrich_many(&mut sessions);
    Ok(Json(sessions))
}

async fn get_terminal(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> AppResult<Json<SessionSnapshot>> {
    let id = parse_session_id(&id)?;
    let mut snapshot = state.supervisor.get(id).await?;
    state.metrics.enrich(&mut snapshot);
    Ok(Json(snapshot))
}

async fn create_terminal(
    State(state): State<AppState>,
    Json(body): Json<CreateSessionRequest>,
) -> AppResult<(StatusCode, Json<SessionSnapshot>)> {
    let project = project_for_request(&state, body.project_id.clone()).await?;
    let cwd = requested_cwd(&state, &project, body.cwd.as_deref())?;
    let name = body
        .name
        .unwrap_or_else(|| format!("Terminal {}", &uuid::Uuid::new_v4().to_string()[..8]));
    let command = body
        .command
        .filter(|command| !command.is_empty())
        .or_else(|| {
            body.command_line
                .map(|line| vec![shell_path(), "-lc".to_owned(), line])
        })
        .unwrap_or_else(|| vec![shell_path(), "-i".to_owned()]);
    validate_command(&command)?;
    let snapshot = state
        .supervisor
        .create(
            name,
            (project.id != "uncategorized").then_some(project.id),
            &cwd,
            command,
            body.rows.unwrap_or(24),
            body.cols.unwrap_or(80),
        )
        .await?;
    Ok((StatusCode::CREATED, Json(snapshot)))
}

async fn terminate_terminal(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> AppResult<Json<SessionSnapshot>> {
    let id = parse_session_id(&id)?;
    let mut snapshot = state.supervisor.terminate(id).await?;
    state.metrics.enrich(&mut snapshot);
    Ok(Json(snapshot))
}

async fn restart_terminal(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> AppResult<(StatusCode, Json<SessionSnapshot>)> {
    let id = parse_session_id(&id)?;
    let snapshot = state.supervisor.restart(id).await?;
    Ok((StatusCode::CREATED, Json(snapshot)))
}

#[derive(Debug, Deserialize)]
struct RenameRequest {
    name: Option<String>,
    #[serde(rename = "newName")]
    new_name: Option<String>,
}

async fn rename_terminal(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Json(body): Json<RenameRequest>,
) -> AppResult<Json<SessionSnapshot>> {
    let id = parse_session_id(&id)?;
    let name = body
        .name
        .or(body.new_name)
        .ok_or_else(|| AppError::BadRequest("name is required".to_owned()))?;
    Ok(Json(state.supervisor.rename(id, name).await?))
}

async fn delete_terminal_metadata(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> AppResult<StatusCode> {
    state
        .supervisor
        .delete_metadata(parse_session_id(&id)?)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
struct FileQuery {
    #[serde(rename = "projectId")]
    project_id: Option<String>,
    path: Option<String>,
    cursor: Option<String>,
    limit: Option<usize>,
}

async fn list_files(
    State(state): State<AppState>,
    Query(query): Query<FileQuery>,
) -> AppResult<Json<filesystem::DirectoryPage>> {
    let project = project_for_request(&state, query.project_id).await?;
    let page = filesystem::list_directory(
        &state.policy,
        &project,
        query.path.as_deref(),
        query.cursor.as_deref(),
        query.limit.unwrap_or(state.config.directory_limit),
    )
    .await?;
    Ok(Json(page))
}

#[derive(Debug, Deserialize)]
struct FileContentQuery {
    #[serde(rename = "projectId")]
    project_id: Option<String>,
    path: String,
}

async fn read_file(
    State(state): State<AppState>,
    Query(query): Query<FileContentQuery>,
) -> AppResult<Json<filesystem::FileContent>> {
    let project = project_for_request(&state, query.project_id).await?;
    Ok(Json(
        filesystem::read_file(
            &state.policy,
            &project,
            &query.path,
            state.config.max_file_bytes,
        )
        .await?,
    ))
}

#[derive(Debug, Deserialize)]
struct WriteFileRequest {
    #[serde(rename = "projectId")]
    project_id: Option<String>,
    path: String,
    content: String,
}

async fn write_file(
    State(state): State<AppState>,
    Json(body): Json<WriteFileRequest>,
) -> AppResult<Json<serde_json::Value>> {
    let project = project_for_request(&state, body.project_id).await?;
    let size = filesystem::write_file(
        &state.policy,
        &project,
        &body.path,
        body.content,
        state.config.max_file_bytes,
    )
    .await?;
    Ok(Json(serde_json::json!({ "success": true, "size": size })))
}

async fn upload_file(
    State(state): State<AppState>,
    Json(body): Json<UploadFileRequest>,
) -> AppResult<Json<serde_json::Value>> {
    use base64::Engine;

    let project = project_for_request(&state, body.project_id).await?;
    let max_encoded_bytes = state.config.max_file_bytes.div_ceil(3).saturating_mul(4);
    if body.data.len() as u64 > max_encoded_bytes {
        return Err(AppError::BadRequest(format!(
            "base64 payload exceeds the {max_encoded_bytes}-byte encoded limit"
        )));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(body.data)
        .map_err(|_| AppError::BadRequest("data must be valid standard base64".to_owned()))?;
    let size = filesystem::write_bytes(
        &state.policy,
        &project,
        &body.path,
        bytes,
        state.config.max_file_bytes,
    )
    .await?;
    let absolute_path = state
        .policy
        .project_root(&project)?
        .join(&body.path)
        .to_string_lossy()
        .into_owned();
    Ok(Json(serde_json::json!({
        "success": true,
        "path": absolute_path,
        "relative_path": body.path,
        "size": size
    })))
}

async fn list_settings(State(state): State<AppState>) -> AppResult<Json<HashMap<String, String>>> {
    Ok(Json(state.db.list_settings().await?.into_iter().collect()))
}

#[derive(Debug, Deserialize)]
struct SettingRequest {
    key: String,
    value: String,
}

async fn set_setting(
    State(state): State<AppState>,
    Json(body): Json<SettingRequest>,
) -> AppResult<StatusCode> {
    if body.key.is_empty() || body.key.len() > 80 || body.value.len() > 10_000 {
        return Err(AppError::BadRequest("invalid setting size".to_owned()));
    }
    state.db.set_setting(body.key, body.value).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn metrics(State(state): State<AppState>) -> AppResult<Json<serde_json::Value>> {
    let sessions = state.supervisor.list().await?;
    let mut enriched = sessions.clone();
    state.metrics.enrich_many(&mut enriched);
    let system = SystemMetrics::collect();
    Ok(Json(serde_json::json!({
        "system": system,
        "service": { "pid": std::process::id() },
        "sessions": enriched,
    })))
}

async fn upgrade_terminal(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    let permit = match state.websocket_limit.clone().try_acquire_owned() {
        Ok(permit) => permit,
        Err(_) => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "error": "WebSocket capacity is currently exhausted",
                    "code": "websocket_capacity"
                })),
            )
                .into_response();
        }
    };
    ws.max_frame_size(256 * 1024)
        .on_upgrade(move |socket| handle_socket(socket, state, permit))
        .into_response()
}

async fn handle_socket(mut socket: WebSocket, state: AppState, _permit: OwnedSemaphorePermit) {
    let first = match timeout(Duration::from_secs(10), socket.next()).await {
        Ok(Some(Ok(message))) => message,
        _ => return,
    };
    let message = match parse_input(first) {
        Ok(Some(message)) => message,
        _ => {
            let _ = send_error(
                &mut socket,
                "invalid_message",
                "the first WebSocket message must attach a session",
            )
            .await;
            return;
        }
    };
    let ClientMessage::Attach {
        session_id,
        mode,
        from_sequence,
        cols,
        rows,
    } = message
    else {
        let _ = send_error(
            &mut socket,
            "attach_required",
            "attach before sending terminal input",
        )
        .await;
        return;
    };
    let from_sequence = from_sequence.unwrap_or(0);
    let mode = mode.unwrap_or(if from_sequence == 0 {
        AttachMode::Snapshot
    } else {
        AttachMode::Resume
    });
    let requested_size = cols.zip(rows);
    let (handle, mut attached) =
        match state
            .supervisor
            .attach(session_id, mode, from_sequence, requested_size)
        {
            Ok(value) => value,
            Err(error) => {
                let _ = send_error(&mut socket, "attach_failed", &error.to_string()).await;
                return;
            }
        };
    let mut last_sequence = attached.sequence;
    let snapshot = handle.snapshot();
    let ready = ServerMessage::Ready {
        session_id,
        mode: attached.mode,
        sequence: attached.sequence,
        replayed_through: attached.replay.replayed_through,
        truncated: attached.replay.truncated,
        snapshot: &snapshot,
    };
    if let Ok(message) = control_message(&ready) {
        if socket.send(message).await.is_err() {
            handle.detach(attached.viewer_id);
            return;
        }
    }
    if let Some(snapshot_bytes) = attached.snapshot.take() {
        let snapshot_control = ServerMessage::Snapshot {
            session_id,
            sequence: snapshot_bytes.sequence,
            replace: true,
            bytes: snapshot_bytes.bytes.len(),
        };
        if let Ok(message) = control_message(&snapshot_control) {
            if socket.send(message).await.is_err() {
                handle.detach(attached.viewer_id);
                return;
            }
        }
        if socket
            .send(Message::Binary(snapshot_frame(
                snapshot_bytes.sequence,
                &snapshot_bytes.bytes,
            )))
            .await
            .is_err()
        {
            handle.detach(attached.viewer_id);
            return;
        }
    }
    for chunk in attached.replay.chunks {
        if chunk.sequence > last_sequence && !chunk.data.is_empty() {
            if socket
                .send(Message::Binary(output_frame(chunk.sequence, &chunk.data)))
                .await
                .is_err()
            {
                handle.detach(attached.viewer_id);
                return;
            }
            last_sequence = chunk.sequence;
        }
    }
    last_sequence = last_sequence.max(attached.replay.replayed_through);
    let mut receiver = attached.receiver;
    let mut status_receiver = handle.subscribe_status();
    let mut heartbeat = interval(Duration::from_secs(20));
    heartbeat.set_missed_tick_behavior(MissedTickBehavior::Skip);
    // Do not immediately emit the first interval tick.
    heartbeat.tick().await;
    loop {
        tokio::select! {
            maybe_message = socket.next() => {
                let Some(result) = maybe_message else { break; };
                let Ok(message) = result else { break; };
                let parsed = match parse_input(message) {
                    Ok(value) => value,
                    Err(error) => { let _ = send_error(&mut socket, "invalid_message", &error.to_string()).await; continue; }
                };
                let Some(message) = parsed else { continue; };
                match message {
                    ClientMessage::Input { data } => {
                        if let Err(error) = handle.write_input(data) { let _ = send_error(&mut socket, "input_rejected", &error.to_string()).await; }
                    }
                    ClientMessage::Resize { cols, rows } => {
                        if let Err(error) = handle.resize(attached.viewer_id, cols, rows) { let _ = send_error(&mut socket, "resize_rejected", &error.to_string()).await; }
                    }
                    ClientMessage::Ping { nonce } => {
                        let message = ServerMessage::Pong { nonce };
                        if let Ok(message) = control_message(&message) { if socket.send(message).await.is_err() { break; } }
                    }
                    ClientMessage::Detach => break,
                    ClientMessage::Attach { .. } => { let _ = send_error(&mut socket, "already_attached", "open a new socket to attach another viewer").await; }
                }
            }
            output = receiver.recv() => {
                match output {
                    Ok(chunk) => {
                        if chunk.sequence <= last_sequence || chunk.data.is_empty() { continue; }
                        if socket.send(Message::Binary(output_frame(chunk.sequence, &chunk.data))).await.is_err() { break; }
                        last_sequence = chunk.sequence;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        // A lagged receiver no longer falls back to raw PTY
                        // history. The client reconnects with a fresh
                        // authoritative snapshot, then resumes deltas.
                        let gap = ServerMessage::Gap { last_sequence, resync_required: true };
                        if let Ok(message) = control_message(&gap) { let _ = socket.send(message).await; }
                        break;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            status = status_receiver.changed() => {
                if status.is_err() { break; }
                let snapshot = status_receiver.borrow().clone();
                let finished = snapshot.status.is_finished();
                let message = ServerMessage::State { snapshot: &snapshot };
                if let Ok(message) = control_message(&message) { if socket.send(message).await.is_err() { break; } }
                if finished {
                    let exit = ServerMessage::Exit { code: snapshot.exit_code, signal: snapshot.exit_signal };
                    if let Ok(message) = control_message(&exit) { let _ = socket.send(message).await; }
                    break;
                }
            }
            _ = heartbeat.tick() => {
                if socket.send(Message::Ping(Vec::new().into())).await.is_err() { break; }
            }
        }
    }
    handle.detach(attached.viewer_id);
    tracing::debug!(session_id = %session_id, viewers = handle.snapshot().attached_viewers, "viewer detached");
}

async fn send_error(
    socket: &mut WebSocket,
    code: &'static str,
    message: &str,
) -> Result<(), axum::Error> {
    let response = ServerMessage::Error { code, message };
    let message = control_message(&response).map_err(axum::Error::new)?;
    socket.send(message).await
}

async fn project_for_request(state: &AppState, id: Option<String>) -> AppResult<Project> {
    let id = id.unwrap_or_else(|| "uncategorized".to_owned());
    state
        .db
        .get_project(id)
        .await?
        .ok_or_else(|| AppError::NotFound("project".to_owned()))
}

fn requested_cwd(
    state: &AppState,
    project: &Project,
    requested: Option<&str>,
) -> AppResult<PathBuf> {
    match requested {
        None => state.policy.project_root(project),
        Some("") => state.policy.project_root(project),
        Some(value) if PathBuf::from(value).is_absolute() => {
            let path = state
                .policy
                .authorize_project_path(PathBuf::from(value).as_path())?;
            let project_root = state.policy.project_root(project)?;
            if !path.starts_with(&project_root) {
                return Err(AppError::Forbidden(
                    "terminal cwd must stay inside its project root".to_owned(),
                ));
            }
            Ok(path)
        }
        Some(value) => {
            let (path, _) = state.policy.resolve_existing(project, Some(value))?;
            Ok(path)
        }
    }
}

fn parse_session_id(value: &str) -> AppResult<SessionId> {
    value
        .parse()
        .map_err(|_| AppError::BadRequest("invalid session id".to_owned()))
}

fn shell_path() -> String {
    std::env::var("SHELL")
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "/bin/bash".to_owned())
}

async fn authorize(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let path = request.uri().path();
    let public_bootstrap = path == "/"
        || path == "/healthz"
        || path == "/api/auth"
        || path == "/favicon.svg"
        || path == "/manifest.webmanifest"
        || path == "/cliweb.webmanifest"
        || path.starts_with("/assets/")
        || path.starts_with("/fonts/")
        || path.starts_with("/branding/");
    if public_bootstrap {
        return next.run(request).await;
    }
    if let Some(token) = &state.config.auth_token {
        let supplied = request
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
            .or_else(|| cookie_value(request.headers(), "projectclibox_auth"));
        if supplied.is_none_or(|value| !constant_time_equal(value.as_bytes(), token.as_bytes())) {
            return (
                StatusCode::UNAUTHORIZED,
                Json(
                    serde_json::json!({"error": "authentication required", "code": "unauthorized"}),
                ),
            )
                .into_response();
        }
    }
    let origin_check_required = path == "/ws/terminal"
        || !matches!(
            *request.method(),
            Method::GET | Method::HEAD | Method::OPTIONS
        );
    if origin_check_required {
        if let Some(origin) = request
            .headers()
            .get(header::ORIGIN)
            .and_then(|value| value.to_str().ok())
        {
            let host = request
                .headers()
                .get(header::HOST)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("");
            if !origin_is_allowed(origin, host) {
                return (StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "origin is not allowed", "code": "csrf_origin"}))).into_response();
            }
        }
    }
    next.run(request).await
}

async fn security_headers(request: Request, next: Next) -> Response {
    let is_hashed_asset = request.uri().path().starts_with("/assets/");
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert("x-frame-options", HeaderValue::from_static("DENY"));
    headers.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    headers.insert(
        "permissions-policy",
        HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
    );
    headers.insert(
        "content-security-policy",
        HeaderValue::from_static(
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        ),
    );
    if is_hashed_asset {
        headers.insert(
            "cache-control",
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        );
    } else {
        headers.insert("cache-control", HeaderValue::from_static("no-store"));
    }
    response
}

async fn limit_requests(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let permit = match state.request_limit.clone().acquire_owned().await {
        Ok(permit) => permit,
        Err(_) => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "error": "request capacity is unavailable",
                    "code": "capacity_unavailable"
                })),
            )
                .into_response();
        }
    };
    let response = next.run(request).await;
    drop(permit);
    response
}

fn cookie_value<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|part| {
            let (key, value) = part.trim().split_once('=')?;
            (key == name).then_some(value)
        })
}

fn origin_is_allowed(origin: &str, host: &str) -> bool {
    origin == format!("http://{host}") || origin == format!("https://{host}")
}

fn validate_command(command: &[String]) -> AppResult<()> {
    if command.len() > MAX_COMMAND_ARGS
        || command
            .iter()
            .map(String::len)
            .sum::<usize>()
            .saturating_add(command.len())
            > MAX_COMMAND_BYTES
    {
        return Err(AppError::BadRequest(format!(
            "command must contain at most {MAX_COMMAND_ARGS} arguments and {MAX_COMMAND_BYTES} bytes"
        )));
    }
    Ok(())
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

const FALLBACK_INDEX: &str = r#"<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ProjectCliBox</title></head><body><main><h1>ProjectCliBox</h1><p>Build the frontend with <code>npm run build:web</code>.</p></main></body></html>"#;
