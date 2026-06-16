//! Serde models for the IPC boundary + row mappers.
//!
//! Returned structs serialize as camelCase for the TS frontend; input structs
//! deserialize from camelCase. `uid` is the hidden permanent id; `displayId`
//! is the movable tag.

use rusqlite::Row;
use serde::{Deserialize, Serialize};

pub const USER_COLS: &str =
    "uid, display_id, member_number, name, email, phone, address, ssn, is_staff, active, notes, created_at, updated_at";
pub const WEAPON_COLS: &str =
    "uid, display_id, brand, model, serial, active, inactive_reason, notes, created_at, updated_at";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub uid: i64,
    pub display_id: Option<String>,
    pub member_number: Option<String>,
    pub name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub ssn: Option<String>,
    pub is_staff: bool,
    pub active: bool,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl User {
    pub fn from_row(row: &Row) -> rusqlite::Result<User> {
        Ok(User {
            uid: row.get("uid")?,
            display_id: row.get("display_id")?,
            member_number: row.get("member_number")?,
            name: row.get("name")?,
            email: row.get("email")?,
            phone: row.get("phone")?,
            address: row.get("address")?,
            ssn: row.get("ssn")?,
            is_staff: row.get("is_staff")?,
            active: row.get("active")?,
            notes: row.get("notes")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewUser {
    pub display_id: Option<String>,
    pub member_number: Option<String>,
    pub name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub ssn: Option<String>,
    #[serde(default)]
    pub is_staff: bool,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateUser {
    pub uid: i64,
    pub display_id: Option<String>,
    pub member_number: Option<String>,
    pub name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub ssn: Option<String>,
    #[serde(default)]
    pub is_staff: bool,
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
    pub active: bool,
    pub inactive_reason: Option<String>,
    pub notes: Option<String>,
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
            active: row.get("active")?,
            inactive_reason: row.get("inactive_reason")?,
            notes: row.get("notes")?,
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
    pub notes: Option<String>,
}
