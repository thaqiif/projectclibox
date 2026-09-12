use crate::{
    error::{AppError, AppResult},
    models::Project,
    security::WorkspacePolicy,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tokio::fs;
use uuid::Uuid;

const DEFAULT_EXCLUDES: &[&str] = &[
    "node_modules",
    ".git",
    ".next",
    "dist",
    "build",
    "out",
    "coverage",
    ".cache",
    ".vercel",
    ".turbo",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".venv",
    "venv",
    ".DS_Store",
    ".env",
    ".env.local",
    ".env.*.local",
    "*.log",
    "*.db",
    "*.db-wal",
    "*.db-shm",
];
const MAX_SCAN_ENTRIES: usize = 200_000;

#[derive(Debug, Clone, Serialize)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub relative_path: String,
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub size: Option<u64>,
    pub extension: Option<String>,
    pub modified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DirectoryPage {
    pub files: Vec<FileNode>,
    pub path: String,
    pub next_cursor: Option<String>,
    pub scanned: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileContent {
    pub content: String,
    pub is_binary: bool,
    pub size: u64,
    pub path: String,
}

pub async fn list_directory(
    policy: &WorkspacePolicy,
    project: &Project,
    relative: Option<&str>,
    cursor: Option<&str>,
    requested_limit: usize,
) -> AppResult<DirectoryPage> {
    let (directory, relative) = policy.resolve_existing(project, relative)?;
    let metadata = fs::metadata(&directory)
        .await
        .map_err(|error| AppError::Filesystem(format!("read directory metadata: {error}")))?;
    if !metadata.is_dir() {
        return Err(AppError::BadRequest(
            "file listing requires a directory".to_owned(),
        ));
    }
    let limit = requested_limit.clamp(1, 5000);
    let offset = cursor
        .unwrap_or("0")
        .parse::<usize>()
        .map_err(|_| AppError::BadRequest("directory cursor must be numeric".to_owned()))?;
    if offset > MAX_SCAN_ENTRIES {
        return Err(AppError::BadRequest(
            "directory cursor is too large".to_owned(),
        ));
    }
    let mut entries = fs::read_dir(&directory)
        .await
        .map_err(|error| AppError::Filesystem(format!("open directory: {error}")))?;
    let mut nodes = Vec::new();
    let mut scanned = 0;
    let mut visible = 0;
    let mut has_more = false;
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|error| AppError::Filesystem(format!("read directory: {error}")))?
    {
        scanned += 1;
        if scanned > MAX_SCAN_ENTRIES {
            return Err(AppError::Filesystem(format!(
                "directory exceeds the {MAX_SCAN_ENTRIES}-entry safety limit"
            )));
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if should_exclude(&name) {
            continue;
        }
        let file_type = entry
            .file_type()
            .await
            .map_err(|error| AppError::Filesystem(format!("inspect directory entry: {error}")))?;
        // Symlinks are intentionally not followed in browser listings. This
        // prevents a harmless-looking link from becoming a root escape later.
        if file_type.is_symlink() {
            continue;
        }
        if visible < offset {
            visible += 1;
            continue;
        }
        if nodes.len() >= limit {
            has_more = true;
            break;
        }
        let is_dir = file_type.is_dir();
        let metadata = entry
            .metadata()
            .await
            .map_err(|error| AppError::Filesystem(format!("inspect file metadata: {error}")))?;
        let child_relative = if relative.as_os_str().is_empty() {
            PathBuf::from(&name)
        } else {
            relative.join(&name)
        };
        let modified_at = metadata
            .modified()
            .ok()
            .map(DateTime::<Utc>::from)
            .map(|date| date.to_rfc3339());
        nodes.push(FileNode {
            name: name.clone(),
            path: directory.join(&name).to_string_lossy().into_owned(),
            relative_path: child_relative.to_string_lossy().into_owned(),
            kind: if is_dir { "directory" } else { "file" },
            size: (!is_dir).then_some(metadata.len()),
            extension: (!is_dir)
                .then(|| {
                    Path::new(&name)
                        .extension()
                        .and_then(|value| value.to_str())
                        .unwrap_or("")
                        .to_owned()
                })
                .filter(|value| !value.is_empty()),
            modified_at,
        });
        visible += 1;
    }
    nodes.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    let next_cursor = has_more.then(|| (offset + nodes.len()).to_string());
    Ok(DirectoryPage {
        files: nodes,
        path: directory.to_string_lossy().into_owned(),
        next_cursor,
        scanned,
        truncated: has_more,
    })
}

pub async fn read_file(
    policy: &WorkspacePolicy,
    project: &Project,
    relative: &str,
    max_bytes: u64,
) -> AppResult<FileContent> {
    let (path, _) = policy.resolve_existing(project, Some(relative))?;
    let metadata = fs::metadata(&path)
        .await
        .map_err(|error| AppError::Filesystem(format!("read file metadata: {error}")))?;
    if !metadata.is_file() {
        return Err(AppError::BadRequest(
            "file content requires a regular file".to_owned(),
        ));
    }
    if metadata.len() > max_bytes {
        return Err(AppError::BadRequest(format!(
            "file is larger than the {max_bytes}-byte browser limit"
        )));
    }
    let bytes = fs::read(&path)
        .await
        .map_err(|error| AppError::Filesystem(format!("read file: {error}")))?;
    let is_binary = bytes.contains(&0);
    let content = if is_binary {
        format!("Binary file ({} bytes)", bytes.len())
    } else {
        String::from_utf8_lossy(&bytes).into_owned()
    };
    Ok(FileContent {
        content,
        is_binary,
        size: metadata.len(),
        path: path.to_string_lossy().into_owned(),
    })
}

pub async fn write_file(
    policy: &WorkspacePolicy,
    project: &Project,
    relative: &str,
    content: String,
    max_bytes: u64,
) -> AppResult<u64> {
    write_bytes(policy, project, relative, content.into_bytes(), max_bytes).await
}

pub async fn write_bytes(
    policy: &WorkspacePolicy,
    project: &Project,
    relative: &str,
    bytes: Vec<u8>,
    max_bytes: u64,
) -> AppResult<u64> {
    if bytes.len() as u64 > max_bytes {
        return Err(AppError::BadRequest(format!(
            "content exceeds the {max_bytes}-byte browser limit"
        )));
    }
    let (path, _) = policy.resolve_file_for_write(project, relative)?;
    let temporary = path.with_file_name(format!(
        ".{}.projectclibox-{}.tmp",
        path.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("file"),
        Uuid::new_v4()
    ));
    let temporary_for_task = temporary.clone();
    let path_for_task = path.clone();
    tokio::task::spawn_blocking(move || {
        std::fs::write(&temporary_for_task, bytes)
            .map_err(|error| AppError::Filesystem(format!("write temporary file: {error}")))?;
        std::fs::rename(&temporary_for_task, &path_for_task)
            .map_err(|error| AppError::Filesystem(format!("replace file atomically: {error}")))
    })
    .await
    .map_err(|error| AppError::Filesystem(format!("file write worker stopped: {error}")))??;
    Ok(fs::metadata(path)
        .await
        .map_err(|error| AppError::Filesystem(format!("read saved file metadata: {error}")))?
        .len())
}

fn should_exclude(name: &str) -> bool {
    DEFAULT_EXCLUDES.iter().any(|pattern| {
        if let Some((prefix, suffix)) = pattern.split_once('*') {
            name.starts_with(prefix) && name.ends_with(suffix)
        } else {
            *pattern == name
        }
    })
}

#[cfg(test)]
mod tests {
    use super::{list_directory, read_file, write_file};
    use crate::{models::Project, security::WorkspacePolicy};
    use std::fs;

    fn project(path: &std::path::Path) -> Project {
        Project {
            id: "p".to_owned(),
            name: "P".to_owned(),
            working_directory: path.to_string_lossy().into_owned(),
            expanded: true,
            sort_order: 0,
            is_uncategorized: false,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[tokio::test]
    async fn pages_directory_and_writes_atomically() {
        let temp = tempfile::tempdir().expect("tempdir");
        fs::write(temp.path().join("a.txt"), "a").expect("file");
        fs::write(temp.path().join("b.txt"), "b").expect("file");
        let policy = WorkspacePolicy::new(temp.path().to_path_buf());
        let p = project(temp.path());
        let page = list_directory(&policy, &p, None, None, 1)
            .await
            .expect("page");
        assert_eq!(page.files.len(), 1);
        assert!(page.next_cursor.is_some());
        write_file(&policy, &p, "a.txt", "updated".to_owned(), 100)
            .await
            .expect("write");
        assert_eq!(
            read_file(&policy, &p, "a.txt", 100)
                .await
                .expect("read")
                .content,
            "updated"
        );
    }
}
