use crate::error::{AppError, AppResult};
use clap::Args;
use std::{env, net::SocketAddr, path::PathBuf, str::FromStr};

const DEFAULT_PORT: u16 = 3011;
const DEFAULT_SCROLLBACK_BYTES: usize = 4 * 1024 * 1024;
const MAX_SCROLLBACK_BYTES: usize = 16 * 1024 * 1024;
const DEFAULT_FILE_BYTES: u64 = 2 * 1024 * 1024;
const DEFAULT_DIRECTORY_LIMIT: usize = 200;
const DEFAULT_IDLE_AFTER_SECS: u64 = 60;

#[derive(Debug, Clone, Args)]
pub struct RuntimeArgs {
    /// Address for the HTTP/WebSocket control plane.
    #[arg(long, env = "PCLX_BIND", default_value = "127.0.0.1")]
    pub bind: String,

    /// HTTP port.
    #[arg(long, env = "PCLX_PORT", default_value_t = DEFAULT_PORT)]
    pub port: u16,

    /// SQLite metadata database path.
    #[arg(long, env = "DB_PATH")]
    pub db_path: Option<PathBuf>,

    /// Built frontend directory.
    #[arg(long, env = "PCLX_STATIC_DIR", default_value = "frontend/dist")]
    pub static_dir: PathBuf,

    /// Authorized workspace root. Browser file APIs cannot leave this root.
    #[arg(long)]
    pub workspace_root: Option<PathBuf>,

    /// Shared token for non-loopback deployments. A request may provide it as
    /// a Bearer token or the `projectclibox_auth` cookie.
    #[arg(long, env = "PROJECTCLIBOX_AUTH_TOKEN", alias = "auth-token")]
    pub auth_token: Option<String>,

    /// Explicitly allow an unauthenticated non-loopback listener when a
    /// trusted proxy or private edge is responsible for access control.
    #[arg(
        long,
        env = "PCLX_ALLOW_UNAUTHENTICATED_NON_LOOPBACK",
        default_value_t = false
    )]
    pub allow_unauthenticated_non_loopback: bool,

    /// Maximum recent PTY output retained per session.
    #[arg(long, env = "PCLX_SCROLLBACK_BYTES", default_value_t = DEFAULT_SCROLLBACK_BYTES)]
    pub scrollback_bytes: usize,

    /// Maximum file content returned or written through the browser API.
    #[arg(long, env = "PCLX_MAX_FILE_BYTES", default_value_t = DEFAULT_FILE_BYTES)]
    pub max_file_bytes: u64,

    /// Maximum entries returned by one directory page.
    #[arg(long, env = "PCLX_DIRECTORY_LIMIT", default_value_t = DEFAULT_DIRECTORY_LIMIT)]
    pub directory_limit: usize,

    /// Seconds without PTY output before a running session is shown as idle.
    #[arg(long, env = "PCLX_IDLE_AFTER_SECS", default_value_t = DEFAULT_IDLE_AFTER_SECS)]
    pub idle_after_secs: u64,
}

impl Default for RuntimeArgs {
    fn default() -> Self {
        Self {
            bind: "127.0.0.1".to_owned(),
            port: DEFAULT_PORT,
            db_path: None,
            static_dir: PathBuf::from("frontend/dist"),
            workspace_root: None,
            auth_token: None,
            allow_unauthenticated_non_loopback: false,
            scrollback_bytes: DEFAULT_SCROLLBACK_BYTES,
            max_file_bytes: DEFAULT_FILE_BYTES,
            directory_limit: DEFAULT_DIRECTORY_LIMIT,
            idle_after_secs: DEFAULT_IDLE_AFTER_SECS,
        }
    }
}

impl RuntimeArgs {
    /// Resolve the environment-backed defaults used when the binary is
    /// launched without an explicit subcommand. Clap performs this same
    /// resolution for `projectclibox server`; keeping the fallback explicit
    /// makes `projectclibox` and `projectclibox server` behave identically.
    pub fn from_environment() -> Self {
        Self {
            bind: env::var("PCLX_BIND").unwrap_or_else(|_| "127.0.0.1".to_owned()),
            port: env::var("PCLX_PORT")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(DEFAULT_PORT),
            db_path: env::var_os("DB_PATH").map(PathBuf::from),
            static_dir: env::var_os("PCLX_STATIC_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("frontend/dist")),
            workspace_root: env::var_os("PCLX_WORKSPACE_ROOT")
                .or_else(|| env::var_os("WORKSPACE_DIR"))
                .map(PathBuf::from),
            auth_token: env::var("PROJECTCLIBOX_AUTH_TOKEN").ok(),
            allow_unauthenticated_non_loopback: env::var("PCLX_ALLOW_UNAUTHENTICATED_NON_LOOPBACK")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(false),
            scrollback_bytes: env::var("PCLX_SCROLLBACK_BYTES")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(DEFAULT_SCROLLBACK_BYTES),
            max_file_bytes: env::var("PCLX_MAX_FILE_BYTES")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(DEFAULT_FILE_BYTES),
            directory_limit: env::var("PCLX_DIRECTORY_LIMIT")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(DEFAULT_DIRECTORY_LIMIT),
            idle_after_secs: env::var("PCLX_IDLE_AFTER_SECS")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(DEFAULT_IDLE_AFTER_SECS),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Config {
    pub address: SocketAddr,
    pub db_path: PathBuf,
    pub static_dir: PathBuf,
    pub workspace_root: PathBuf,
    pub auth_token: Option<String>,
    pub scrollback_bytes: usize,
    pub max_file_bytes: u64,
    pub directory_limit: usize,
    pub idle_after_secs: u64,
}

impl Config {
    pub fn from_args(args: &RuntimeArgs) -> AppResult<Self> {
        let ip = std::net::IpAddr::from_str(&args.bind)
            .map_err(|_| AppError::Config(format!("invalid bind address: {}", args.bind)))?;
        let address = SocketAddr::from((ip, args.port));

        if !ip.is_loopback()
            && args.auth_token.as_deref().is_none_or(str::is_empty)
            && !args.allow_unauthenticated_non_loopback
        {
            return Err(AppError::Config(
                "non-loopback bind without PROJECTCLIBOX_AUTH_TOKEN requires explicit trusted-proxy mode: set PCLX_ALLOW_UNAUTHENTICATED_NON_LOOPBACK=true or pass --allow-unauthenticated-non-loopback".to_owned(),
            ));
        }
        if args.auth_token.as_deref().is_some_and(|token| {
            !token.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~')
            })
        }) {
            return Err(AppError::Config(
                "PROJECTCLIBOX_AUTH_TOKEN must contain only cookie-safe letters, digits, '-', '.', '_' or '~'".to_owned(),
            ));
        }
        if !(1024..=MAX_SCROLLBACK_BYTES).contains(&args.scrollback_bytes) {
            return Err(AppError::Config(
                "scrollback_bytes must be between 1024 bytes and 16 MiB".to_owned(),
            ));
        }
        if args.max_file_bytes == 0 || args.max_file_bytes > 64 * 1024 * 1024 {
            return Err(AppError::Config(
                "max_file_bytes must be between 1 byte and 64 MiB".to_owned(),
            ));
        }
        if args.directory_limit == 0 || args.directory_limit > 5000 {
            return Err(AppError::Config(
                "directory_limit must be between 1 and 5000".to_owned(),
            ));
        }

        let home = env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        let db_path = args
            .db_path
            .clone()
            .or_else(|| {
                env::var_os("CLIWEB_HOME")
                    .map(PathBuf::from)
                    .map(|p| p.join("projectclibox.db"))
            })
            .unwrap_or_else(|| home.join(".cliweb/projectclibox.db"));

        let workspace_candidate = args
            .workspace_root
            .clone()
            .or_else(|| env::var_os("PCLX_WORKSPACE_ROOT").map(PathBuf::from))
            .or_else(|| env::var_os("WORKSPACE_DIR").map(PathBuf::from))
            .unwrap_or_else(|| {
                let workspaces = PathBuf::from("/workspaces");
                if workspaces.exists() {
                    workspaces
                } else {
                    env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
                }
            });
        let workspace_root = std::fs::canonicalize(&workspace_candidate).map_err(|error| {
            AppError::Config(format!(
                "workspace root {} is not accessible: {error}",
                workspace_candidate.display()
            ))
        })?;

        Ok(Self {
            address,
            db_path,
            static_dir: args.static_dir.clone(),
            workspace_root,
            auth_token: args.auth_token.clone().filter(|token| !token.is_empty()),
            scrollback_bytes: args.scrollback_bytes,
            max_file_bytes: args.max_file_bytes,
            directory_limit: args.directory_limit,
            idle_after_secs: args.idle_after_secs,
        })
    }
}
