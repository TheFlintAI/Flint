#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

fn flint_log_dir() -> PathBuf {
    let home = if let Some(home) = std::env::var_os("HOME") {
        PathBuf::from(home)
    } else if let Some(profile) = std::env::var_os("USERPROFILE") {
        PathBuf::from(profile)
    } else {
        PathBuf::from(".")
    };
    home.join(".flint").join("logs")
}

fn main() {
    let log_dir = flint_log_dir();
    fs::create_dir_all(&log_dir).expect("Failed to create log directory");

    let log_path = log_dir.join("flint.log");
    let log_file = fs::File::create(&log_path).expect("Failed to create log file");
    let (non_blocking, _guard) = tracing_appender::non_blocking(log_file);

    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));

    tracing_subscriber::registry()
        .with(env_filter)
        .with(
            tracing_subscriber::fmt::layer()
                .with_target(false)
                .with_ansi(false)
                .with_writer(non_blocking),
        )
        .with(
            tracing_subscriber::fmt::layer()
                .with_target(false)
                .with_ansi(false)
                .with_writer(std::io::stdout),
        )
        .init();

    // Panic messages go to stderr (visible when run from terminal) and to the log file.
    let panic_log_path = log_path;
    std::panic::set_hook(Box::new(move |info| {
        let msg = format!(
            "PANIC: {}\n{:?}",
            info.payload()
                .downcast_ref::<&str>()
                .copied()
                .unwrap_or_else(|| info
                    .payload()
                    .downcast_ref::<String>()
                    .map(|s| s.as_str())
                    .unwrap_or("<non-string payload>")),
            info.location()
        );
        // Append panic info to the same log file
        if let Ok(mut f) = fs::OpenOptions::new().append(true).open(&panic_log_path) {
            let _ = writeln!(f, "{msg}");
        }
        eprintln!("{msg}");
    }));

    flint_lib::run()
}
