//! The few things that differ between macOS, Windows and Linux.
use std::path::{Path, PathBuf};
use std::process::Command;

/// A command that doesn't flash a console window on Windows.
pub fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    c
}

/// Finds a command-line tool, including when the app was started from the
/// Dock or Start menu without a shell PATH.
pub fn find_tool(name: &str) -> Option<PathBuf> {
    let exe = if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };
    let mut dirs: Vec<PathBuf> = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/snap/bin"].iter().map(PathBuf::from).collect();
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    if cfg!(windows) {
        if let Some(pf) = std::env::var_os("ProgramFiles") {
            dirs.push(PathBuf::from(pf).join("ffmpeg").join("bin"));
        }
    }
    dirs.into_iter().map(|d| d.join(&exe)).find(|p| p.is_file())
}

/// Opens a file with its default app.
pub fn open_path(p: &Path) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    let mut c = command("/usr/bin/open");
    #[cfg(windows)]
    let mut c = {
        let mut c = command("cmd");
        c.args(["/C", "start", ""]);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut c = command("xdg-open");
    c.arg(p).spawn().map(|_| ())
}

/// Shows a file in Finder / Explorer / the file manager.
pub fn reveal_path(p: &Path) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    return command("/usr/bin/open").arg("-R").arg(p).spawn().map(|_| ());
    #[cfg(windows)]
    return command("explorer").arg(format!("/select,{}", p.display())).spawn().map(|_| ());
    #[cfg(all(unix, not(target_os = "macos")))]
    return command("xdg-open").arg(p.parent().unwrap_or(p)).spawn().map(|_| ());
}

/// Opens a web link (the caller checks it's http/https).
pub fn open_url(url: &str) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    return command("/usr/bin/open").arg(url).spawn().map(|_| ());
    #[cfg(windows)]
    return command("rundll32").args(["url.dll,FileProtocolHandler", url]).spawn().map(|_| ());
    #[cfg(all(unix, not(target_os = "macos")))]
    return command("xdg-open").arg(url).spawn().map(|_| ());
}
