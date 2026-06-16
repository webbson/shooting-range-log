//! Application error returned from Tauri commands.
//!
//! Serializes to `{ code, message, params }` so the frontend can translate the
//! `code` (with `params`) via i18n into the operator's language; `message` is an
//! English fallback (also used by `Display`/tests).

use serde::Serialize;
use serde_json::{json, Value};

#[derive(Debug, Serialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub params: Value,
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for AppError {}

impl AppError {
    pub fn new(code: &str, message: impl Into<String>, params: Value) -> Self {
        AppError {
            code: code.into(),
            message: message.into(),
            params,
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        AppError::new("err_internal", message, json!({}))
    }

    pub fn display_id_taken(display_id: &str) -> Self {
        AppError::new(
            "err_display_id_taken",
            format!("Display ID '{display_id}' is already in use by another active record."),
            json!({ "displayId": display_id }),
        )
    }

    pub fn serial_taken(serial: &str) -> Self {
        AppError::new(
            "err_serial_taken",
            format!("Serial '{serial}' is already registered to another weapon."),
            json!({ "serial": serial }),
        )
    }

    pub fn name_required() -> Self {
        AppError::new("err_name_required", "Name is required.", json!({}))
    }

    pub fn user_not_found(uid: i64) -> Self {
        AppError::new(
            "err_user_not_found",
            format!("Member {uid} not found."),
            json!({ "uid": uid }),
        )
    }

    pub fn weapon_not_found(uid: i64) -> Self {
        AppError::new(
            "err_weapon_not_found",
            format!("Weapon {uid} not found."),
            json!({ "uid": uid }),
        )
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::internal(format!("database error: {e}"))
    }
}

impl From<rusqlite_migration::Error> for AppError {
    fn from(e: rusqlite_migration::Error) -> Self {
        AppError::internal(format!("migration error: {e}"))
    }
}
