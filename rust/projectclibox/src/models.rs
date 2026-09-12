use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{fmt, str::FromStr};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SessionId(pub Uuid);

impl SessionId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }
}

impl Default for SessionId {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for SessionId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

impl FromStr for SessionId {
    type Err = uuid::Error;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Ok(Self(Uuid::parse_str(value)?))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Starting,
    Running,
    Idle,
    Disconnected,
    Exited,
    Failed,
    Terminating,
}

impl SessionStatus {
    pub fn is_live(self) -> bool {
        matches!(
            self,
            Self::Starting | Self::Running | Self::Idle | Self::Disconnected | Self::Terminating
        )
    }

    pub fn is_finished(self) -> bool {
        matches!(self, Self::Exited | Self::Failed)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(rename = "working_directory")]
    pub working_directory: String,
    pub expanded: bool,
    pub sort_order: i64,
    pub is_uncategorized: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSnapshot {
    pub id: SessionId,
    pub name: String,
    pub project_id: Option<String>,
    pub working_directory: String,
    pub command: Vec<String>,
    pub status: SessionStatus,
    pub child_pid: Option<u32>,
    pub process_group: Option<i32>,
    pub rows: u16,
    pub cols: u16,
    pub attached_viewers: usize,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,
    pub last_activity_at: DateTime<Utc>,
    pub last_attached_at: Option<DateTime<Utc>>,
    pub runtime_ms: u64,
    pub exit_code: Option<i32>,
    pub exit_signal: Option<i32>,
    pub output_bytes: u64,
    pub scrollback_bytes: usize,
    pub scrollback_truncated: bool,
    pub cpu_percent: Option<f64>,
    pub memory_bytes: Option<u64>,
    pub process_count: Option<usize>,
}

#[derive(Debug, Clone)]
pub struct SessionRecord {
    pub id: SessionId,
    pub name: String,
    pub project_id: Option<String>,
    pub working_directory: String,
    pub command: Vec<String>,
    pub status: SessionStatus,
    pub child_pid: Option<u32>,
    pub process_group: Option<i32>,
    pub rows: u16,
    pub cols: u16,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,
    pub last_activity_at: DateTime<Utc>,
    pub last_attached_at: Option<DateTime<Utc>>,
    pub exit_code: Option<i32>,
    pub exit_signal: Option<i32>,
    pub output_bytes: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateSessionRequest {
    pub project_id: Option<String>,
    pub name: Option<String>,
    pub command: Option<Vec<String>>,
    pub command_line: Option<String>,
    pub cwd: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateProjectRequest {
    pub name: String,
    pub working_directory: String,
    pub expanded: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UploadFileRequest {
    #[serde(rename = "projectId")]
    pub project_id: Option<String>,
    pub path: String,
    /// Standard base64-encoded file bytes. The decoded payload is bounded by
    /// the same workspace file limit as the text editor endpoint.
    pub data: String,
}
