//! Minimal Linux PTY spawn probe for the architecture comparison.
//!
//! This deliberately measures only the native terminal primitive: one Rust
//! parent calls forkpty(3) and starts an interactive bash per terminal.  It
//! does not pretend to be a complete HTTP/WebSocket server.

use std::env;
use std::ffi::CString;
use std::os::raw::{c_char, c_int};
use std::ptr;
use std::thread;
use std::time::{Duration, Instant};

#[repr(C)]
struct Winsize {
    ws_row: Cushort,
    ws_col: Cushort,
    ws_xpixel: Cushort,
    ws_ypixel: Cushort,
}

type Cushort = u16;

unsafe extern "C" {
    fn forkpty(
        amaster: *mut c_int,
        name: *mut c_char,
        termp: *const Termios,
        winp: *const Winsize,
    ) -> c_int;
    fn execv(path: *const c_char, argv: *const *mut c_char) -> c_int;
    fn _exit(status: c_int) -> !;
    fn kill(pid: c_int, sig: c_int) -> c_int;
    fn waitpid(pid: c_int, status: *mut c_int, options: c_int) -> c_int;
    fn close(fd: c_int) -> c_int;
}

// forkpty only reads this pointer when a non-null termios value is supplied.
// Keeping the opaque layout out of this probe avoids depending on a libc crate.
#[repr(C)]
struct Termios {
    _opaque: [u8; 60],
}

const SIGKILL: c_int = 9;

fn argument(name: &str, fallback: u64) -> u64 {
    let args: Vec<String> = env::args().collect();
    args.windows(2)
        .find(|pair| pair[0] == name)
        .and_then(|pair| pair[1].parse().ok())
        .unwrap_or(fallback)
}

fn spawn_shell() -> Result<(c_int, c_int), String> {
    let mut master: c_int = -1;
    let size = Winsize {
        ws_row: 24,
        ws_col: 80,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };
    let pid = unsafe { forkpty(&mut master, ptr::null_mut(), ptr::null(), &size) };
    if pid < 0 {
        return Err("forkpty failed".to_string());
    }
    if pid == 0 {
        let path = CString::new("/bin/bash").unwrap();
        let arg0 = path.as_ptr() as *mut c_char;
        let arg1 = CString::new("-i").unwrap();
        let arg1_ptr = arg1.as_ptr() as *mut c_char;
        let argv = [arg0, arg1_ptr, ptr::null_mut()];
        unsafe {
            execv(path.as_ptr(), argv.as_ptr());
            _exit(127);
        }
    }
    Ok((pid, master))
}

fn main() {
    let count = argument("--count", 50);
    let hold_ms = argument("--hold-ms", 5000);
    let started = Instant::now();
    let mut children = Vec::with_capacity(count as usize);
    for _ in 0..count {
        children.push(spawn_shell().unwrap_or_else(|error| panic!("{}", error)));
    }
    let spawn_ms = started.elapsed().as_secs_f64() * 1000.0;
    thread::sleep(Duration::from_millis(hold_ms));
    for (pid, master) in children {
        unsafe {
            close(master);
            kill(pid, SIGKILL);
            let mut status = 0;
            waitpid(pid, &mut status, 0);
        }
    }
    println!(
        "{{\"count\":{},\"spawnMs\":{:.3},\"holdMs\":{},\"binary\":\"rustc forkpty + /bin/bash\"}}",
        count, spawn_ms, hold_ms
    );
}
