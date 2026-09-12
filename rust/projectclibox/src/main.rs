mod api;
mod config;
mod db;
mod error;
mod filesystem;
mod metrics;
mod models;
mod protocol;
mod scrollback;
mod security;
mod session;
mod supervisor;

use clap::{Parser, Subcommand};
use config::{Config, RuntimeArgs};
use error::{AppError, AppResult};
use std::{future::IntoFuture, sync::Arc};
use tokio::net::TcpListener;
use tokio::time::{sleep, timeout, Duration};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Debug, Parser)]
#[command(
    name = "projectclibox",
    version,
    about = "A durable Rust terminal runtime with a browser workspace"
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Run the HTTP/WebSocket control plane and its in-process session supervisor.
    Server(RuntimeArgs),
    /// Run the session supervisor as a local-only daemon endpoint.
    Sessiond(RuntimeArgs),
}

#[tokio::main]
async fn main() -> Result<(), AppError> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "projectclibox=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer().with_target(false))
        .init();

    let cli = Cli::parse();
    let (args, sessiond) = match cli.command {
        Some(Command::Server(args)) => (args, false),
        Some(Command::Sessiond(args)) => (args, true),
        None => (RuntimeArgs::from_environment(), false),
    };
    let config = Arc::new(Config::from_args(&args)?);
    // The parsed token remains in `Config`, but should not remain in the
    // process environment where same-user terminal children could inspect it.
    if config.auth_token.is_some() {
        std::env::remove_var("PROJECTCLIBOX_AUTH_TOKEN");
    }
    let db = db::Database::open(&config.db_path, &config.workspace_root)?;
    let supervisor = supervisor::SessionSupervisor::new(config.clone(), db.clone()).await?;
    let policy = security::WorkspacePolicy::new(config.workspace_root.clone());
    let state = api::AppState {
        config: config.clone(),
        db,
        supervisor: supervisor.clone(),
        policy,
        metrics: Arc::new(metrics::MetricsCollector::new()),
        request_limit: Arc::new(tokio::sync::Semaphore::new(api::MAX_IN_FLIGHT_REQUESTS)),
        websocket_limit: Arc::new(tokio::sync::Semaphore::new(api::MAX_WEBSOCKET_CONNECTIONS)),
    };

    if sessiond {
        tracing::warn!("sessiond currently runs the supervisor in a local control-plane process; use the server command for browser HTTP/WS access");
    }
    run_server(state).await
}

async fn run_server(state: api::AppState) -> AppResult<()> {
    let listener = TcpListener::bind(state.config.address)
        .await
        .map_err(|error| AppError::Config(format!("bind {}: {error}", state.config.address)))?;
    tracing::info!(address = %state.config.address, workspace = %state.config.workspace_root.display(), "ProjectCliBox v2 ready");
    let server = axum::serve(listener, api::router(state.clone()))
        .with_graceful_shutdown(shutdown_signal(state.supervisor.clone()))
        .into_future();
    tokio::pin!(server);
    let watchdog = database_watchdog(state.db.clone());
    tokio::pin!(watchdog);
    let result = tokio::select! {
        result = &mut server => result.map_err(|_error| AppError::Internal),
        result = &mut watchdog => result,
    };
    state.supervisor.shutdown().await;
    result
}

const DATABASE_WATCHDOG_INTERVAL: Duration = Duration::from_secs(10);
const DATABASE_WATCHDOG_FAILURES: u32 = 3;

async fn database_watchdog(db: db::Database) -> AppResult<()> {
    let mut failures = 0;
    loop {
        sleep(DATABASE_WATCHDOG_INTERVAL).await;
        match timeout(Duration::from_secs(2), db.ping()).await {
            Ok(Ok(())) => failures = 0,
            Ok(Err(error)) => {
                failures += 1;
                tracing::error!(
                    error = %error,
                    failures,
                    "database watchdog probe failed"
                );
            }
            Err(_) => {
                failures += 1;
                tracing::error!(failures, "database watchdog probe timed out");
            }
        }
        if failures >= DATABASE_WATCHDOG_FAILURES {
            return Err(AppError::Database(
                "database health remained degraded; exiting for supervisor restart".to_owned(),
            ));
        }
    }
}

async fn shutdown_signal(supervisor: supervisor::SessionSupervisor) {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut terminate = match signal(SignalKind::terminate()) {
            Ok(signal) => signal,
            Err(error) => {
                tracing::warn!(error = %error, "SIGTERM handler unavailable; waiting for Ctrl-C");
                let _ = tokio::signal::ctrl_c().await;
                supervisor.shutdown().await;
                return;
            }
        };
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = terminate.recv() => {}
        }
    }
    #[cfg(not(unix))]
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutdown requested; terminating managed process groups");
    supervisor.shutdown().await;
}
