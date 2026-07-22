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

    pub fn display_id_required() -> Self {
        AppError::new(
            "err_display_id_required",
            "An ID is required for an active record.",
            json!({}),
        )
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

    pub fn weapon_inactive() -> Self {
        AppError::new("err_weapon_inactive", "Weapon is inactive.", json!({}))
    }

    pub fn user_inactive() -> Self {
        AppError::new("err_user_inactive", "Member is inactive.", json!({}))
    }

    pub fn weapon_already_out() -> Self {
        AppError::new(
            "err_weapon_already_out",
            "Weapon is already checked out.",
            json!({}),
        )
    }

    pub fn checkout_not_found(id: i64) -> Self {
        AppError::new(
            "err_checkout_not_found",
            format!("Checkout {id} not found."),
            json!({ "id": id }),
        )
    }

    pub fn already_checked_in() -> Self {
        AppError::new(
            "err_already_checked_in",
            "Weapon is already checked in.",
            json!({}),
        )
    }

    pub fn debt_amount_invalid() -> Self {
        AppError::new(
            "err_debt_amount_invalid",
            "Debt amount must be greater than zero.",
            json!({}),
        )
    }

    pub fn debt_not_found(id: i64) -> Self {
        AppError::new(
            "err_debt_not_found",
            format!("Debt {id} not found."),
            json!({ "id": id }),
        )
    }

    pub fn debt_already_settled() -> Self {
        AppError::new(
            "err_debt_already_settled",
            "Debt is already settled.",
            json!({}),
        )
    }

    pub fn service_description_required() -> Self {
        AppError::new(
            "err_service_description_required",
            "Service description is required.",
            json!({}),
        )
    }

    pub fn weapon_already_preferred(name: &str) -> Self {
        AppError::new(
            "err_weapon_already_preferred",
            format!("Weapon is already the preferred weapon of {name}."),
            json!({ "name": name }),
        )
    }

    pub fn ssn_required() -> Self {
        AppError::new("err_ssn_required", "SSN is required for a guest.", json!({}))
    }

    pub fn ssn_belongs_to_member(name: &str) -> Self {
        AppError::new(
            "err_ssn_belongs_to_member",
            format!("SSN belongs to member {name} — use a normal member checkout."),
            json!({ "name": name }),
        )
    }

    pub fn not_a_guest() -> Self {
        AppError::new("err_not_a_guest", "User is not a guest.", json!({}))
    }

    pub fn guest_cannot_be_assigned() -> Self {
        AppError::new(
            "err_guest_cannot_assign",
            "A weapon cannot be assigned to a guest.",
            json!({}),
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

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::internal(format!("io error: {e}"))
    }
}
