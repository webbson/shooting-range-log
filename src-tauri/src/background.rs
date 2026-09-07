//! Per-laptop page background image (workstream E).
//!
//! A picked file is copied into `<app_data>/background/image` — a fixed,
//! extension-less name so re-picking a file with a different source
//! extension (e.g. .jpg after .png) truly replaces the old one via
//! `fs::copy` instead of leaving two files on disk. The format is recovered
//! at read time by sniffing magic bytes rather than trusting a stored
//! extension, since the on-disk file has none.
//!
//! Returned to the WebView as a base64 data URL — deliberately avoiding
//! Tauri asset-protocol scope + CSP config for one cosmetic feature (CSP is
//! `null` in tauri.conf.json, so data: URLs need no config either way).
//!
//! No Tauri managed state: each command wrapper resolves
//! `app_data_dir().join("background")` itself (see `lib.rs`), same as
//! `db::init`'s directory resolution — these inner fns take a plain `&Path`
//! so they run under `cargo test` without an `AppHandle`.

use std::path::{Path, PathBuf};

use base64::prelude::*;

use crate::error::AppError;

const ALLOWED_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "bmp"];

fn image_path(dir: &Path) -> PathBuf {
    dir.join("image")
}

fn invalid_type_error() -> AppError {
    AppError::new(
        "err_background_invalid_type",
        "Unsupported image type — use PNG, JPG, JPEG, WEBP, GIF or BMP.",
        serde_json::json!({}),
    )
}

/// Copies `src` into `dir/image`, replacing any previous background.
/// Validates the extension at the boundary (CLAUDE.md: validate in Rust) —
/// case-insensitive so a camera's `.JPG` passes.
pub fn set(dir: &Path, src: &Path) -> Result<(), AppError> {
    let ext = src.extension().and_then(|e| e.to_str());
    match ext.map(|e| e.to_lowercase()) {
        Some(e) if ALLOWED_EXTENSIONS.contains(&e.as_str()) => {}
        _ => return Err(invalid_type_error()),
    }
    std::fs::create_dir_all(dir)?;
    std::fs::copy(src, image_path(dir))?;
    Ok(())
}

/// Sniffs the image MIME type from magic bytes — the stored file has no
/// extension to read it back from.
fn sniff_mime(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        "image/png"
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF8") {
        "image/gif"
    } else if bytes.starts_with(b"BM") {
        "image/bmp"
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else {
        "application/octet-stream"
    }
}

/// Returns the current background image as a data URL, or `None` if none is
/// set (fresh install, or after `clear`).
pub fn get(dir: &Path) -> Result<Option<String>, AppError> {
    match std::fs::read(image_path(dir)) {
        Ok(bytes) => {
            let mime = sniff_mime(&bytes);
            let b64 = BASE64_STANDARD.encode(&bytes);
            Ok(Some(format!("data:{mime};base64,{b64}")))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Removes the background image. Not an error if none was set.
pub fn clear(dir: &Path) -> Result<(), AppError> {
    match std::fs::remove_file(image_path(dir)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
pub fn set_background(app: tauri::AppHandle, path: String) -> Result<(), AppError> {
    let dir = background_dir(&app)?;
    set(&dir, Path::new(&path))
}

#[tauri::command]
pub fn get_background(app: tauri::AppHandle) -> Result<Option<String>, AppError> {
    let dir = background_dir(&app)?;
    get(&dir)
}

#[tauri::command]
pub fn clear_background(app: tauri::AppHandle) -> Result<(), AppError> {
    let dir = background_dir(&app)?;
    clear(&dir)
}

fn background_dir(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    use tauri::Manager;
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::internal(format!("app_data_dir: {e}")))?
        .join("background"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_get_replace_reject_clear() {
        let tmp = tempfile::tempdir().unwrap();
        let bg_dir = tmp.path().join("background");

        // Nothing set yet.
        assert_eq!(get(&bg_dir).unwrap(), None);

        // Pick a PNG (uppercase extension, as a camera/phone would produce).
        let src_png = tmp.path().join("pic.PNG");
        std::fs::write(&src_png, [0x89, 0x50, 0x4E, 0x47, 0, 0, 0, 0]).unwrap();
        set(&bg_dir, &src_png).unwrap();
        let url = get(&bg_dir).unwrap().unwrap();
        assert!(url.starts_with("data:image/png;base64,"));

        // Replace with a different extension — must overwrite, not add a
        // second file (the extensionless-filename bug this module exists to
        // avoid).
        let src_jpg = tmp.path().join("pic2.jpg");
        std::fs::write(&src_jpg, [0xFF, 0xD8, 0xFF, 0, 0]).unwrap();
        set(&bg_dir, &src_jpg).unwrap();
        let url2 = get(&bg_dir).unwrap().unwrap();
        assert!(url2.starts_with("data:image/jpeg;base64,"));
        assert_eq!(std::fs::read_dir(&bg_dir).unwrap().count(), 1);

        // Unsupported extension (e.g. iPhone-default HEIC) is rejected, and
        // the previously-set image is left untouched.
        let src_heic = tmp.path().join("pic.heic");
        std::fs::write(&src_heic, [0, 1, 2]).unwrap();
        let err = set(&bg_dir, &src_heic).unwrap_err();
        assert_eq!(err.code, "err_background_invalid_type");
        assert!(get(&bg_dir).unwrap().unwrap().starts_with("data:image/jpeg;base64,"));

        // Clear removes it; clearing again (already gone) is not an error.
        clear(&bg_dir).unwrap();
        assert_eq!(get(&bg_dir).unwrap(), None);
        clear(&bg_dir).unwrap();
    }
}
