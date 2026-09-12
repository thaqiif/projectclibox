use crate::{
    error::{AppError, AppResult},
    models::{SessionId, SessionRecord, SessionSnapshot, SessionStatus},
    scrollback::{OutputChunk, Replay, Scrollback},
};
use chrono::Utc;
use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
#[cfg(target_os = "linux")]
use std::{collections::HashSet, fs};
use std::{
    io::{ErrorKind, Read, Write},
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tokio::sync::{broadcast, mpsc, watch};

const OUTPUT_READ_SIZE: usize = 16 * 1024;
const INPUT_QUEUE_SIZE: usize = 64;
const MAX_INPUT_BYTES: usize = 64 * 1024;
const TERMINATE_GRACE: Duration = Duration::from_secs(2);

#[cfg(unix)]
const SESSION_WRAPPER_SCRIPT: &str = r#"
termination_requested=0
mark_termination() {
    termination_requested=1
}
ignore_interrupt() {
    :
}
trap mark_termination TERM HUP
trap ignore_interrupt INT
"$@"
status=$?
if [ "$termination_requested" -ne 0 ]; then
    # Keep this server-owned marker process alive until the process-group
    # reaper's escalation. This covers a command that forks from a TERM
    # handler after its original process has already exited.
    trap ':' TERM HUP INT
    sleep 3
else
    # Leave a short-lived marked anchor behind after a natural command exit.
    # The supervisor can then catch descendants that fork while its cleanup
    # TERM is being delivered, even if the original shell exits first.
    ( trap ':' TERM HUP INT; sleep 3 ) &
fi
trap - TERM INT HUP
exit "$status"
"#;

#[derive(Clone)]
pub struct SessionHandle {
    inner: Arc<SessionInner>,
}

struct SessionInner {
    record: Mutex<SessionRecord>,
    scrollback: Mutex<Scrollback>,
    output_sender: broadcast::Sender<OutputChunk>,
    status_sender: watch::Sender<SessionSnapshot>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    input_sender: Mutex<Option<mpsc::Sender<Vec<u8>>>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    viewers: AtomicUsize,
    termination_requested: AtomicBool,
    cleanup_pending: Arc<AtomicBool>,
    idle_after: Duration,
}

pub struct AttachedSession {
    pub replay: Replay,
    pub receiver: broadcast::Receiver<OutputChunk>,
}

pub(crate) struct SessionSpawnOptions<'a> {
    pub id: SessionId,
    pub name: String,
    pub project_id: Option<String>,
    pub cwd: &'a Path,
    pub runtime_marker: &'a Path,
    pub command: Vec<String>,
    pub rows: u16,
    pub cols: u16,
    pub max_scrollback_bytes: usize,
    pub idle_after_secs: u64,
}

impl SessionHandle {
    pub fn spawn(options: SessionSpawnOptions<'_>) -> AppResult<Self> {
        let SessionSpawnOptions {
            id,
            name,
            project_id,
            cwd,
            runtime_marker,
            command,
            rows,
            cols,
            max_scrollback_bytes,
            idle_after_secs,
        } = options;
        if command.is_empty() || command[0].trim().is_empty() {
            return Err(AppError::Session("command cannot be empty".to_owned()));
        }
        let now = Utc::now();
        let record = SessionRecord {
            id,
            name,
            project_id,
            working_directory: cwd.to_string_lossy().into_owned(),
            command: command.clone(),
            status: SessionStatus::Starting,
            child_pid: None,
            process_group: None,
            rows,
            cols,
            created_at: now,
            started_at: None,
            ended_at: None,
            last_activity_at: now,
            last_attached_at: None,
            exit_code: None,
            exit_signal: None,
            output_bytes: 0,
        };

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| AppError::Session(format!("open PTY: {error}")))?;

        #[cfg(unix)]
        let mut command_builder = {
            // Keep a small, server-owned shell parent in the process group.
            // A user command can clear its own environment, but it cannot
            // erase the marker from this parent before a crash reaper sees it.
            let mut builder = CommandBuilder::new("/bin/sh");
            builder.args([
                "-c",
                SESSION_WRAPPER_SCRIPT,
                "projectclibox-session-wrapper",
            ]);
            builder.args(command.iter());
            builder
        };
        #[cfg(not(unix))]
        let mut command_builder = CommandBuilder::from_argv(
            command
                .iter()
                .map(std::ffi::OsString::from)
                .collect::<Vec<_>>(),
        );
        command_builder.cwd(cwd);
        command_builder.env_clear();
        for (key, value) in std::env::vars_os() {
            // The control-plane token is never useful to a terminal process.
            // Keeping it out of the child environment prevents `env` and
            // shell scripts from turning service authentication into a
            // workspace secret.
            if key == "PROJECTCLIBOX_AUTH_TOKEN" {
                continue;
            }
            command_builder.env(key, value);
        }
        command_builder.env(
            "PROJECTCLIBOX_RUNTIME_DB",
            runtime_marker.to_string_lossy().as_ref(),
        );
        command_builder.env("PROJECTCLIBOX_SESSION_ID", id.to_string());
        command_builder.env("TERM", "xterm-256color");
        command_builder.env("COLORTERM", "truecolor");

        let mut child = pair
            .slave
            .spawn_command(command_builder)
            .map_err(|error| AppError::Session(format!("spawn process: {error}")))?;
        let child_pid = child.process_id();
        let process_group = pair
            .master
            .process_group_leader()
            .or_else(|| child_pid.map(|pid| pid as i32));
        let killer = child.clone_killer();
        let reader = match pair.master.try_clone_reader() {
            Ok(reader) => reader,
            Err(error) => {
                abort_spawned_child(&mut child, process_group, id);
                return Err(AppError::Session(format!("clone PTY reader: {error}")));
            }
        };
        let writer = match pair.master.take_writer() {
            Ok(writer) => writer,
            Err(error) => {
                abort_spawned_child(&mut child, process_group, id);
                return Err(AppError::Session(format!("take PTY writer: {error}")));
            }
        };
        let child_slot = Arc::new(Mutex::new(Some(child)));
        let (output_sender, _) = broadcast::channel(1024);
        let initial_snapshot = snapshot_from_record(&record, 0, 0, false, idle_after_secs);
        let (status_sender, _) = watch::channel(initial_snapshot);
        let (input_sender, input_receiver) = mpsc::channel(INPUT_QUEUE_SIZE);
        let inner = Arc::new(SessionInner {
            record: Mutex::new(record),
            scrollback: Mutex::new(Scrollback::new(max_scrollback_bytes)),
            output_sender,
            status_sender,
            master: Mutex::new(pair.master),
            input_sender: Mutex::new(Some(input_sender)),
            killer: Mutex::new(killer),
            viewers: AtomicUsize::new(0),
            termination_requested: AtomicBool::new(false),
            cleanup_pending: Arc::new(AtomicBool::new(false)),
            idle_after: Duration::from_secs(idle_after_secs),
        });
        let handle = Self { inner };

        {
            let mut record = handle.inner.record.lock().expect("session record mutex");
            record.status = SessionStatus::Running;
            record.child_pid = child_pid;
            record.process_group = process_group;
            record.started_at = Some(now);
        }
        handle.publish_status();

        let reader_handle = handle.clone();
        if let Err(error) = thread::Builder::new()
            .name(format!("pty-reader-{id}"))
            .spawn(move || read_output(reader, reader_handle))
        {
            abort_spawned_child_slot(&child_slot, process_group, id);
            return Err(AppError::Session(format!("start PTY reader: {error}")));
        }

        let input_handle = handle.clone();
        if let Err(error) = thread::Builder::new()
            .name(format!("pty-writer-{id}"))
            .spawn(move || write_input(writer, input_receiver, input_handle))
        {
            abort_spawned_child_slot(&child_slot, process_group, id);
            return Err(AppError::Session(format!("start PTY writer: {error}")));
        }

        let wait_handle = handle.clone();
        let wait_child_slot = child_slot.clone();
        if let Err(error) = thread::Builder::new()
            .name(format!("pty-wait-{id}"))
            .spawn(move || {
                let Some(mut child) = wait_child_slot.lock().expect("child slot mutex").take()
                else {
                    return;
                };
                wait_for_child(&mut child, wait_handle);
            })
        {
            abort_spawned_child_slot(&child_slot, process_group, id);
            return Err(AppError::Session(format!("start PTY waiter: {error}")));
        }

        Ok(handle)
    }

    pub fn id(&self) -> SessionId {
        self.inner.record.lock().expect("session record mutex").id
    }

    pub fn name(&self) -> String {
        self.inner
            .record
            .lock()
            .expect("session record mutex")
            .name
            .clone()
    }

    pub fn rename(&self, name: String) {
        {
            let mut record = self.inner.record.lock().expect("session record mutex");
            record.name = name;
        }
        self.publish_status();
    }

    pub fn record(&self) -> SessionRecord {
        self.inner
            .record
            .lock()
            .expect("session record mutex")
            .clone()
    }

    pub fn snapshot(&self) -> SessionSnapshot {
        let record = self
            .inner
            .record
            .lock()
            .expect("session record mutex")
            .clone();
        let scrollback = self.inner.scrollback.lock().expect("scrollback mutex");
        snapshot_from_record(
            &record,
            self.inner.viewers.load(Ordering::Relaxed),
            scrollback.bytes(),
            scrollback.truncated(),
            self.inner.idle_after.as_secs(),
        )
    }

    pub fn subscribe_status(&self) -> watch::Receiver<SessionSnapshot> {
        self.inner.status_sender.subscribe()
    }

    pub fn attach(&self, from_sequence: u64) -> AttachedSession {
        // Subscribe before taking the replay snapshot. Any output published
        // after this point is either in the snapshot or in the receiver; the
        // WS writer filters receiver events through replayed_through, so a
        // reconnect cannot duplicate buffered output.
        let receiver = self.inner.output_sender.subscribe();
        let replay = self
            .inner
            .scrollback
            .lock()
            .expect("scrollback mutex")
            .replay_after(from_sequence);
        self.inner.viewers.fetch_add(1, Ordering::Relaxed);
        {
            let mut record = self.inner.record.lock().expect("session record mutex");
            record.last_attached_at = Some(Utc::now());
            if record.status == SessionStatus::Disconnected {
                record.status = SessionStatus::Running;
            }
        }
        self.publish_status();
        AttachedSession { replay, receiver }
    }

    pub fn replay_after(&self, from_sequence: u64) -> Replay {
        self.inner
            .scrollback
            .lock()
            .expect("scrollback mutex")
            .replay_after(from_sequence)
    }

    pub fn detach(&self) {
        self.inner
            .viewers
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
                value.checked_sub(1)
            })
            .ok();
        if self.inner.viewers.load(Ordering::Relaxed) == 0 {
            let mut record = self.inner.record.lock().expect("session record mutex");
            if matches!(record.status, SessionStatus::Running | SessionStatus::Idle) {
                record.status = SessionStatus::Disconnected;
            }
        }
        self.publish_status();
    }

    pub fn write_input(&self, data: String) -> AppResult<()> {
        let bytes = data.into_bytes();
        if bytes.is_empty() {
            return Ok(());
        }
        if bytes.len() > MAX_INPUT_BYTES {
            return Err(AppError::BadRequest(format!(
                "terminal input exceeds {MAX_INPUT_BYTES} bytes"
            )));
        }
        let sender = self
            .inner
            .input_sender
            .lock()
            .expect("input sender mutex")
            .clone()
            .ok_or_else(|| AppError::Session("terminal process has exited".to_owned()))?;
        sender
            .try_send(bytes)
            .map_err(|error| AppError::Session(format!("terminal input queue is full: {error}")))
    }

    pub fn resize(&self, cols: u16, rows: u16) -> AppResult<()> {
        if cols == 0 || rows == 0 || cols > 1000 || rows > 500 {
            return Err(AppError::BadRequest(
                "terminal size is outside 1..=1000 columns and 1..=500 rows".to_owned(),
            ));
        }
        self.inner
            .master
            .lock()
            .expect("master PTY mutex")
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| AppError::Session(format!("resize PTY: {error}")))?;
        {
            let mut record = self.inner.record.lock().expect("session record mutex");
            record.rows = rows;
            record.cols = cols;
        }
        self.publish_status();
        Ok(())
    }

    pub fn terminate(&self) -> AppResult<()> {
        if !self
            .inner
            .termination_requested
            .swap(true, Ordering::AcqRel)
        {
            {
                let mut record = self.inner.record.lock().expect("session record mutex");
                if record.status.is_live() {
                    record.status = SessionStatus::Terminating;
                }
            }
            self.publish_status();
            let record = self.record();
            let process_group = record
                .process_group
                .or_else(|| record.child_pid.map(|pid| pid as i32));
            if process_group.is_some() {
                self.schedule_process_group_cleanup(process_group);
            } else {
                let mut killer = self.inner.killer.lock().expect("child killer mutex");
                let _ = killer.kill();
            }
        }
        Ok(())
    }

    pub fn is_live(&self) -> bool {
        self.record().status.is_live()
    }

    pub fn termination_requested(&self) -> bool {
        self.inner.termination_requested.load(Ordering::Acquire)
    }

    pub(crate) fn cleanup_pending(&self) -> bool {
        self.inner.cleanup_pending.load(Ordering::Acquire)
    }

    fn schedule_process_group_cleanup(&self, process_group: Option<i32>) {
        if process_group.is_none() {
            return;
        }
        self.inner.cleanup_pending.store(true, Ordering::Release);
        stop_process_group(
            process_group,
            self.id(),
            Some(self.inner.cleanup_pending.clone()),
        );
    }

    fn publish_output(&self, data: &[u8]) {
        if data.is_empty() {
            return;
        }
        let (sequence, became_active) = {
            let mut record = self.inner.record.lock().expect("session record mutex");
            record.last_activity_at = Utc::now();
            record.output_bytes = record.output_bytes.saturating_add(data.len() as u64);
            let became_active = record.status == SessionStatus::Idle;
            if became_active {
                record.status = SessionStatus::Running;
            }
            (record.output_bytes, became_active)
        };
        let chunk_sequence = sequence;
        let chunk = OutputChunk {
            sequence: chunk_sequence,
            data: data.to_vec(),
        };
        {
            let mut scrollback = self.inner.scrollback.lock().expect("scrollback mutex");
            scrollback.push(chunk_sequence, data);
        }
        let _ = self.inner.output_sender.send(chunk);
        // Only state transitions need a persistence notification. Output
        // bytes and activity are retained in the in-memory object and are
        // persisted on exit, avoiding one SQLite write per PTY read.
        if became_active {
            let _ = self.inner.status_sender.send(self.snapshot());
        }
    }

    fn finish(&self, status: portable_pty::ExitStatus) {
        let process_group = {
            let mut record = self.inner.record.lock().expect("session record mutex");
            if record.status.is_finished() {
                return;
            }
            let process_group = record.process_group;
            let exit_code = status.exit_code() as i32;
            record.exit_code = Some(exit_code);
            record.exit_signal = status.signal().and_then(signal_number);
            record.ended_at = Some(Utc::now());
            record.status =
                if self.inner.termination_requested.load(Ordering::Acquire) || status.success() {
                    SessionStatus::Exited
                } else {
                    SessionStatus::Failed
                };
            record.child_pid = None;
            record.process_group = None;
            self.inner
                .input_sender
                .lock()
                .expect("input sender mutex")
                .take();
            process_group
        };
        // If the shell exits while it has background descendants, terminate
        // the recorded PTY process group so those descendants cannot become
        // orphaned after the session has been marked finished.
        if !self.inner.termination_requested.load(Ordering::Acquire) {
            self.schedule_process_group_cleanup(process_group);
        }
        tracing::debug!(session_id = %self.id(), "PTY session finalized");
        self.publish_status();
    }

    fn publish_status(&self) {
        let _ = self.inner.status_sender.send(self.snapshot());
    }
}

fn read_output(mut reader: Box<dyn Read + Send>, handle: SessionHandle) {
    let mut buffer = vec![0_u8; OUTPUT_READ_SIZE];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(length) => handle.publish_output(&buffer[..length]),
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(error) => {
                tracing::debug!(session_id = %handle.id(), error = %error, "PTY reader ended");
                break;
            }
        }
    }
}

fn write_input(
    mut writer: Box<dyn Write + Send>,
    mut receiver: mpsc::Receiver<Vec<u8>>,
    handle: SessionHandle,
) {
    while let Some(data) = receiver.blocking_recv() {
        if let Err(error) = writer.write_all(&data).and_then(|()| writer.flush()) {
            tracing::debug!(session_id = %handle.id(), error = %error, "PTY writer ended");
            break;
        }
    }
}

fn abort_spawned_child(
    child: &mut Box<dyn Child + Send + Sync>,
    process_group: Option<i32>,
    session_id: SessionId,
) {
    let _ = child.kill();
    stop_process_group(process_group, session_id, None);
    let _ = child.wait();
}

fn abort_spawned_child_slot(
    child_slot: &Arc<Mutex<Option<Box<dyn Child + Send + Sync>>>>,
    process_group: Option<i32>,
    session_id: SessionId,
) {
    let child = child_slot.lock().expect("child slot mutex").take();
    if let Some(mut child) = child {
        abort_spawned_child(&mut child, process_group, session_id);
    } else {
        stop_process_group(process_group, session_id, None);
    }
}

fn wait_for_child(child: &mut Box<dyn Child + Send + Sync>, handle: SessionHandle) {
    tracing::debug!(session_id = %handle.id(), "waiting for PTY child");
    match child.wait() {
        Ok(status) => {
            tracing::debug!(session_id = %handle.id(), "PTY child reaped");
            handle.finish(status)
        }
        Err(error) => {
            tracing::error!(session_id = %handle.id(), error = %error, "PTY child wait failed");
            let process_group = {
                let mut record = handle.inner.record.lock().expect("session record mutex");
                let process_group = record.process_group;
                record.status = SessionStatus::Failed;
                record.ended_at = Some(Utc::now());
                record.child_pid = None;
                record.process_group = None;
                process_group
            };
            if !handle.inner.termination_requested.load(Ordering::Acquire) {
                handle.schedule_process_group_cleanup(process_group);
            }
            handle.publish_status();
        }
    }
}

pub(crate) fn snapshot_from_record(
    record: &SessionRecord,
    viewers: usize,
    scrollback_bytes: usize,
    scrollback_truncated: bool,
    idle_after_secs: u64,
) -> SessionSnapshot {
    let now = Utc::now();
    let mut status = record.status;
    if status == SessionStatus::Running
        && (now - record.last_activity_at).num_seconds() >= idle_after_secs as i64
    {
        status = SessionStatus::Idle;
    }
    let runtime_end = record.ended_at.unwrap_or(now);
    let runtime_ms = (runtime_end - record.started_at.unwrap_or(record.created_at))
        .num_milliseconds()
        .max(0) as u64;
    SessionSnapshot {
        id: record.id,
        name: record.name.clone(),
        project_id: record.project_id.clone(),
        working_directory: record.working_directory.clone(),
        command: record.command.clone(),
        status,
        child_pid: record.child_pid,
        process_group: record.process_group,
        rows: record.rows,
        cols: record.cols,
        attached_viewers: viewers,
        created_at: record.created_at,
        started_at: record.started_at,
        ended_at: record.ended_at,
        last_activity_at: record.last_activity_at,
        last_attached_at: record.last_attached_at,
        runtime_ms,
        exit_code: record.exit_code,
        exit_signal: record.exit_signal,
        output_bytes: record.output_bytes,
        scrollback_bytes,
        scrollback_truncated,
        cpu_percent: None,
        memory_bytes: None,
        process_count: None,
    }
}

fn signal_number(value: &str) -> Option<i32> {
    let normalized = value.to_ascii_uppercase();
    let normalized = normalized.strip_prefix("SIG").unwrap_or(&normalized);
    match normalized {
        "HUP" => Some(1),
        "INT" => Some(2),
        "QUIT" => Some(3),
        "KILL" => Some(9),
        "TERM" => Some(15),
        "PIPE" => Some(13),
        "SEGV" => Some(11),
        "ABRT" => Some(6),
        _ => None,
    }
}

#[derive(Clone, Copy)]
enum LibcSignal {
    Term,
    Kill,
}
use LibcSignal as libc_signal;

pub(crate) fn stop_recorded_process_group(process_group: Option<i32>, session_id: SessionId) {
    stop_process_group(process_group, session_id, None);
}

pub(crate) fn stop_marked_process_groups(runtime_marker: &Path) {
    #[cfg(target_os = "linux")]
    {
        let Ok(entries) = fs::read_dir("/proc") else {
            return;
        };
        let marker = runtime_marker.to_string_lossy();
        let marker = format!("PROJECTCLIBOX_RUNTIME_DB={marker}");
        let mut groups = HashSet::new();
        for entry in entries.filter_map(Result::ok) {
            let Some(pid) = entry
                .file_name()
                .to_str()
                .and_then(|value| value.parse::<i32>().ok())
            else {
                continue;
            };
            let Ok(environment) = fs::read(format!("/proc/{pid}/environ")) else {
                continue;
            };
            if !environment
                .split(|byte| *byte == 0)
                .any(|value| value == marker.as_bytes())
            {
                continue;
            }
            let Some(identity) = process_identity(pid, process_group_of_pid(pid).unwrap_or(-1))
            else {
                continue;
            };
            groups.insert(identity.process_group);
        }
        for process_group in groups {
            stop_process_group(Some(process_group), SessionId::new(), None);
        }
    }

    #[cfg(not(target_os = "linux"))]
    let _ = runtime_marker;
}

fn stop_process_group(
    process_group: Option<i32>,
    session_id: SessionId,
    completion: Option<Arc<AtomicBool>>,
) {
    let Some(process_group) = process_group else {
        if let Some(completion) = completion {
            completion.store(false, Ordering::Release);
        }
        return;
    };

    #[cfg(target_os = "linux")]
    {
        // A delayed killpg(process_group, SIGKILL) can hit an unrelated
        // session if the original group leader PID is reused during the
        // grace period. Snapshot (pid, /proc start-time) identities and
        // signal those exact processes instead.
        let initial_members = process_group_members(process_group);
        signal_process_members(&initial_members, libc_signal::Term);
        if initial_members.is_empty() {
            if let Some(completion) = completion {
                completion.store(false, Ordering::Release);
            }
            return;
        }
        let completion_for_thread = completion.clone();
        let result = thread::Builder::new()
            .name(format!("pty-group-cleanup-{session_id}"))
            .spawn(move || {
                // Refresh membership during the grace period so a child
                // forked by a TERM handler is included in the final kill.
                // Never trust a bare PGID: keep an identity anchor to avoid
                // signalling a group that was reused after the session died.
                let deadline = Instant::now() + TERMINATE_GRACE;
                let mut members = initial_members;
                while Instant::now() < deadline {
                    thread::sleep(Duration::from_millis(50));
                    if !members
                        .iter()
                        .any(|identity| process_identity_is_current(*identity))
                    {
                        break;
                    }
                    for member in process_group_members(process_group) {
                        if !members.iter().any(|known| same_process(*known, member)) {
                            members.push(member);
                        }
                    }
                }
                let anchored = members
                    .iter()
                    .any(|identity| process_identity_is_current(*identity));
                let forced = if anchored {
                    let count = process_group_members(process_group).len();
                    let _ = signal_process_group(process_group, libc_signal::Kill);
                    count
                } else {
                    members
                        .into_iter()
                        .filter(|member| {
                            process_identity_is_current(*member)
                                && signal_process(member.pid, libc_signal::Kill).is_ok()
                        })
                        .count()
                };
                if forced > 0 {
                    tracing::warn!(
                        session_id = %session_id,
                        process_group,
                        forced,
                        "forced process-group termination after session completion"
                    );
                }
                if let Some(completion) = completion_for_thread {
                    completion.store(false, Ordering::Release);
                }
            });
        if let Err(error) = result {
            tracing::error!(session_id = %session_id, process_group, error = %error, "failed to start process-group cleanup");
            if let Some(completion) = completion {
                completion.store(false, Ordering::Release);
            }
        }
    }

    #[cfg(all(unix, not(target_os = "linux")))]
    {
        let _ = killer_signal(Some(process_group), libc_signal::Term);
        let completion_for_thread = completion.clone();
        let result = thread::Builder::new()
            .name(format!("pty-group-cleanup-{session_id}"))
            .spawn(move || {
                thread::sleep(TERMINATE_GRACE);
                let _ = killer_signal(Some(process_group), libc_signal::Kill);
                tracing::warn!(
                    session_id = %session_id,
                    process_group,
                    "forced process-group termination after session completion"
                );
                if let Some(completion) = completion_for_thread {
                    completion.store(false, Ordering::Release);
                }
            });
        if let Err(error) = result {
            tracing::error!(session_id = %session_id, process_group, error = %error, "failed to start process-group cleanup");
            if let Some(completion) = completion {
                completion.store(false, Ordering::Release);
            }
        }
    }

    #[cfg(not(unix))]
    if let Some(completion) = completion {
        completion.store(false, Ordering::Release);
    }
}

#[cfg(target_os = "linux")]
#[derive(Clone, Copy)]
struct ProcessIdentity {
    pid: i32,
    process_group: i32,
    start_time: u64,
}

#[cfg(target_os = "linux")]
fn process_group_members(process_group: i32) -> Vec<ProcessIdentity> {
    if process_group <= 0 {
        return Vec::new();
    }
    let Ok(entries) = fs::read_dir("/proc") else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let pid = entry.file_name().to_str()?.parse::<i32>().ok()?;
            process_identity(pid, process_group)
        })
        .collect()
}

#[cfg(target_os = "linux")]
fn process_identity(pid: i32, expected_process_group: i32) -> Option<ProcessIdentity> {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let fields = stat
        .rsplit_once(") ")?
        .1
        .split_whitespace()
        .collect::<Vec<_>>();
    // After the command name, fields start at /proc's field 3: state,
    // ppid, pgrp, ..., starttime (field 22).
    let process_group = fields.get(2)?.parse::<i32>().ok()?;
    if process_group != expected_process_group {
        return None;
    }
    Some(ProcessIdentity {
        pid,
        process_group,
        start_time: fields.get(19)?.parse::<u64>().ok()?,
    })
}

#[cfg(target_os = "linux")]
fn process_identity_is_current(identity: ProcessIdentity) -> bool {
    process_identity(identity.pid, identity.process_group).is_some_and(|current| {
        current.pid == identity.pid && current.start_time == identity.start_time
    })
}

#[cfg(target_os = "linux")]
fn same_process(left: ProcessIdentity, right: ProcessIdentity) -> bool {
    left.pid == right.pid && left.start_time == right.start_time
}

#[cfg(target_os = "linux")]
fn process_group_of_pid(pid: i32) -> Option<i32> {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    stat.rsplit_once(") ")?
        .1
        .split_whitespace()
        .nth(2)?
        .parse()
        .ok()
}

#[cfg(target_os = "linux")]
fn signal_process_members(members: &[ProcessIdentity], signal: LibcSignal) {
    for member in members {
        let _ = signal_process(member.pid, signal);
    }
}

#[cfg(target_os = "linux")]
fn signal_process(pid: i32, signal: LibcSignal) -> AppResult<()> {
    use nix::{
        sys::signal::{kill, Signal},
        unistd::Pid,
    };
    let signal = match signal {
        LibcSignal::Term => Signal::SIGTERM,
        LibcSignal::Kill => Signal::SIGKILL,
    };
    kill(Pid::from_raw(pid), signal)
        .map_err(|error| AppError::Session(format!("signal process {pid}: {error}")))?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn signal_process_group(process_group: i32, signal: LibcSignal) -> AppResult<()> {
    use nix::{
        sys::signal::{killpg, Signal},
        unistd::Pid,
    };
    let signal = match signal {
        LibcSignal::Term => Signal::SIGTERM,
        LibcSignal::Kill => Signal::SIGKILL,
    };
    killpg(Pid::from_raw(process_group), signal).map_err(|error| {
        AppError::Session(format!("signal process group {process_group}: {error}"))
    })?;
    Ok(())
}

#[cfg(all(unix, not(target_os = "linux")))]
fn killer_signal(process_group: Option<i32>, signal: LibcSignal) -> AppResult<()> {
    let Some(process_group) = process_group else {
        return Ok(());
    };
    #[cfg(unix)]
    {
        use nix::{
            sys::signal::{killpg, Signal},
            unistd::Pid,
        };
        let signal = match signal {
            LibcSignal::Term => Signal::SIGTERM,
            LibcSignal::Kill => Signal::SIGKILL,
        };
        killpg(Pid::from_raw(process_group), signal).map_err(|error| {
            AppError::Session(format!("signal process group {process_group}: {error}"))
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::SessionHandle;
    use crate::models::SessionId;
    use std::{path::PathBuf, time::Duration};

    #[test]
    fn pty_survives_viewer_detach() {
        let temp = tempfile::tempdir().expect("tempdir");
        let session = SessionHandle::spawn(super::SessionSpawnOptions {
            id: SessionId::new(),
            name: "test".to_owned(),
            project_id: None,
            cwd: &PathBuf::from(temp.path()),
            runtime_marker: &temp.path().join("test.db"),
            command: vec!["/bin/bash".to_owned(), "-i".to_owned()],
            rows: 24,
            cols: 80,
            max_scrollback_bytes: 4096,
            idle_after_secs: 60,
        })
        .expect("session");
        let attached = session.attach(0);
        session.detach();
        assert!(session.is_live());
        assert_eq!(
            session.snapshot().status,
            crate::models::SessionStatus::Disconnected
        );
        drop(attached);
        session.terminate().expect("terminate");
        std::thread::sleep(Duration::from_millis(100));
    }
}
