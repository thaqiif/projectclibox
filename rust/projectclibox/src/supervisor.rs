use crate::{
    config::Config,
    db::Database,
    error::{AppError, AppResult},
    models::{SessionId, SessionRecord, SessionSnapshot, SessionStatus},
    protocol::AttachMode,
    session::{
        snapshot_from_record, stop_marked_process_groups, stop_recorded_process_group,
        AttachedSession, SessionHandle, SessionSpawnOptions,
    },
};
use chrono::Utc;
use std::{
    collections::{HashMap, HashSet},
    path::Path,
    sync::{Arc, RwLock},
};
use tokio::sync::Mutex as AsyncMutex;
use tokio::time::{sleep, Duration};

const MAX_LIVE_SESSIONS: usize = 64;

#[derive(Clone)]
pub struct SessionSupervisor {
    config: Arc<Config>,
    db: Database,
    sessions: Arc<RwLock<HashMap<SessionId, SessionHandle>>>,
    records: Arc<RwLock<HashMap<SessionId, SessionRecord>>>,
    deleted: Arc<RwLock<HashSet<SessionId>>>,
    create_gate: Arc<AsyncMutex<()>>,
    lifecycle_gate: Arc<AsyncMutex<()>>,
}

impl SessionSupervisor {
    pub async fn new(config: Arc<Config>, db: Database) -> AppResult<Self> {
        // A crash can occur after a PTY is spawned but before its PID/PGID is
        // written to SQLite. Session children carry this exact DB-path marker
        // so the next boot can find and terminate those orphan groups too.
        stop_marked_process_groups(&config.db_path);
        let persisted = db.list_sessions().await?;
        let mut records = HashMap::new();
        for mut record in persisted {
            // The in-process server deliberately does not pretend to restore
            // a PTY after a process restart. Persisted "running" rows become
            // exited metadata and can be restarted explicitly. Browser close
            // and refresh never reach this path: the live handle remains in
            // this supervisor.
            if record.status.is_live() {
                stop_recorded_process_group(record.process_group, record.id);
                record.status = SessionStatus::Exited;
                record.ended_at.get_or_insert_with(Utc::now);
                record.child_pid = None;
                record.process_group = None;
                db.upsert_session(record.clone()).await?;
            } else if record.status.is_finished()
                && (record.child_pid.is_some() || record.process_group.is_some())
            {
                record.child_pid = None;
                record.process_group = None;
                db.upsert_session(record.clone()).await?;
            }
            records.insert(record.id, record);
        }
        Ok(Self {
            config,
            db,
            sessions: Arc::new(RwLock::new(HashMap::new())),
            records: Arc::new(RwLock::new(records)),
            deleted: Arc::new(RwLock::new(HashSet::new())),
            create_gate: Arc::new(AsyncMutex::new(())),
            lifecycle_gate: Arc::new(AsyncMutex::new(())),
        })
    }

    pub async fn create(
        &self,
        name: String,
        project_id: Option<String>,
        cwd: &Path,
        command: Vec<String>,
        rows: u16,
        cols: u16,
    ) -> AppResult<SessionSnapshot> {
        let name = validate_session_name(&name)?;
        // Serialize the check/reserve/spawn sequence so concurrent requests
        // cannot exceed the live-session cap or claim the same name.
        let _create_guard = self.create_gate.lock().await;
        let (live_sessions, duplicate_name) = {
            let records = self.records.read().expect("records lock");
            let live_sessions = records
                .values()
                .filter(|record| record.status.is_live())
                .count();
            let duplicate_name = records.values().any(|record| {
                record.name == name
                    && matches!(
                        record.status,
                        SessionStatus::Starting | SessionStatus::Running | SessionStatus::Idle
                    )
            });
            (live_sessions, duplicate_name)
        };
        if duplicate_name {
            return Err(AppError::Conflict(format!(
                "a live session named '{name}' already exists"
            )));
        }
        if live_sessions >= MAX_LIVE_SESSIONS {
            return Err(AppError::Conflict(format!(
                "the live session limit ({MAX_LIVE_SESSIONS}) has been reached"
            )));
        }
        let id = SessionId::new();
        let now = Utc::now();
        let starting_record = SessionRecord {
            id,
            name: name.clone(),
            project_id: project_id.clone(),
            working_directory: cwd.to_string_lossy().into_owned(),
            command: command.clone(),
            status: SessionStatus::Starting,
            child_pid: None,
            process_group: None,
            rows,
            cols,
            created_at: now,
            started_at: None,
            ended_at: None,
            last_activity_at: now,
            last_attached_at: None,
            exit_code: None,
            exit_signal: None,
            output_bytes: 0,
        };
        // Reserve the session before spawning. If the process is killed in
        // this window, the next boot sees the Starting row and closes it
        // without having to guess at an unrecorded process group.
        self.db.upsert_session(starting_record.clone()).await?;
        let handle = match SessionHandle::spawn(SessionSpawnOptions {
            id,
            name,
            project_id,
            cwd,
            runtime_marker: &self.config.db_path,
            command,
            rows,
            cols,
            max_scrollback_bytes: self.config.scrollback_bytes,
            idle_after_secs: self.config.idle_after_secs,
        }) {
            Ok(handle) => handle,
            Err(error) => {
                let mut failed = starting_record;
                failed.status = SessionStatus::Failed;
                failed.ended_at = Some(Utc::now());
                if let Err(persist_error) = self.db.upsert_session(failed).await {
                    tracing::error!(
                        error = %persist_error,
                        "failed to persist session spawn failure"
                    );
                }
                return Err(error);
            }
        };
        let snapshot = handle.snapshot();
        // If the post-spawn update fails, terminate the freshly-created PTY
        // before returning the database error. The reserved Starting row is
        // still safe to reconcile on the next boot.
        if let Err(error) = self.db.upsert_session(handle.record()).await {
            let _ = handle.terminate();
            return Err(error);
        }
        self.records
            .write()
            .expect("records lock")
            .insert(id, handle.record());
        self.sessions
            .write()
            .expect("sessions lock")
            .insert(id, handle.clone());
        self.watch(handle.clone());
        tracing::info!(session_id = %id, name = %handle.name(), "session created");
        Ok(snapshot)
    }

    pub async fn list(&self) -> AppResult<Vec<SessionSnapshot>> {
        let records = self.records.read().expect("records lock").clone();
        let sessions = self.sessions.read().expect("sessions lock").clone();
        let mut result = records
            .values()
            .map(|record| snapshot_from_record(record, 0, 0, false, self.config.idle_after_secs))
            .collect::<Vec<_>>();
        for (id, session) in sessions {
            if let Some(item) = result.iter_mut().find(|item| item.id == id) {
                *item = session.snapshot();
            }
        }
        result.sort_by(|left, right| left.created_at.cmp(&right.created_at));
        Ok(result)
    }

    pub async fn get(&self, id: SessionId) -> AppResult<SessionSnapshot> {
        let live_session = {
            let sessions = self.sessions.read().expect("sessions lock");
            sessions.get(&id).cloned()
        };
        if let Some(session) = live_session {
            return Ok(session.snapshot());
        }
        let record = self
            .records
            .read()
            .expect("records lock")
            .get(&id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("session {id}")))?;
        Ok(snapshot_from_record(
            &record,
            0,
            0,
            false,
            self.config.idle_after_secs,
        ))
    }

    pub fn handle(&self, id: SessionId) -> AppResult<SessionHandle> {
        self.sessions
            .read()
            .expect("sessions lock")
            .get(&id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("live session {id}")))
    }

    pub fn attach(
        &self,
        id: SessionId,
        mode: AttachMode,
        from_sequence: u64,
        requested_size: Option<(u16, u16)>,
    ) -> AppResult<(SessionHandle, AttachedSession)> {
        let handle = self.handle(id)?;
        let attached = handle.attach(mode, from_sequence, requested_size)?;
        tracing::debug!(session_id = %id, viewers = attached_viewers(&handle), "viewer attached");
        Ok((handle, attached))
    }

    pub async fn terminate(&self, id: SessionId) -> AppResult<SessionSnapshot> {
        let handle = self.handle(id)?;
        handle.terminate()?;
        tracing::info!(session_id = %id, "session termination requested");
        Ok(handle.snapshot())
    }

    pub async fn restart(&self, id: SessionId) -> AppResult<SessionSnapshot> {
        let record = self
            .records
            .read()
            .expect("records lock")
            .get(&id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("session {id}")))?;
        let live_session = {
            let sessions = self.sessions.read().expect("sessions lock");
            sessions.get(&id).cloned()
        };
        if let Some(session) = live_session {
            session.terminate()?;
            drop(session);
            let mut final_record = None;
            let mut stopped = false;
            for _ in 0..200 {
                let state = {
                    let sessions = self.sessions.read().expect("sessions lock");
                    sessions.get(&id).map(|session| {
                        (
                            session.is_live(),
                            session.cleanup_pending(),
                            session.record(),
                        )
                    })
                };
                match state {
                    None => {
                        stopped = true;
                        break;
                    }
                    Some((is_live, cleanup_pending, record)) => {
                        final_record = Some(record);
                        if !is_live && !cleanup_pending {
                            stopped = true;
                            break;
                        }
                    }
                }
                sleep(Duration::from_millis(50)).await;
            }
            if !stopped {
                return Err(AppError::Conflict(
                    "the existing session is still terminating; retry the restart".to_owned(),
                ));
            }
            // The persistence watcher may not have observed the terminal
            // transition yet. Refresh the in-memory record before the create
            // path checks the name and live-session cap.
            if let Some(record) = final_record {
                self.records
                    .write()
                    .expect("records lock")
                    .insert(id, record);
            }
            self.sessions.write().expect("sessions lock").remove(&id);
        }
        let working_directory = Path::new(&record.working_directory)
            .canonicalize()
            .map_err(|error| {
                AppError::Forbidden(format!(
                    "session working directory is not accessible: {error}"
                ))
            })?;
        if !working_directory.starts_with(&self.config.workspace_root)
            || !working_directory.is_dir()
        {
            return Err(AppError::Forbidden(
                "session working directory is outside the authorized workspace root".to_owned(),
            ));
        }
        self.create(
            record.name,
            record.project_id,
            &working_directory,
            record.command,
            record.rows,
            record.cols,
        )
        .await
    }

    pub async fn rename(&self, id: SessionId, name: String) -> AppResult<SessionSnapshot> {
        let name = validate_session_name(&name)?;
        if self
            .records
            .read()
            .expect("records lock")
            .iter()
            .any(|(other_id, record)| {
                *other_id != id && record.name == name && record.status.is_live()
            })
        {
            return Err(AppError::Conflict(format!(
                "a live session named '{name}' already exists"
            )));
        }
        if let Ok(handle) = self.handle(id) {
            handle.rename(name);
            self.records
                .write()
                .expect("records lock")
                .insert(id, handle.record());
            return Ok(handle.snapshot());
        }
        let mut record = self
            .records
            .write()
            .expect("records lock")
            .get(&id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("session {id}")))?;
        record.name = name;
        self.records
            .write()
            .expect("records lock")
            .insert(id, record.clone());
        self.db.upsert_session(record.clone()).await?;
        Ok(snapshot_from_record(
            &record,
            0,
            0,
            false,
            self.config.idle_after_secs,
        ))
    }

    pub async fn delete_metadata(&self, id: SessionId) -> AppResult<()> {
        // Serialize deletion with the watcher's SQLite upsert. Once the
        // tombstone is set, the watcher may finish killing the PTY but it can
        // never recreate the deleted row.
        let _lifecycle_guard = self.lifecycle_gate.lock().await;
        let handle = {
            self.sessions
                .read()
                .expect("sessions lock")
                .get(&id)
                .cloned()
        };
        if let Some(ref handle) = handle {
            self.deleted
                .write()
                .expect("deleted sessions lock")
                .insert(id);
            if handle.is_live() && !handle.termination_requested() {
                // DELETE is the terminal's destructive operation. It must be
                // sufficient on its own, including for a terminal that is
                // still running when the request arrives. PTY cleanup
                // continues in the background after this HTTP request.
                handle.terminate()?;
            }
        }
        // DELETE is intentionally idempotent. A stale browser list, a second
        // click, or two close-all requests may race with the first deletion;
        // once the row is gone, the requested end state is already true.
        self.db.delete_session(id).await?;
        self.sessions.write().expect("sessions lock").remove(&id);
        self.records.write().expect("records lock").remove(&id);
        Ok(())
    }

    pub async fn shutdown(&self) {
        let sessions = self
            .sessions
            .read()
            .expect("sessions lock")
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for session in sessions {
            let _ = session.terminate();
        }
        for _ in 0..60 {
            if self
                .sessions
                .read()
                .expect("sessions lock")
                .values()
                .all(|session| !session.is_live() && !session.cleanup_pending())
            {
                return;
            }
            sleep(Duration::from_millis(50)).await;
        }
        tracing::warn!("shutdown grace period elapsed; process groups may still be stopping");
    }

    fn watch(&self, handle: SessionHandle) {
        let db = self.db.clone();
        let records = self.records.clone();
        let sessions = self.sessions.clone();
        let deleted = self.deleted.clone();
        let lifecycle_gate = self.lifecycle_gate.clone();
        tokio::spawn(async move {
            let mut receiver = handle.subscribe_status();
            loop {
                let record = handle.record();
                let finished = record.status.is_finished();
                let is_deleted = deleted
                    .read()
                    .expect("deleted sessions lock")
                    .contains(&record.id);
                if !is_deleted {
                    records
                        .write()
                        .expect("records lock")
                        .insert(record.id, record.clone());
                    persist_session_until_available(&db, record, &deleted, &lifecycle_gate).await;
                }
                if finished {
                    while handle.cleanup_pending() {
                        sleep(Duration::from_millis(50)).await;
                    }
                    sessions
                        .write()
                        .expect("sessions lock")
                        .remove(&handle.id());
                    if is_deleted {
                        records.write().expect("records lock").remove(&handle.id());
                        deleted
                            .write()
                            .expect("deleted sessions lock")
                            .remove(&handle.id());
                    }
                    break;
                }
                if receiver.changed().await.is_err() {
                    break;
                }
            }
        });
    }
}

async fn persist_session_until_available(
    db: &Database,
    record: SessionRecord,
    deleted: &Arc<RwLock<HashSet<SessionId>>>,
    lifecycle_gate: &Arc<AsyncMutex<()>>,
) {
    let mut delay = Duration::from_millis(100);
    loop {
        let _lifecycle_guard = lifecycle_gate.lock().await;
        if deleted
            .read()
            .expect("deleted sessions lock")
            .contains(&record.id)
        {
            return;
        }
        match db.upsert_session(record.clone()).await {
            Ok(()) => return,
            Err(error) => {
                tracing::error!(
                    error = %error,
                    retry_in_ms = delay.as_millis(),
                    "persist session state failed; retrying"
                );
                drop(_lifecycle_guard);
                sleep(delay).await;
                delay = (delay * 2).min(Duration::from_secs(5));
            }
        }
    }
}

fn attached_viewers(handle: &SessionHandle) -> usize {
    handle.snapshot().attached_viewers
}

pub fn validate_session_name(name: &str) -> AppResult<String> {
    let normalized = name.trim();
    if normalized.is_empty() || normalized.len() > 80 {
        return Err(AppError::BadRequest(
            "session name must be 1–80 characters".to_owned(),
        ));
    }
    if normalized
        .chars()
        .any(|character| character.is_control() || matches!(character, '/' | '\\'))
    {
        return Err(AppError::BadRequest(
            "session name contains an invalid character".to_owned(),
        ));
    }
    Ok(normalized.to_owned())
}

#[cfg(test)]
mod tests {
    use super::validate_session_name;

    #[test]
    fn rejects_control_and_path_separator_names() {
        assert!(validate_session_name("bad\nname").is_err());
        assert!(validate_session_name("../etc").is_err());
        assert_eq!(validate_session_name(" Backend ").expect("name"), "Backend");
    }
}
