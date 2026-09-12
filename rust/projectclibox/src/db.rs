use crate::{
    error::{AppError, AppResult},
    models::{Project, SessionId, SessionRecord, SessionStatus},
};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tokio::sync::{mpsc, oneshot};
use uuid::Uuid;

#[derive(Clone)]
pub struct Database {
    sender: mpsc::Sender<DbCommand>,
    persistence_healthy: Arc<AtomicBool>,
}

enum DbCommand {
    Ping {
        reply: oneshot::Sender<Result<(), String>>,
    },
    ListProjects {
        reply: oneshot::Sender<Result<Vec<Project>, String>>,
    },
    GetProject {
        id: String,
        reply: oneshot::Sender<Result<Option<Project>, String>>,
    },
    CreateProject {
        id: String,
        name: String,
        working_directory: String,
        reply: oneshot::Sender<Result<Project, String>>,
    },
    UpdateProject {
        id: String,
        name: String,
        working_directory: String,
        reply: oneshot::Sender<Result<Option<Project>, String>>,
    },
    DeleteProject {
        id: String,
        reply: oneshot::Sender<Result<bool, String>>,
    },
    ListSessions {
        reply: oneshot::Sender<Result<Vec<SessionRecord>, String>>,
    },
    UpsertSession {
        session: SessionRecord,
        reply: oneshot::Sender<Result<(), String>>,
    },
    DeleteSession {
        id: SessionId,
        reply: oneshot::Sender<Result<bool, String>>,
    },
    SetSetting {
        key: String,
        value: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    ListSettings {
        reply: oneshot::Sender<Result<Vec<(String, String)>, String>>,
    },
}

impl Database {
    pub fn open(path: impl AsRef<Path>, workspace_root: &Path) -> AppResult<Self> {
        let path = path.as_ref().to_owned();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                AppError::Database(format!("create database directory: {error}"))
            })?;
        }
        let root = workspace_root.to_string_lossy().into_owned();
        let connection = Connection::open(&path)
            .map_err(|error| AppError::Database(format!("open {}: {error}", path.display())))?;
        configure_connection(&connection).map_err(AppError::Database)?;
        migrate(&connection, &root).map_err(AppError::Database)?;
        let (sender, mut receiver) = mpsc::channel(256);

        std::thread::Builder::new()
            .name("projectclibox-db".to_owned())
            .spawn(move || {
                while let Some(command) = receiver.blocking_recv() {
                    handle_command(&connection, command);
                }
            })
            .map_err(|error| AppError::Database(format!("start database actor: {error}")))?;

        Ok(Self {
            sender,
            persistence_healthy: Arc::new(AtomicBool::new(true)),
        })
    }

    async fn send<T>(
        &self,
        command: DbCommand,
        receiver: oneshot::Receiver<Result<T, String>>,
    ) -> AppResult<T> {
        self.sender
            .send(command)
            .await
            .map_err(|_| AppError::Database("database actor stopped".to_owned()))?;
        receiver
            .await
            .map_err(|_| AppError::Database("database command was cancelled".to_owned()))?
            .map_err(AppError::Database)
    }

    pub async fn ping(&self) -> AppResult<()> {
        let (reply, receiver) = oneshot::channel();
        self.send(DbCommand::Ping { reply }, receiver).await?;
        if self.persistence_healthy.load(Ordering::Acquire) {
            Ok(())
        } else {
            Err(AppError::Database(
                "session persistence is degraded".to_owned(),
            ))
        }
    }

    pub async fn list_projects(&self) -> AppResult<Vec<Project>> {
        let (reply, receiver) = oneshot::channel();
        self.send(DbCommand::ListProjects { reply }, receiver).await
    }

    pub async fn get_project(&self, id: String) -> AppResult<Option<Project>> {
        let (reply, receiver) = oneshot::channel();
        self.send(DbCommand::GetProject { id, reply }, receiver)
            .await
    }

    pub async fn create_project(
        &self,
        name: String,
        working_directory: String,
    ) -> AppResult<Project> {
        let (reply, receiver) = oneshot::channel();
        self.send(
            DbCommand::CreateProject {
                id: Uuid::new_v4().to_string(),
                name,
                working_directory,
                reply,
            },
            receiver,
        )
        .await
    }

    pub async fn update_project(
        &self,
        id: String,
        name: String,
        working_directory: String,
    ) -> AppResult<Option<Project>> {
        let (reply, receiver) = oneshot::channel();
        self.send(
            DbCommand::UpdateProject {
                id,
                name,
                working_directory,
                reply,
            },
            receiver,
        )
        .await
    }

    pub async fn delete_project(&self, id: String) -> AppResult<bool> {
        let (reply, receiver) = oneshot::channel();
        self.send(DbCommand::DeleteProject { id, reply }, receiver)
            .await
    }

    pub async fn list_sessions(&self) -> AppResult<Vec<SessionRecord>> {
        let (reply, receiver) = oneshot::channel();
        self.send(DbCommand::ListSessions { reply }, receiver).await
    }

    pub async fn upsert_session(&self, session: SessionRecord) -> AppResult<()> {
        let (reply, receiver) = oneshot::channel();
        let result = self
            .send(DbCommand::UpsertSession { session, reply }, receiver)
            .await;
        self.persistence_healthy
            .store(result.is_ok(), Ordering::Release);
        result
    }

    pub async fn delete_session(&self, id: SessionId) -> AppResult<bool> {
        let (reply, receiver) = oneshot::channel();
        self.send(DbCommand::DeleteSession { id, reply }, receiver)
            .await
    }

    pub async fn set_setting(&self, key: String, value: String) -> AppResult<()> {
        let (reply, receiver) = oneshot::channel();
        self.send(DbCommand::SetSetting { key, value, reply }, receiver)
            .await
    }

    pub async fn list_settings(&self) -> AppResult<Vec<(String, String)>> {
        let (reply, receiver) = oneshot::channel();
        self.send(DbCommand::ListSettings { reply }, receiver).await
    }
}

fn configure_connection(connection: &Connection) -> Result<(), String> {
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| format!("enable WAL: {error}"))?;
    connection
        .pragma_update(None, "busy_timeout", 10_000)
        .map_err(|error| format!("set busy timeout: {error}"))?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| format!("enable foreign keys: {error}"))?;
    Ok(())
}

fn migrate(connection: &Connection, workspace_root: &str) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
               version INTEGER PRIMARY KEY,
               applied_at TEXT NOT NULL DEFAULT (datetime('now'))
             );",
        )
        .map_err(|error| format!("create migration table: {error}"))?;
    let version: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("read migration version: {error}"))?;
    if version < 1 {
        let transaction = connection
            .unchecked_transaction()
            .map_err(|error| format!("start migration: {error}"))?;
        transaction
            .execute_batch(
                "CREATE TABLE projects (
                   id TEXT PRIMARY KEY,
                   name TEXT NOT NULL,
                   working_directory TEXT NOT NULL,
                   expanded INTEGER NOT NULL DEFAULT 1,
                   sort_order INTEGER NOT NULL DEFAULT 0,
                   is_uncategorized INTEGER NOT NULL DEFAULT 0,
                   created_at TEXT NOT NULL DEFAULT (datetime('now')),
                   updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                 );
                 CREATE TABLE sessions (
                   id TEXT PRIMARY KEY,
                   project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
                   name TEXT NOT NULL,
                   working_directory TEXT NOT NULL,
                   command_json TEXT NOT NULL,
                   status TEXT NOT NULL,
                   child_pid INTEGER,
                   process_group INTEGER,
                   rows INTEGER NOT NULL,
                   cols INTEGER NOT NULL,
                   created_at TEXT NOT NULL,
                   started_at TEXT,
                   ended_at TEXT,
                   last_activity_at TEXT NOT NULL,
                   last_attached_at TEXT,
                   exit_code INTEGER,
                   exit_signal INTEGER,
                   output_bytes INTEGER NOT NULL DEFAULT 0
                 );
                 CREATE TABLE settings (
                   key TEXT PRIMARY KEY,
                   value TEXT NOT NULL,
                   updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                 );
                 CREATE INDEX sessions_project_id_idx ON sessions(project_id);
                 CREATE INDEX sessions_status_idx ON sessions(status);
                 CREATE INDEX sessions_last_activity_idx ON sessions(last_activity_at);",
            )
            .map_err(|error| format!("apply migration: {error}"))?;
        transaction
            .execute(
                "INSERT INTO projects (id, name, working_directory, is_uncategorized, sort_order)
                 VALUES ('uncategorized', 'Uncategorized', ?1, 1, 999999)",
                params![workspace_root],
            )
            .map_err(|error| format!("insert default project: {error}"))?;
        transaction
            .execute("INSERT INTO schema_migrations (version) VALUES (1)", [])
            .map_err(|error| format!("record migration: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("commit migration: {error}"))?;
    }
    Ok(())
}

fn handle_command(connection: &Connection, command: DbCommand) {
    match command {
        DbCommand::Ping { reply } => {
            // A write transaction catches read-only mounts and lock/disk
            // failures that a SELECT-only probe would miss. The transaction
            // is rolled back immediately and leaves no durable state.
            let result = connection
                .execute_batch("BEGIN IMMEDIATE; ROLLBACK;")
                .map_err(|error| format!("database health check: {error}"));
            let _ = reply.send(result);
        }
        DbCommand::ListProjects { reply } => {
            let result = list_projects(connection);
            let _ = reply.send(result);
        }
        DbCommand::GetProject { id, reply } => {
            let result = get_project(connection, &id);
            let _ = reply.send(result);
        }
        DbCommand::CreateProject {
            id,
            name,
            working_directory,
            reply,
        } => {
            let result = connection
                .execute(
                    "INSERT INTO projects (id, name, working_directory, sort_order)
                     VALUES (?1, ?2, ?3, COALESCE((SELECT MAX(sort_order) + 1 FROM projects WHERE is_uncategorized = 0), 0))",
                    params![id, name, working_directory],
                )
                .map_err(|error| format!("create project: {error}"))
                .and_then(|_| get_project(connection, &id).and_then(|project| project.ok_or_else(|| "created project disappeared".to_owned())));
            let _ = reply.send(result);
        }
        DbCommand::UpdateProject {
            id,
            name,
            working_directory,
            reply,
        } => {
            let result = connection
                .execute(
                    "UPDATE projects SET name = ?1, working_directory = ?2, updated_at = datetime('now')
                     WHERE id = ?3 AND is_uncategorized = 0",
                    params![name, working_directory, id],
                )
                .map_err(|error| format!("update project: {error}"))
                .and_then(|_| get_project(connection, &id));
            let _ = reply.send(result);
        }
        DbCommand::DeleteProject { id, reply } => {
            let result = connection
                .execute(
                    "DELETE FROM projects WHERE id = ?1 AND is_uncategorized = 0",
                    params![id],
                )
                .map(|count| count > 0)
                .map_err(|error| format!("delete project: {error}"));
            let _ = reply.send(result);
        }
        DbCommand::ListSessions { reply } => {
            let result = list_sessions(connection);
            let _ = reply.send(result);
        }
        DbCommand::UpsertSession { session, reply } => {
            let result = upsert_session(connection, &session);
            let _ = reply.send(result);
        }
        DbCommand::DeleteSession { id, reply } => {
            let result = connection
                .execute(
                    "DELETE FROM sessions WHERE id = ?1",
                    params![id.to_string()],
                )
                .map(|count| count > 0)
                .map_err(|error| format!("delete session: {error}"));
            let _ = reply.send(result);
        }
        DbCommand::SetSetting { key, value, reply } => {
            let result = connection
                .execute(
                    "INSERT INTO settings (key, value) VALUES (?1, ?2)
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
                    params![key, value],
                )
                .map(|_| ())
                .map_err(|error| format!("set setting: {error}"));
            let _ = reply.send(result);
        }
        DbCommand::ListSettings { reply } => {
            let result = connection
                .prepare("SELECT key, value FROM settings ORDER BY key")
                .map_err(|error| format!("prepare settings: {error}"))
                .and_then(|mut statement| {
                    statement
                        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                        .map_err(|error| format!("list settings: {error}"))?
                        .collect::<Result<Vec<_>, _>>()
                        .map_err(|error| format!("read settings: {error}"))
                });
            let _ = reply.send(result);
        }
    }
}

fn list_projects(connection: &Connection) -> Result<Vec<Project>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, name, working_directory, expanded, sort_order, is_uncategorized,
                    created_at, updated_at
             FROM projects ORDER BY is_uncategorized ASC, sort_order ASC, name ASC",
        )
        .map_err(|error| format!("prepare projects: {error}"))?;
    let result = statement
        .query_map([], project_from_row)
        .map_err(|error| format!("list projects: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("read projects: {error}"));
    result
}

fn get_project(connection: &Connection, id: &str) -> Result<Option<Project>, String> {
    connection
        .query_row(
            "SELECT id, name, working_directory, expanded, sort_order, is_uncategorized,
                    created_at, updated_at
             FROM projects WHERE id = ?1",
            params![id],
            project_from_row,
        )
        .optional()
        .map_err(|error| format!("get project: {error}"))
}

fn project_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        working_directory: row.get(2)?,
        expanded: row.get::<_, i64>(3)? != 0,
        sort_order: row.get(4)?,
        is_uncategorized: row.get::<_, i64>(5)? != 0,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn list_sessions(connection: &Connection) -> Result<Vec<SessionRecord>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, name, project_id, working_directory, command_json, status,
                    child_pid, process_group, rows, cols, created_at, started_at, ended_at,
                    last_activity_at, last_attached_at, exit_code, exit_signal, output_bytes
             FROM sessions ORDER BY created_at ASC",
        )
        .map_err(|error| format!("prepare sessions: {error}"))?;
    let result = statement
        .query_map([], session_from_row)
        .map_err(|error| format!("list sessions: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("read sessions: {error}"));
    result
}

fn session_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionRecord> {
    let parse_time = |index| -> rusqlite::Result<DateTime<Utc>> {
        let value: String = row.get(index)?;
        Ok(DateTime::parse_from_rfc3339(&value)
            .map(|time| time.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now()))
    };
    let parse_optional_time = |index| -> rusqlite::Result<Option<DateTime<Utc>>> {
        let value: Option<String> = row.get(index)?;
        Ok(value.and_then(|value| {
            DateTime::parse_from_rfc3339(&value)
                .ok()
                .map(|time| time.with_timezone(&Utc))
        }))
    };
    let command_json: String = row.get(4)?;
    let command = serde_json::from_str(&command_json)
        .unwrap_or_else(|_| vec!["/bin/bash".to_owned(), "-i".to_owned()]);
    let status: String = row.get(5)?;
    Ok(SessionRecord {
        id: SessionId(
            Uuid::parse_str(&row.get::<_, String>(0)?)
                .map_err(|_| rusqlite::Error::InvalidQuery)?,
        ),
        name: row.get(1)?,
        project_id: row.get(2)?,
        working_directory: row.get(3)?,
        command,
        status: status_from_string(&status),
        child_pid: row.get::<_, Option<i64>>(6)?.map(|value| value as u32),
        process_group: row.get::<_, Option<i64>>(7)?.map(|value| value as i32),
        rows: row.get::<_, i64>(8)? as u16,
        cols: row.get::<_, i64>(9)? as u16,
        created_at: parse_time(10)?,
        started_at: parse_optional_time(11)?,
        ended_at: parse_optional_time(12)?,
        last_activity_at: parse_time(13)?,
        last_attached_at: parse_optional_time(14)?,
        exit_code: row.get::<_, Option<i64>>(15)?.map(|value| value as i32),
        exit_signal: row.get::<_, Option<i64>>(16)?.map(|value| value as i32),
        output_bytes: row.get::<_, i64>(17)? as u64,
    })
}

fn upsert_session(connection: &Connection, session: &SessionRecord) -> Result<(), String> {
    let command_json =
        serde_json::to_string(&session.command).map_err(|error| error.to_string())?;
    connection
        .execute(
            "INSERT INTO sessions (
               id, project_id, name, working_directory, command_json, status, child_pid,
               process_group, rows, cols, created_at, started_at, ended_at, last_activity_at,
               last_attached_at, exit_code, exit_signal, output_bytes
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
             ON CONFLICT(id) DO UPDATE SET
               project_id = excluded.project_id,
               name = excluded.name,
               working_directory = excluded.working_directory,
               command_json = excluded.command_json,
               status = excluded.status,
               child_pid = excluded.child_pid,
               process_group = excluded.process_group,
               rows = excluded.rows,
               cols = excluded.cols,
               started_at = excluded.started_at,
               ended_at = excluded.ended_at,
               last_activity_at = excluded.last_activity_at,
               last_attached_at = excluded.last_attached_at,
               exit_code = excluded.exit_code,
               exit_signal = excluded.exit_signal,
               output_bytes = excluded.output_bytes",
            params![
                session.id.to_string(),
                session.project_id,
                session.name,
                session.working_directory,
                command_json,
                status_to_string(session.status),
                session.child_pid.map(i64::from),
                session.process_group.map(i64::from),
                i64::from(session.rows),
                i64::from(session.cols),
                session.created_at.to_rfc3339(),
                session.started_at.map(|value| value.to_rfc3339()),
                session.ended_at.map(|value| value.to_rfc3339()),
                session.last_activity_at.to_rfc3339(),
                session.last_attached_at.map(|value| value.to_rfc3339()),
                session.exit_code.map(i64::from),
                session.exit_signal.map(i64::from),
                session.output_bytes as i64,
            ],
        )
        .map(|_| ())
        .map_err(|error| format!("upsert session: {error}"))
}

pub fn status_to_string(status: SessionStatus) -> &'static str {
    match status {
        SessionStatus::Starting => "starting",
        SessionStatus::Running => "running",
        SessionStatus::Idle => "idle",
        SessionStatus::Disconnected => "disconnected",
        SessionStatus::Exited => "exited",
        SessionStatus::Failed => "failed",
        SessionStatus::Terminating => "terminating",
    }
}

pub fn status_from_string(status: &str) -> SessionStatus {
    match status {
        "starting" => SessionStatus::Starting,
        "running" => SessionStatus::Running,
        "idle" => SessionStatus::Idle,
        "disconnected" => SessionStatus::Disconnected,
        "terminating" => SessionStatus::Terminating,
        "failed" => SessionStatus::Failed,
        _ => SessionStatus::Exited,
    }
}

#[cfg(test)]
mod tests {
    use super::Database;
    use std::path::PathBuf;

    #[tokio::test]
    async fn initializes_schema_and_uncategorized_project() {
        let temp = tempfile::tempdir().expect("tempdir");
        let db = Database::open(temp.path().join("v2.db"), temp.path()).expect("database");
        let projects = db.list_projects().await.expect("projects");
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].id, "uncategorized");
        assert_eq!(PathBuf::from(&projects[0].working_directory), temp.path());
    }
}
