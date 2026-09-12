use crate::models::{SessionId, SessionSnapshot};
use bytes::Bytes;
use serde::{Deserialize, Serialize};

pub const OUTPUT_FRAME_VERSION: u8 = 1;
pub const OUTPUT_FRAME_HEADER_BYTES: usize = 9;

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum ClientMessage {
    #[serde(rename = "terminal.attach")]
    Attach {
        #[serde(rename = "sessionId")]
        session_id: SessionId,
        #[serde(rename = "fromSequence")]
        from_sequence: Option<u64>,
    },
    #[serde(rename = "terminal.input")]
    Input { data: String },
    #[serde(rename = "terminal.resize")]
    Resize { cols: u16, rows: u16 },
    #[serde(rename = "terminal.detach")]
    Detach,
    #[serde(rename = "terminal.ping")]
    Ping { nonce: Option<String> },
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
pub enum ServerMessage<'a> {
    #[serde(rename = "terminal.ready")]
    Ready {
        #[serde(rename = "sessionId")]
        session_id: SessionId,
        #[serde(rename = "replayedThrough")]
        replayed_through: u64,
        truncated: bool,
        snapshot: &'a SessionSnapshot,
    },
    #[serde(rename = "terminal.state")]
    State { snapshot: &'a SessionSnapshot },
    #[serde(rename = "terminal.exit")]
    Exit {
        code: Option<i32>,
        signal: Option<i32>,
    },
    #[serde(rename = "terminal.gap")]
    Gap {
        #[serde(rename = "lastSequence")]
        last_sequence: u64,
        #[serde(rename = "resyncRequired")]
        resync_required: bool,
    },
    #[serde(rename = "terminal.pong")]
    Pong { nonce: Option<String> },
    #[serde(rename = "terminal.error")]
    Error { code: &'a str, message: &'a str },
}

pub fn control_message(
    message: &ServerMessage<'_>,
) -> Result<axum::extract::ws::Message, serde_json::Error> {
    Ok(axum::extract::ws::Message::Text(
        serde_json::to_string(message)?.into(),
    ))
}

pub fn output_frame(sequence: u64, data: &[u8]) -> Bytes {
    let mut frame = Vec::with_capacity(OUTPUT_FRAME_HEADER_BYTES + data.len());
    frame.push(OUTPUT_FRAME_VERSION);
    frame.extend_from_slice(&sequence.to_be_bytes());
    frame.extend_from_slice(data);
    Bytes::from(frame)
}

pub fn parse_input(
    message: axum::extract::ws::Message,
) -> Result<Option<ClientMessage>, serde_json::Error> {
    match message {
        axum::extract::ws::Message::Text(text) => serde_json::from_str(&text).map(Some),
        axum::extract::ws::Message::Binary(bytes) => {
            if bytes.len() == OUTPUT_FRAME_HEADER_BYTES && bytes[0] == OUTPUT_FRAME_VERSION {
                return Ok(None);
            }
            serde_json::from_slice(&bytes).map(Some)
        }
        axum::extract::ws::Message::Ping(_) | axum::extract::ws::Message::Pong(_) => Ok(None),
        axum::extract::ws::Message::Close(_) => Ok(None),
    }
}
