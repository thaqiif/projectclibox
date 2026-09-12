use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("configuration error: {0}")]
    Config(String),
    #[error("database error: {0}")]
    Database(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("invalid request: {0}")]
    BadRequest(String),
    #[error("forbidden: {0}")]
    Forbidden(String),
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("filesystem error: {0}")]
    Filesystem(String),
    #[error("session error: {0}")]
    Session(String),
    #[error("internal error")]
    Internal,
}

impl AppError {
    pub fn status(&self) -> StatusCode {
        match self {
            Self::Config(_) | Self::Internal | Self::Database(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::Forbidden(_) => StatusCode::FORBIDDEN,
            Self::Conflict(_) => StatusCode::CONFLICT,
            Self::Filesystem(_) => StatusCode::BAD_REQUEST,
            Self::Session(_) => StatusCode::UNPROCESSABLE_ENTITY,
        }
    }
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    error: String,
    code: &'static str,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let code = match self {
            Self::Config(_) | Self::Database(_) | Self::Internal => "internal_error",
            Self::NotFound(_) => "not_found",
            Self::BadRequest(_) => "bad_request",
            Self::Forbidden(_) => "forbidden",
            Self::Conflict(_) => "conflict",
            Self::Filesystem(_) => "filesystem_error",
            Self::Session(_) => "session_error",
        };
        let status = self.status();
        let message = match self {
            Self::Internal => "The service encountered an internal error.".to_owned(),
            other => other.to_string(),
        };
        (
            status,
            Json(ErrorBody {
                error: message,
                code,
            }),
        )
            .into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;
