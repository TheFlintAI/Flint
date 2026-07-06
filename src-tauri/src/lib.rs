mod commands;
mod git;
mod http_client;
mod plugin;
mod preset;
mod state;
mod utils;
mod memory;

pub fn run() {
    commands::run()
}
