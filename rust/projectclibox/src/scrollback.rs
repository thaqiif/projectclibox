use std::collections::VecDeque;

#[derive(Debug, Clone)]
pub struct OutputChunk {
    pub sequence: u64,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct Replay {
    pub chunks: Vec<OutputChunk>,
    pub replayed_through: u64,
    pub truncated: bool,
}

#[derive(Debug)]
pub struct Scrollback {
    max_bytes: usize,
    bytes: usize,
    chunks: VecDeque<OutputChunk>,
    truncated: bool,
}

impl Scrollback {
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
            OutputChunk {
                sequence,
                data: data[data.len() - self.max_bytes..].to_vec(),
            }
        } else {
            OutputChunk {
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

    pub fn replay_after(&self, from_sequence: u64) -> Replay {
        let first_sequence = self.chunks.front().map_or(0, |chunk| chunk.sequence);
        let truncated = self.truncated && (first_sequence == 0 || from_sequence < first_sequence);
        let chunks = self
            .chunks
            .iter()
            .filter(|chunk| chunk.sequence > from_sequence)
            .cloned()
            .collect::<Vec<_>>();
        let replayed_through = chunks.last().map_or(from_sequence, |chunk| chunk.sequence);
        Replay {
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
    use super::Scrollback;

    #[test]
    fn retains_recent_bytes_and_order() {
        let mut buffer = Scrollback::new(5);
        buffer.push(1, b"ab");
        buffer.push(2, b"cde");
        buffer.push(3, b"fg");

        let replay = buffer.replay_after(0);
        assert_eq!(
            replay.chunks.iter().map(|c| c.sequence).collect::<Vec<_>>(),
            [2, 3]
        );
        assert_eq!(replay.chunks[0].data, b"cde");
        assert_eq!(replay.chunks[1].data, b"fg");
        assert!(replay.truncated);
    }

    #[test]
    fn filters_already_seen_sequences() {
        let mut buffer = Scrollback::new(100);
        buffer.push(1, b"a");
        buffer.push(2, b"b");
        let replay = buffer.replay_after(1);
        assert_eq!(replay.replayed_through, 2);
        assert_eq!(replay.chunks.len(), 1);
        assert_eq!(replay.chunks[0].data, b"b");
    }
}
