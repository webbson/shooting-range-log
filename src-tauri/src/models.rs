//! Serde models for the IPC boundary + row mappers.
//!
//! Returned structs serialize as camelCase for the TS frontend; input structs
//! deserialize from camelCase. `uid` is the hidden permanent id; `displayId`
//! is the movable tag.

use rusqlite::Row;
use serde::{Deserialize, Serialize};

pub const USER_COLS: &str =
    "uid, display_id, name, email, phone, address, ssn, is_staff, is_guest, is_admin, active, notes, preferred_weapon_uid, created_at, updated_at";
pub const WEAPON_COLS: &str =
    "uid, display_id, brand, model, serial, caliber, active, inactive_reason, notes, tag_needs_service, tag_broken, tag_missing_parts, tag_needs_cleaning, tag_comment, created_at, updated_at";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub uid: i64,
    pub display_id: Option<String>,
    pub name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub ssn: Option<String>,
    pub is_staff: bool,
    pub is_guest: bool,
    pub is_admin: bool,
    pub active: bool,
    pub notes: Option<String>,
    pub preferred_weapon_uid: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

impl User {
    pub fn from_row(row: &Row) -> rusqlite::Result<User> {
        Ok(User {
            uid: row.get("uid")?,
            display_id: row.get("display_id")?,
            name: row.get("name")?,
            email: row.get("email")?,
            phone: row.get("phone")?,
            address: row.get("address")?,
            ssn: row.get("ssn")?,
            is_staff: row.get("is_staff")?,
            is_guest: row.get("is_guest")?,
            is_admin: row.get("is_admin")?,
            active: row.get("active")?,
            notes: row.get("notes")?,
            preferred_weapon_uid: row.get("preferred_weapon_uid")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewUser {
    pub display_id: Option<String>,
    pub name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub ssn: Option<String>,
    #[serde(default)]
    pub is_staff: bool,
    #[serde(default)]
    pub is_admin: bool,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateUser {
    pub uid: i64,
    pub display_id: Option<String>,
    pub name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub ssn: Option<String>,
    #[serde(default)]
    pub is_staff: bool,
    #[serde(default)]
    pub is_admin: bool,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Weapon {
    pub uid: i64,
    pub display_id: Option<String>,
    pub brand: Option<String>,
    pub model: Option<String>,
    pub serial: Option<String>,
    pub caliber: Option<String>,
    pub active: bool,
    pub inactive_reason: Option<String>,
    pub notes: Option<String>,
    pub tag_needs_service: bool,
    pub tag_broken: bool,
    pub tag_missing_parts: bool,
    pub tag_needs_cleaning: bool,
    pub tag_comment: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl Weapon {
    pub fn from_row(row: &Row) -> rusqlite::Result<Weapon> {
        Ok(Weapon {
            uid: row.get("uid")?,
            display_id: row.get("display_id")?,
            brand: row.get("brand")?,
            model: row.get("model")?,
            serial: row.get("serial")?,
            caliber: row.get("caliber")?,
            active: row.get("active")?,
            inactive_reason: row.get("inactive_reason")?,
            notes: row.get("notes")?,
            tag_needs_service: row.get("tag_needs_service")?,
            tag_broken: row.get("tag_broken")?,
            tag_missing_parts: row.get("tag_missing_parts")?,
            tag_needs_cleaning: row.get("tag_needs_cleaning")?,
            tag_comment: row.get("tag_comment")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewWeapon {
    pub display_id: Option<String>,
    pub brand: Option<String>,
    pub model: Option<String>,
    pub serial: Option<String>,
    pub caliber: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateWeapon {
    pub uid: i64,
    pub display_id: Option<String>,
    pub brand: Option<String>,
    pub model: Option<String>,
    pub serial: Option<String>,
    pub caliber: Option<String>,
    pub notes: Option<String>,
}
