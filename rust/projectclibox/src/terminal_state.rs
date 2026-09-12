use crate::delta_buffer::{DeltaReplay, OutputDeltaBuffer};
use alacritty_terminal::{
    event::{Event, EventListener},
    grid::{Dimensions, Grid},
    index::{Column, Line},
    term::{
        cell::{Cell, Flags},
        Config as TerminalConfig, Term, TermMode,
    },
    vte::ansi::{Color, CursorShape, CursorStyle, NamedColor, Processor},
};
use std::{io::Write as _, mem::size_of};
use tokio::sync::mpsc;

const MAX_HISTORY_ROWS: usize = 50_000;
const APPROXIMATE_ROW_OVERHEAD: usize = 64;
const MAX_DELTA_BYTES: usize = 256 * 1024;

/// Bytes that reproduce one authoritative terminal state. The payload is a
/// synthetic ANSI stream, not a replay of the PTY history.
#[derive(Debug, Clone)]
pub struct TerminalSnapshot {
    pub sequence: u64,
    pub bytes: Vec<u8>,
}

/// An owned, consistent clone of the emulator state. Rendering it can be
/// expensive for a large resolved history, so callers may release the
/// terminal mutex before calling `render`.
pub struct SnapshotCapture {
    sequence: u64,
    terminal: CapturedTerminal,
}

impl SnapshotCapture {
    pub fn render(self) -> TerminalSnapshot {
        TerminalSnapshot {
            sequence: self.sequence,
            bytes: render_snapshot(self.terminal),
        }
    }
}

#[derive(Clone)]
struct PtyEventProxy {
    input_sender: mpsc::Sender<Vec<u8>>,
}

impl EventListener for PtyEventProxy {
    fn send_event(&self, event: Event) {
        if let Event::PtyWrite(text) = event {
            let data = text.into_bytes();
            if let Err(error) = self.input_sender.try_send(data) {
                tracing::debug!(error = %error, "terminal emulator response was not queued");
            }
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct TerminalDimensions {
    rows: usize,
    cols: usize,
}

impl Dimensions for TerminalDimensions {
    fn total_lines(&self) -> usize {
        self.rows
    }

    fn screen_lines(&self) -> usize {
        self.rows
    }

    fn columns(&self) -> usize {
        self.cols
    }
}

/// The server-side terminal emulator. PTY bytes are parsed exactly once into
/// this state. Clients receive either a snapshot of this state or bounded
/// deltas after a known sequence.
pub struct TerminalState {
    processor: Processor,
    term: Term<PtyEventProxy>,
    deltas: OutputDeltaBuffer,
    max_scrollback_bytes: usize,
}

impl TerminalState {
    pub fn new(
        rows: u16,
        cols: u16,
        max_scrollback_bytes: usize,
        input_sender: mpsc::Sender<Vec<u8>>,
    ) -> Self {
        let dimensions = TerminalDimensions {
            rows: usize::from(rows.max(1)),
            cols: usize::from(cols.max(2)),
        };
        let config = TerminalConfig {
            scrolling_history: history_rows(max_scrollback_bytes, dimensions.cols),
            ..TerminalConfig::default()
        };
        Self {
            processor: Processor::new(),
            term: Term::new(config, &dimensions, PtyEventProxy { input_sender }),
            // The reconnect buffer is deliberately much smaller than the
            // resolved terminal history. It is transport recovery state, not
            // a second copy of the terminal's lifetime.
            deltas: OutputDeltaBuffer::new(max_scrollback_bytes.min(MAX_DELTA_BYTES)),
            max_scrollback_bytes,
        }
    }

    pub fn process_output(&mut self, sequence: u64, data: &[u8]) {
        self.processor.advance(&mut self.term, data);
        self.deltas.push(sequence, data);
    }

    pub fn replay_after(&self, from_sequence: u64) -> DeltaReplay {
        self.deltas.replay_after(from_sequence)
    }

    pub fn capture_snapshot(&mut self, sequence: u64) -> SnapshotCapture {
        // `Term` intentionally keeps the inactive screen private. When the
        // alternate screen is active, briefly swapping lets us clone the
        // primary grid too. The active grid is restored immediately after the
        // clone so the PTY continues from the same visual state.
        let capture = if self.term.mode().contains(TermMode::ALT_SCREEN) {
            let alternate = self.term.grid().clone();
            self.term.swap_alt();
            let primary = self.term.grid().clone();
            self.term.swap_alt();
            *self.term.grid_mut() = alternate.clone();
            CapturedTerminal {
                primary,
                alternate: Some(alternate),
                mode: *self.term.mode(),
                cursor_style: self.term.cursor_style(),
            }
        } else {
            CapturedTerminal {
                primary: self.term.grid().clone(),
                alternate: None,
                mode: *self.term.mode(),
                cursor_style: self.term.cursor_style(),
            }
        };

        SnapshotCapture {
            sequence,
            terminal: capture,
        }
    }

    pub fn resize(&mut self, rows: u16, cols: u16) {
        let dimensions = TerminalDimensions {
            rows: usize::from(rows.max(1)),
            cols: usize::from(cols.max(2)),
        };
        self.term.resize(dimensions);

        // A wider terminal consumes more memory per resolved history row. The
        // active grid is adjusted immediately; the alternate grid has no
        // history and is therefore already bounded.
        let rows = history_rows(self.max_scrollback_bytes, dimensions.cols);
        if !self.term.mode().contains(TermMode::ALT_SCREEN) {
            self.term.grid_mut().update_history(rows);
        }
    }

    pub fn delta_bytes(&self) -> usize {
        self.deltas.bytes()
    }

    pub fn delta_truncated(&self) -> bool {
        self.deltas.truncated()
    }

    pub fn estimated_memory_bytes(&self) -> usize {
        let grid = self.term.grid();
        grid.total_lines()
            .saturating_mul(grid.columns())
            .saturating_mul(size_of::<Cell>())
            .saturating_add(self.delta_bytes())
    }
}

fn history_rows(max_bytes: usize, cols: usize) -> usize {
    let per_row = cols
        .saturating_mul(size_of::<Cell>())
        .saturating_add(APPROXIMATE_ROW_OVERHEAD)
        .max(1);
    max_bytes.saturating_div(per_row).clamp(1, MAX_HISTORY_ROWS)
}

struct CapturedTerminal {
    primary: Grid<Cell>,
    alternate: Option<Grid<Cell>>,
    mode: TermMode,
    cursor_style: CursorStyle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct CellStyle {
    fg: Color,
    bg: Color,
    flags: Flags,
}

impl CellStyle {
    fn from_cell(cell: &Cell) -> Self {
        Self {
            fg: cell.fg,
            bg: cell.bg,
            flags: cell.flags
                & (Flags::BOLD
                    | Flags::ITALIC
                    | Flags::ALL_UNDERLINES
                    | Flags::DIM
                    | Flags::INVERSE
                    | Flags::HIDDEN
                    | Flags::STRIKEOUT),
        }
    }
}

fn render_snapshot(capture: CapturedTerminal) -> Vec<u8> {
    let mut output = Vec::new();
    // Start from a known xterm state. The browser resets its xterm instance
    // before applying this stream, and these controls also make the stream
    // safe to apply to an existing instance during resynchronization.
    output.extend_from_slice(b"\x1b[0m\x1b[?25l\x1b[?7l\x1b[2J\x1b[H");
    render_grid(&capture.primary, &mut output);
    write_cursor_position(&capture.primary, &mut output);

    if let Some(alternate) = &capture.alternate {
        output.extend_from_slice(b"\x1b[?1049h\x1b[2J\x1b[H");
        render_grid(alternate, &mut output);
        write_cursor_position(alternate, &mut output);
    }

    write_mode(&mut output, capture.mode, TermMode::APP_CURSOR, 1);
    write_mode(&mut output, capture.mode, TermMode::APP_KEYPAD, 66);
    write_mode(&mut output, capture.mode, TermMode::ORIGIN, 6);
    write_mode(&mut output, capture.mode, TermMode::LINE_WRAP, 7);
    write_standard_mode(&mut output, capture.mode, TermMode::LINE_FEED_NEW_LINE, 20);
    write_mode(&mut output, capture.mode, TermMode::FOCUS_IN_OUT, 1004);
    write_mode(
        &mut output,
        capture.mode,
        TermMode::MOUSE_REPORT_CLICK,
        1000,
    );
    write_mode(&mut output, capture.mode, TermMode::MOUSE_DRAG, 1002);
    write_mode(&mut output, capture.mode, TermMode::MOUSE_MOTION, 1003);
    write_mode(&mut output, capture.mode, TermMode::UTF8_MOUSE, 1005);
    write_mode(&mut output, capture.mode, TermMode::SGR_MOUSE, 1006);
    write_mode(&mut output, capture.mode, TermMode::BRACKETED_PASTE, 2004);
    write_standard_mode(&mut output, capture.mode, TermMode::INSERT, 4);

    if capture.mode.contains(TermMode::SHOW_CURSOR)
        && !matches!(capture.cursor_style.shape, CursorShape::Hidden)
    {
        output.extend_from_slice(b"\x1b[?25h");
    } else {
        output.extend_from_slice(b"\x1b[?25l");
    }
    write_cursor_style(&mut output, capture.cursor_style);
    output.extend_from_slice(b"\x1b[0m");
    output
}

fn render_grid(grid: &Grid<Cell>, output: &mut Vec<u8>) {
    let first = grid.topmost_line().0;
    let last = grid.bottommost_line().0;
    for line_number in first..=last {
        let line = Line(line_number);
        let mut previous_style = None;
        for column in 0..grid.columns() {
            let cell = &grid[line][Column(column)];
            let style = CellStyle::from_cell(cell);
            if previous_style != Some(style) {
                write_style(output, style);
                previous_style = Some(style);
            }
            if cell.flags.contains(Flags::WIDE_CHAR_SPACER) {
                continue;
            }
            let character = if cell.c == '\0' { ' ' } else { cell.c };
            let mut encoded = [0_u8; 4];
            output.extend_from_slice(character.encode_utf8(&mut encoded).as_bytes());
            if let Some(zerowidth) = cell.zerowidth() {
                for character in zerowidth {
                    output.extend_from_slice(character.encode_utf8(&mut encoded).as_bytes());
                }
            }
        }
        output.extend_from_slice(b"\x1b[0m\x1b[K");
        if line_number != last {
            output.extend_from_slice(b"\r\n");
        }
    }
}

fn write_cursor_position(grid: &Grid<Cell>, output: &mut Vec<u8>) {
    let row = grid
        .cursor
        .point
        .line
        .0
        .clamp(0, grid.screen_lines().saturating_sub(1) as i32)
        + 1;
    let column = grid
        .cursor
        .point
        .column
        .0
        .min(grid.columns().saturating_sub(1))
        + 1;
    let _ = write!(output, "\x1b[{row};{column}H");
}

fn write_style(output: &mut Vec<u8>, style: CellStyle) {
    let mut codes = Vec::new();
    append_color_code(&mut codes, style.fg, true);
    append_color_code(&mut codes, style.bg, false);
    if style.flags.contains(Flags::BOLD) {
        codes.push("1".to_owned());
    }
    if style.flags.contains(Flags::DIM) {
        codes.push("2".to_owned());
    }
    if style.flags.contains(Flags::ITALIC) {
        codes.push("3".to_owned());
    }
    if style.flags.intersects(Flags::ALL_UNDERLINES) {
        codes.push("4".to_owned());
    }
    if style.flags.contains(Flags::INVERSE) {
        codes.push("7".to_owned());
    }
    if style.flags.contains(Flags::HIDDEN) {
        codes.push("8".to_owned());
    }
    if style.flags.contains(Flags::STRIKEOUT) {
        codes.push("9".to_owned());
    }

    output.extend_from_slice(b"\x1b[0m");
    if !codes.is_empty() {
        output.extend_from_slice(b"\x1b[");
        output.extend_from_slice(codes.join(";").as_bytes());
        output.push(b'm');
    }
}

fn append_color_code(codes: &mut Vec<String>, color: Color, foreground: bool) {
    let default_code = if foreground { 39 } else { 49 };
    match color {
        Color::Named(named) => {
            let code = match named {
                NamedColor::Black | NamedColor::DimBlack => 30,
                NamedColor::Red | NamedColor::DimRed => 31,
                NamedColor::Green | NamedColor::DimGreen => 32,
                NamedColor::Yellow | NamedColor::DimYellow => 33,
                NamedColor::Blue | NamedColor::DimBlue => 34,
                NamedColor::Magenta | NamedColor::DimMagenta => 35,
                NamedColor::Cyan | NamedColor::DimCyan => 36,
                NamedColor::White | NamedColor::DimWhite => 37,
                NamedColor::BrightBlack => 90,
                NamedColor::BrightRed => 91,
                NamedColor::BrightGreen => 92,
                NamedColor::BrightYellow => 93,
                NamedColor::BrightBlue => 94,
                NamedColor::BrightMagenta => 95,
                NamedColor::BrightCyan => 96,
                NamedColor::BrightWhite => 97,
                NamedColor::Foreground
                | NamedColor::Background
                | NamedColor::Cursor
                | NamedColor::BrightForeground
                | NamedColor::DimForeground => default_code,
            };
            if foreground {
                codes.push(code.to_string());
            } else if code == 39 {
                codes.push("49".to_owned());
            } else {
                codes.push((code + 10).to_string());
            }
        }
        Color::Indexed(index) => {
            codes.push(if foreground { "38" } else { "48" }.to_owned());
            codes.push("5".to_owned());
            codes.push(index.to_string());
        }
        Color::Spec(rgb) => {
            codes.push(if foreground { "38" } else { "48" }.to_owned());
            codes.push("2".to_owned());
            codes.push(rgb.r.to_string());
            codes.push(rgb.g.to_string());
            codes.push(rgb.b.to_string());
        }
    }
}

fn write_mode(output: &mut Vec<u8>, mode: TermMode, flag: TermMode, code: u16) {
    let _ = write!(
        output,
        "\x1b[?{code}{}",
        if mode.contains(flag) { 'h' } else { 'l' }
    );
}

fn write_standard_mode(output: &mut Vec<u8>, mode: TermMode, flag: TermMode, code: u16) {
    let _ = write!(
        output,
        "\x1b[{code}{}",
        if mode.contains(flag) { 'h' } else { 'l' }
    );
}

fn write_cursor_style(output: &mut Vec<u8>, style: CursorStyle) {
    let code = match style.shape {
        CursorShape::Block | CursorShape::HollowBlock => {
            if style.blinking {
                1
            } else {
                2
            }
        }
        CursorShape::Underline => {
            if style.blinking {
                3
            } else {
                4
            }
        }
        CursorShape::Beam => {
            if style.blinking {
                5
            } else {
                6
            }
        }
        CursorShape::Hidden => 0,
    };
    if code != 0 {
        let _ = write!(output, "\x1b[{code} q");
    }
}

#[cfg(test)]
mod tests {
    use super::TerminalState;
    use alacritty_terminal::{
        event::VoidListener,
        grid::Dimensions,
        term::{Config as TerminalConfig, Term},
        vte::ansi::{Color, NamedColor, Processor, Rgb},
    };
    use tokio::sync::mpsc;

    fn state(rows: u16, cols: u16) -> TerminalState {
        let (sender, _receiver) = mpsc::channel(8);
        TerminalState::new(rows, cols, 16 * 1024, sender)
    }

    fn render_into_fresh_term(bytes: &[u8], rows: u16, cols: u16) -> Term<VoidListener> {
        let dimensions = super::TerminalDimensions {
            rows: usize::from(rows),
            cols: usize::from(cols),
        };
        let mut term = Term::new(TerminalConfig::default(), &dimensions, VoidListener);
        let mut processor: Processor = Processor::new();
        processor.advance(&mut term, bytes);
        term
    }

    fn active_text(term: &Term<VoidListener>) -> String {
        let grid = term.grid();
        let mut text = String::new();
        for line in grid.topmost_line().0..=grid.bottommost_line().0 {
            for column in 0..grid.columns() {
                let cell = &grid[alacritty_terminal::index::Line(line)]
                    [alacritty_terminal::index::Column(column)];
                if !cell
                    .flags
                    .contains(alacritty_terminal::term::cell::Flags::WIDE_CHAR_SPACER)
                {
                    text.push(cell.c);
                }
            }
            text.push('\n');
        }
        text
    }

    fn screen_text(term: &Term<VoidListener>) -> String {
        let grid = term.grid();
        let first = grid.bottommost_line().0 - grid.screen_lines() as i32 + 1;
        let mut text = String::new();
        for line in first..=grid.bottommost_line().0 {
            for column in 0..grid.columns() {
                let cell = &grid[alacritty_terminal::index::Line(line)]
                    [alacritty_terminal::index::Column(column)];
                if !cell
                    .flags
                    .contains(alacritty_terminal::term::cell::Flags::WIDE_CHAR_SPACER)
                {
                    text.push(cell.c);
                }
            }
            text.push('\n');
        }
        text
    }

    #[test]
    fn progress_output_is_resolved_before_snapshot() {
        let mut state = state(4, 40);
        let mut output = String::new();
        for percent in 0..=100 {
            output.push_str(&format!("\rprogress {percent:03}%"));
        }
        output.push_str("\r\nComplete");
        state.process_output(8, output.as_bytes());
        let snapshot = state.capture_snapshot(8).render();
        assert!(snapshot
            .bytes
            .windows(b"progress 100%".len())
            .any(|window| { window == b"progress 100%" }));
        assert!(!snapshot
            .bytes
            .windows(b"progress 005%".len())
            .any(|window| { window == b"progress 005%" }));
        assert!(!snapshot
            .bytes
            .windows(b"progress 055%".len())
            .any(|window| { window == b"progress 055%" }));
        let term = render_into_fresh_term(&snapshot.bytes, 4, 40);
        let text = active_text(&term);
        assert!(text.contains("progress 100%"));
        assert!(!text.contains("progress 005%"));
        assert!(!text.contains("progress 055%"));
        assert!(text.contains("Complete"));
    }

    #[test]
    fn cursor_and_erase_controls_are_resolved_before_snapshot() {
        let mut state = state(3, 40);
        state.process_output(
            32,
            b"old text\rnew\x1b[K\r\nsecond line\r\nthird line\x1b[2A\x1b[1GUP\x1b[1B\x1b[1Gabc\x08X\x1b[1B\x1b[1G\x1b[2Kreplaced",
        );
        let snapshot = state.capture_snapshot(32).render();
        let term = render_into_fresh_term(&snapshot.bytes, 3, 40);
        let text = active_text(&term);
        assert!(text.contains("UPw"));
        assert!(!text.contains("old text"));
        assert!(text.contains("UP"));
        assert!(text.contains("abX"));
        assert!(text.contains("replaced"));
        assert_eq!(term.grid().cursor.point.line.0, 2);
        assert_eq!(term.grid().cursor.point.column.0, 8);

        state.process_output(33, b"\x1b[2J\x1b[Hfinal");
        let cleared = render_into_fresh_term(&state.capture_snapshot(33).render().bytes, 3, 40);
        let cleared_text = screen_text(&cleared);
        assert!(cleared_text.contains("final"));
        assert!(!cleared_text.contains("replaced"));
        assert!(!cleared_text.contains("second line"));
    }

    #[test]
    fn colors_and_text_attributes_are_preserved_as_state() {
        let mut state = state(3, 80);
        state.process_output(
            34,
            b"\x1b[31;44;1;3;4mstyled\x1b[0m \x1b[38;5;123;48;5;200mindexed\x1b[0m \x1b[38;2;12;34;56;48;2;65;43;21mtrue\x1b[0m",
        );
        let snapshot = state.capture_snapshot(34).render();
        let term = render_into_fresh_term(&snapshot.bytes, 3, 80);
        let styled =
            &term.grid()[alacritty_terminal::index::Line(0)][alacritty_terminal::index::Column(0)];
        assert_eq!(styled.fg, Color::Named(NamedColor::Red));
        assert_eq!(styled.bg, Color::Named(NamedColor::Blue));
        assert!(styled
            .flags
            .contains(alacritty_terminal::term::cell::Flags::BOLD));
        assert!(styled
            .flags
            .contains(alacritty_terminal::term::cell::Flags::ITALIC));
        assert!(styled
            .flags
            .contains(alacritty_terminal::term::cell::Flags::UNDERLINE));

        let indexed =
            &term.grid()[alacritty_terminal::index::Line(0)][alacritty_terminal::index::Column(7)];
        assert_eq!(indexed.fg, Color::Indexed(123));
        assert_eq!(indexed.bg, Color::Indexed(200));

        let true_color =
            &term.grid()[alacritty_terminal::index::Line(0)][alacritty_terminal::index::Column(15)];
        assert_eq!(
            true_color.fg,
            Color::Spec(Rgb {
                r: 12,
                g: 34,
                b: 56
            })
        );
        assert_eq!(
            true_color.bg,
            Color::Spec(Rgb {
                r: 65,
                g: 43,
                b: 21
            })
        );
        let reset =
            &term.grid()[alacritty_terminal::index::Line(0)][alacritty_terminal::index::Column(20)];
        assert!(!reset
            .flags
            .contains(alacritty_terminal::term::cell::Flags::BOLD));
    }

    #[test]
    fn resolved_scrollback_is_available_without_redraw_history() {
        let mut state = state(3, 40);
        for index in 0..120 {
            state.process_output(index + 1, format!("resolved line {index}\r\n").as_bytes());
        }
        let snapshot = state.capture_snapshot(120).render();
        let term = render_into_fresh_term(&snapshot.bytes, 3, 40);
        let text = active_text(&term);
        assert!(text.contains("resolved line 119"));
        assert!(text.contains("resolved line 110"));
        assert!(snapshot.bytes.len() < 40 * 1024);
    }

    #[test]
    fn alternate_screen_snapshot_keeps_primary_screen() {
        let mut state = state(3, 30);
        state.process_output(7, b"primary\x1b[?1049h\x1b[2J\x1b[Halt screen v1");
        state.process_output(8, b"\x1b[2;1Hupdated\x1b[1A\x1b[1GALT");
        let alt_snapshot = state.capture_snapshot(8).render();
        let alt_term = render_into_fresh_term(&alt_snapshot.bytes, 3, 30);
        assert!(alt_term
            .mode()
            .contains(alacritty_terminal::term::TermMode::ALT_SCREEN));
        assert!(active_text(&alt_term).contains("ALT"));
        assert!(active_text(&alt_term).contains("updated"));

        state.process_output(14, b"\x1b[?1049l");
        let primary_snapshot = state.capture_snapshot(14).render();
        let primary_term = render_into_fresh_term(&primary_snapshot.bytes, 3, 30);
        assert!(!primary_term
            .mode()
            .contains(alacritty_terminal::term::TermMode::ALT_SCREEN));
        assert!(active_text(&primary_term).contains("primary"));
        assert!(!active_text(&primary_term).contains("alt screen"));
    }

    #[test]
    fn history_is_bounded_by_rows_and_deltas_are_separate() {
        let mut state = state(2, 20);
        for index in 0..100 {
            state.process_output(index + 1, format!("line {index}\r\n").as_bytes());
        }
        assert!(state.estimated_memory_bytes() < 20_000);
        assert!(state.delta_bytes() <= 16 * 1024);
    }

    #[test]
    fn resize_updates_authoritative_dimensions() {
        let mut state = state(2, 20);
        state.resize(5, 60);
        state.process_output(1, b"resized");
        let snapshot = state.capture_snapshot(1).render();
        let term = render_into_fresh_term(&snapshot.bytes, 5, 60);
        assert_eq!(term.screen_lines(), 5);
        assert_eq!(term.columns(), 60);
        assert!(active_text(&term).contains("resized"));
    }

    #[test]
    fn input_responses_are_forwarded_to_pty_queue() {
        let (sender, mut receiver) = mpsc::channel(8);
        let mut state = TerminalState::new(2, 20, 1024, sender);
        state.process_output(1, b"\x1b[6n");
        let response = receiver.try_recv().expect("DSR response");
        assert_eq!(response, b"\x1b[1;1R");
    }
}
