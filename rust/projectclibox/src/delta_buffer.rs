use std::collections::VecDeque;

/// A PTY output delta, identified by the cumulative output byte offset at its
/// end. Deltas are transport data only; they are never used as the terminal's
/// visual state.
#[derive(Debug, Clone)]
pub struct OutputDelta {
    pub sequence: u64,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct DeltaReplay {
    pub chunks: Vec<OutputDelta>,
    pub replayed_through: u64,
    pub truncated: bool,
}

/// Small bounded transport buffer used only to resume a live connection when
/// the client missed a few output frames. A client that cannot resume from
/// this buffer must receive a terminal snapshot instead.
#[derive(Debug)]
pub struct OutputDeltaBuffer {
    max_bytes: usize,
    bytes: usize,
    chunks: VecDeque<OutputDelta>,
    truncated: bool,
}

impl OutputDeltaBuffer {
    pub fn new(max_bytes: usize) -> Self {
        Self {
            max_bytes,
            bytes: 0,
            chunks: VecDeque::new(),
            truncated: false,
        }
    }

    pub fn push(&mut self, sequence: u64, data: &[u8]) {
        if data.is_empty() {
            return;
        }

        let chunk = if data.len() > self.max_bytes {
            self.truncated = true;
            OutputDelta {
                sequence,
                data: data[data.len() - self.max_bytes..].to_vec(),
            }
        } else {
            OutputDelta {
                sequence,
                data: data.to_vec(),
            }
        };
        self.bytes += chunk.data.len();
        self.chunks.push_back(chunk);
        while self.bytes > self.max_bytes {
            if let Some(removed) = self.chunks.pop_front() {
                self.bytes = self.bytes.saturating_sub(removed.data.len());
                self.truncated = true;
            }
        }
    }

    pub fn replay_after(&self, from_sequence: u64) -> DeltaReplay {
        let first_sequence = self.chunks.front().map_or(0, |chunk| chunk.sequence);
        let truncated = self.truncated && (first_sequence == 0 || from_sequence < first_sequence);
        let chunks = self
            .chunks
            .iter()
            .filter(|chunk| chunk.sequence > from_sequence)
            .cloned()
            .collect::<Vec<_>>();
        let replayed_through = chunks.last().map_or(from_sequence, |chunk| chunk.sequence);
        DeltaReplay {
            chunks,
            replayed_through,
            truncated,
        }
    }

    pub fn bytes(&self) -> usize {
        self.bytes
    }

    pub fn truncated(&self) -> bool {
        self.truncated
    }
}

#[cfg(test)]
mod tests {
    use super::OutputDeltaBuffer;

    #[test]
    fn retains_recent_bytes_and_order() {
        let mut buffer = OutputDeltaBuffer::new(5);
        buffer.push(1, b"ab");
        buffer.push(2, b"cde");
        buffer.push(3, b"fg");

        let replay = buffer.replay_after(0);
        assert_eq!(
            replay
                .chunks
                .iter()
                .map(|chunk| chunk.sequence)
                .collect::<Vec<_>>(),
            [2, 3]
        );
        assert_eq!(replay.chunks[0].data, b"cde");
        assert_eq!(replay.chunks[1].data, b"fg");
        assert!(replay.truncated);
    }

    #[test]
    fn filters_already_seen_sequences() {
        let mut buffer = OutputDeltaBuffer::new(100);
        buffer.push(1, b"a");
        buffer.push(2, b"b");
        let replay = buffer.replay_after(1);
        assert_eq!(replay.replayed_through, 2);
        assert_eq!(replay.chunks.len(), 1);
        assert_eq!(replay.chunks[0].data, b"b");
    }
}
