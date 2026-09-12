use crate::{
    error::{AppError, AppResult},
    models::Project,
};
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone)]
pub struct WorkspacePolicy {
    root: PathBuf,
}

impl WorkspacePolicy {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn authorize_project_path(&self, path: &Path) -> AppResult<PathBuf> {
        let canonical = path.canonicalize().map_err(|error| {
            AppError::Forbidden(format!("workspace path is not accessible: {error}"))
        })?;
        if !canonical.starts_with(&self.root) {
            return Err(AppError::Forbidden(
                "project must be inside the authorized workspace root".to_owned(),
            ));
        }
        if !canonical.is_dir() {
            return Err(AppError::BadRequest(
                "project working directory must be a directory".to_owned(),
            ));
        }
        Ok(canonical)
    }

    pub fn project_root(&self, project: &Project) -> AppResult<PathBuf> {
        self.authorize_project_path(Path::new(&project.working_directory))
    }

    pub fn relative_path(&self, value: Option<&str>) -> AppResult<PathBuf> {
        let value = value.unwrap_or("");
        if value.contains('\0') {
            return Err(AppError::BadRequest("path contains a NUL byte".to_owned()));
        }
        let path = Path::new(value);
        if path.is_absolute() {
            return Err(AppError::Forbidden(
                "browser file paths must be relative to a project".to_owned(),
            ));
        }
        for component in path.components() {
            match component {
                Component::ParentDir => {
                    return Err(AppError::Forbidden(
                        "path traversal is not allowed".to_owned(),
                    ))
                }
                Component::RootDir | Component::Prefix(_) => {
                    return Err(AppError::Forbidden(
                        "absolute paths are not allowed".to_owned(),
                    ))
                }
                Component::CurDir | Component::Normal(_) => {}
            }
        }
        Ok(path.to_owned())
    }

    pub fn resolve_existing(
        &self,
        project: &Project,
        relative: Option<&str>,
    ) -> AppResult<(PathBuf, PathBuf)> {
        let project_root = self.project_root(project)?;
        let relative = self.relative_path(relative)?;
        let candidate = project_root.join(&relative);
        let canonical = candidate
            .canonicalize()
            .map_err(|error| AppError::Filesystem(format!("path is not accessible: {error}")))?;
        if !canonical.starts_with(&project_root) || !canonical.starts_with(&self.root) {
            return Err(AppError::Forbidden(
                "path escapes the authorized project root".to_owned(),
            ));
        }
        Ok((canonical, relative))
    }

    pub fn resolve_file_for_write(
        &self,
        project: &Project,
        relative: &str,
    ) -> AppResult<(PathBuf, PathBuf)> {
        let project_root = self.project_root(project)?;
        let relative_path = self.relative_path(Some(relative))?;
        if relative_path.as_os_str().is_empty() {
            return Err(AppError::BadRequest("a file path is required".to_owned()));
        }
        let parent = relative_path
            .parent()
            .map_or_else(|| project_root.clone(), |parent| project_root.join(parent));
        let canonical_parent = parent.canonicalize().map_err(|error| {
            AppError::Filesystem(format!("parent directory is not accessible: {error}"))
        })?;
        if !canonical_parent.starts_with(&project_root) || !canonical_parent.starts_with(&self.root)
        {
            return Err(AppError::Forbidden(
                "file path escapes the authorized project root".to_owned(),
            ));
        }
        let file_name = relative_path
            .file_name()
            .ok_or_else(|| AppError::BadRequest("a file name is required".to_owned()))?;
        Ok((canonical_parent.join(file_name), relative_path))
    }
}

#[cfg(test)]
mod tests {
    use super::WorkspacePolicy;
    use std::fs;

    #[test]
    fn rejects_traversal_and_symlink_escape() {
        let temp = tempfile::tempdir().expect("tempdir");
        let root = temp.path().join("workspace");
        let outside = temp.path().join("outside");
        fs::create_dir(&root).expect("root");
        fs::create_dir(&outside).expect("outside");
        fs::write(outside.join("secret.txt"), "secret").expect("secret");
        std::os::unix::fs::symlink(&outside, root.join("escape")).expect("symlink");
        let policy = WorkspacePolicy::new(root.clone());
        assert!(policy.relative_path(Some("../outside")).is_err());
        let project = crate::models::Project {
            id: "p".to_owned(),
            name: "p".to_owned(),
            working_directory: root.to_string_lossy().into_owned(),
            expanded: true,
            sort_order: 0,
            is_uncategorized: false,
            created_at: String::new(),
            updated_at: String::new(),
        };
        assert!(policy
            .resolve_existing(&project, Some("escape/secret.txt"))
            .is_err());
    }
}
