use crate::models::SessionSnapshot;
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

const GROUP_CACHE_TTL: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Serialize)]
pub struct SystemMetrics {
    pub cpu_count: usize,
    pub memory_total_bytes: Option<u64>,
    pub memory_available_bytes: Option<u64>,
}

impl SystemMetrics {
    pub fn collect() -> Self {
        let cpu_count = std::thread::available_parallelism().map_or(1, |value| value.get());
        #[cfg(target_os = "linux")]
        {
            let values = fs::read_to_string("/proc/meminfo").ok().map(|content| {
                content
                    .lines()
                    .filter_map(|line| {
                        let (key, value) = line.split_once(':')?;
                        let number = value.split_whitespace().next()?.parse::<u64>().ok()?;
                        Some((key.to_owned(), number.saturating_mul(1024)))
                    })
                    .collect::<HashMap<_, _>>()
            });
            Self {
                cpu_count,
                memory_total_bytes: values.as_ref().and_then(|map| map.get("MemTotal").copied()),
                memory_available_bytes: values
                    .as_ref()
                    .and_then(|map| map.get("MemAvailable").copied()),
            }
        }
        #[cfg(not(target_os = "linux"))]
        Self {
            cpu_count,
            memory_total_bytes: None,
            memory_available_bytes: None,
        }
    }
}

#[derive(Default)]
pub struct MetricsCollector {
    previous: Mutex<HashMap<i32, (Instant, u64, u64)>>,
    #[cfg(target_os = "linux")]
    cached_groups: Mutex<GroupCache>,
}

impl MetricsCollector {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn enrich(&self, snapshot: &mut SessionSnapshot) {
        #[cfg(target_os = "linux")]
        {
            self.enrich_many(std::slice::from_mut(snapshot));
        }
    }

    pub fn enrich_many(&self, snapshots: &mut [SessionSnapshot]) {
        #[cfg(target_os = "linux")]
        {
            let (groups, total_ticks) = self.sample_groups();
            let now = Instant::now();
            let cpus = std::thread::available_parallelism().map_or(1, |value| value.get()) as f64;
            let mut previous = self.previous.lock().expect("metrics mutex");
            for snapshot in snapshots {
                let group = snapshot
                    .process_group
                    .or_else(|| snapshot.child_pid.map(|pid| pid as i32));
                let Some(group) = group else {
                    continue;
                };
                let Some(sample) = groups.get(&group) else {
                    continue;
                };
                snapshot.memory_bytes = Some(sample.memory_bytes);
                snapshot.process_count = Some(sample.process_count);
                let old = previous.insert(group, (now, sample.cpu_ticks, total_ticks));
                if let Some((_, old_ticks, old_total)) = old {
                    let process_delta = sample.cpu_ticks.saturating_sub(old_ticks);
                    let total_delta = total_ticks.saturating_sub(old_total);
                    if total_delta > 0 {
                        snapshot.cpu_percent = Some(
                            ((process_delta as f64 / total_delta as f64) * cpus * 100.0)
                                .min(cpus * 100.0),
                        );
                    }
                }
            }
        }
        #[cfg(not(target_os = "linux"))]
        let _ = snapshots;
    }

    #[cfg(target_os = "linux")]
    fn sample_groups(&self) -> (Arc<HashMap<i32, GroupSample>>, u64) {
        let now = Instant::now();
        let mut cached = self.cached_groups.lock().expect("metrics cache mutex");
        if let Some((sampled_at, groups, total_ticks)) = cached.as_ref() {
            if now.duration_since(*sampled_at) < GROUP_CACHE_TTL {
                return (Arc::clone(groups), *total_ticks);
            }
        }
        let groups = Arc::new(read_groups());
        let total_ticks = read_total_cpu_ticks().unwrap_or(0);
        *cached = Some((now, Arc::clone(&groups), total_ticks));
        (groups, total_ticks)
    }
}

#[derive(Debug, Clone, Default)]
struct GroupSample {
    cpu_ticks: u64,
    memory_bytes: u64,
    process_count: usize,
}

#[cfg(target_os = "linux")]
fn read_groups() -> HashMap<i32, GroupSample> {
    let mut groups = HashMap::new();
    let Ok(entries) = fs::read_dir("/proc") else {
        return groups;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.chars().all(|character| character.is_ascii_digit()) {
            continue;
        }
        let Some(pid) = name.parse::<i32>().ok() else {
            continue;
        };
        let Ok(stat) = fs::read_to_string(format!("/proc/{pid}/stat")) else {
            continue;
        };
        let Some((_, after_command)) = stat.rsplit_once(')') else {
            continue;
        };
        let fields = after_command.split_whitespace().collect::<Vec<_>>();
        let Some(process_group) = fields.get(2).and_then(|value| value.parse::<i32>().ok()) else {
            continue;
        };
        let sample = groups.entry(process_group).or_default();
        let Some(user_ticks) = fields.get(11).and_then(|value| value.parse::<u64>().ok()) else {
            continue;
        };
        let Some(system_ticks) = fields.get(12).and_then(|value| value.parse::<u64>().ok()) else {
            continue;
        };
        sample.cpu_ticks = sample
            .cpu_ticks
            .saturating_add(user_ticks.saturating_add(system_ticks));
        if let Ok(statm) = fs::read_to_string(format!("/proc/{pid}/statm")) {
            if let Some(resident) = statm
                .split_whitespace()
                .nth(1)
                .and_then(|value| value.parse::<u64>().ok())
            {
                sample.memory_bytes = sample
                    .memory_bytes
                    .saturating_add(resident.saturating_mul(page_size()));
            }
        }
        sample.process_count += 1;
    }
    groups
}

#[cfg(target_os = "linux")]
fn page_size() -> u64 {
    4096
}

#[cfg(target_os = "linux")]
fn read_total_cpu_ticks() -> Option<u64> {
    let content = fs::read_to_string("/proc/stat").ok()?;
    let line = content.lines().find(|line| line.starts_with("cpu "))?;
    Some(
        line.split_whitespace()
            .skip(1)
            .take(8)
            .filter_map(|value| value.parse::<u64>().ok())
            .sum(),
    )
}

#[cfg(target_os = "linux")]
type GroupCache = Option<(Instant, Arc<HashMap<i32, GroupSample>>, u64)>;
