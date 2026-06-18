//! S3-compatible remote backup: upload, list, download, delete, retention.

use chrono::{Datelike, NaiveDate, Timelike, Utc};
use s3::creds::Credentials;
use s3::{Bucket, Region};

use crate::backup::{BackupInfo, BackupSource};
use crate::error::AppError;
use crate::settings::Settings;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn build_bucket(settings: &Settings) -> Result<Box<Bucket>, AppError> {
    let endpoint = settings
        .s3_endpoint
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::new(
                "err_s3_not_configured",
                "S3 endpoint not configured",
                serde_json::json!({}),
            )
        })?;
    let bucket_name = settings
        .s3_bucket
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::new(
                "err_s3_not_configured",
                "S3 bucket not configured",
                serde_json::json!({}),
            )
        })?;
    let access_key = settings
        .s3_access_key_id
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::new(
                "err_s3_not_configured",
                "S3 credentials not configured",
                serde_json::json!({}),
            )
        })?;
    let secret_key = settings
        .s3_secret_access_key
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::new(
                "err_s3_not_configured",
                "S3 credentials not configured",
                serde_json::json!({}),
            )
        })?;

    // Cloudflare R2 requires "auto" as the Sig V4 region regardless of what the
    // user typed. Auto-detect and override; for all other providers respect the
    // stored value (defaulting to "auto" if blank).
    let region_str = if endpoint.contains(".r2.cloudflarestorage.com") {
        "auto".to_owned()
    } else {
        settings
            .s3_region
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "auto".into())
    };
    let region = Region::Custom {
        region: region_str,
        endpoint: endpoint.to_owned(),
    };
    let creds = Credentials::new(Some(access_key), Some(secret_key), None, None, None)
        .map_err(|e| AppError::internal(format!("S3 credentials: {e}")))?;
    let bucket = Bucket::new(bucket_name, region, creds)
        .map_err(|e| AppError::internal(format!("S3 bucket: {e}")))?
        .with_path_style();
    Ok(bucket)
}

fn s3_prefix(settings: &Settings) -> String {
    match settings
        .s3_prefix
        .as_deref()
        .filter(|s| !s.is_empty())
    {
        Some(p) => format!("{}/", p.trim_end_matches('/')),
        None => String::new(),
    }
}

/// Build the full S3 key for a local filename.
/// e.g. "prefix/srl-backup-...sqlite.age" or "srl-backup-...sqlite.age" if no prefix.
pub fn s3_key(settings: &Settings, filename: &str) -> String {
    format!("{}{}.age", s3_prefix(settings), filename)
}

// ---------------------------------------------------------------------------
// Timestamp / GFS (replicated from backup.rs — those fns are private)
// ---------------------------------------------------------------------------

fn parse_backup_timestamp(name: &str) -> Option<chrono::DateTime<Utc>> {
    // Accept both "srl-backup-…-vN.sqlite" and "srl-backup-…-vN.sqlite.age".
    let name = name.strip_suffix(".age").unwrap_or(name);
    let stripped = name
        .strip_prefix("srl-backup-")?
        .strip_suffix(".sqlite")?;
    // "2026-06-18T14-30-00Z-v2"
    let ts_str = stripped.rsplit_once("-v")?.0;
    let (date_part, time_part) = ts_str.split_once('T')?;
    // Restore colons: "14-30-00Z" → "14:30:00Z"
    let time_fixed = time_part.replacen('-', ":", 2);
    let full = format!("{date_part}T{time_fixed}");
    full.parse::<chrono::DateTime<Utc>>().ok()
}

fn gfs_slot(
    ts: chrono::DateTime<Utc>,
    today: NaiveDate,
    cy: i32,
    cm: u32,
) -> Option<String> {
    let date = ts.date_naive();
    if date == today {
        Some(format!("hour:{}-{:02}", date, ts.hour()))
    } else if date.year() == cy && date.month() == cm {
        Some(format!("day:{}", date))
    } else if date.year() == cy {
        let w = date.iso_week();
        Some(format!("week:{}-{:02}", w.year(), w.week()))
    } else if date.year() == cy - 1 {
        Some(format!("month:{}-{:02}", date.year(), date.month()))
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// Public async functions
// ---------------------------------------------------------------------------

/// Check if bucket is reachable. Returns bucket name on success.
/// Uses ListObjects (max 1) instead of HeadBucket — more broadly compatible with
/// S3-compatible stores (Cloudflare R2, MinIO, etc.) that may reject HeadBucket.
pub async fn test_connection(settings: &Settings) -> Result<String, AppError> {
    let bucket = build_bucket(settings)?;
    let bucket_name = settings.s3_bucket.clone().unwrap_or_default();
    bucket
        .list(String::new(), Some("/".to_owned()))
        .await
        .map_err(|e| {
            AppError::new(
                "err_s3_failed",
                format!("S3 connection failed: {e}"),
                serde_json::json!({ "detail": format!("{e}") }),
            )
        })?;
    Ok(bucket_name)
}

/// Upload raw bytes to a key in the bucket.
pub async fn upload(settings: &Settings, key: &str, data: &[u8]) -> Result<(), AppError> {
    let bucket = build_bucket(settings)?;
    bucket
        .put_object(key, data)
        .await
        .map_err(|e| AppError::new("err_s3_failed", format!("S3 upload failed: {e}"), serde_json::json!({})))?;
    Ok(())
}

/// List all .age objects under the configured prefix. Returns Vec<BackupInfo> with source=Remote.
pub async fn list_remote(settings: &Settings) -> Result<Vec<BackupInfo>, AppError> {
    let bucket = build_bucket(settings)?;
    let prefix = s3_prefix(settings);

    let results = bucket
        .list(prefix.clone(), Some("/".to_owned()))
        .await
        .map_err(|e| AppError::new("err_s3_failed", format!("S3 list failed: {e}"), serde_json::json!({})))?;

    let mut infos = Vec::new();
    for page in results {
        for obj in page.contents {
            if !obj.key.ends_with(".age") {
                continue;
            }
            // Strip prefix and .age suffix to get the bare sqlite filename.
            let bare_key = obj.key.strip_prefix(&prefix).unwrap_or(&obj.key);
            let filename = match bare_key.strip_suffix(".age") {
                Some(f) => f,
                None => continue,
            };
            let ts = match parse_backup_timestamp(filename) {
                Some(t) => t,
                None => continue,
            };
            let schema_version: i64 = match filename
                .strip_suffix(".sqlite")
                .and_then(|s| s.rsplit_once("-v"))
                .and_then(|(_, v)| v.parse().ok())
            {
                Some(v) => v,
                None => continue,
            };
            infos.push(BackupInfo {
                filename: filename.to_owned(),
                timestamp: ts.to_rfc3339(),
                schema_version,
                source: BackupSource::Remote,
            });
        }
    }

    infos.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(infos)
}

/// Download bytes for a given key.
pub async fn download(settings: &Settings, key: &str) -> Result<Vec<u8>, AppError> {
    let bucket = build_bucket(settings)?;
    let response = bucket
        .get_object(key)
        .await
        .map_err(|e| AppError::new("err_s3_failed", format!("S3 download failed: {e}"), serde_json::json!({})))?;
    Ok(response.as_slice().to_vec())
}

/// Delete a key.
pub async fn delete(settings: &Settings, key: &str) -> Result<(), AppError> {
    let bucket = build_bucket(settings)?;
    bucket
        .delete_object(key)
        .await
        .map_err(|e| AppError::new("err_s3_failed", format!("S3 delete failed: {e}"), serde_json::json!({})))?;
    Ok(())
}

/// Apply GFS retention to remote .age objects.
pub async fn retention_remote(settings: &Settings) -> Result<(), AppError> {
    let bucket = build_bucket(settings)?;
    let prefix = s3_prefix(settings);

    let results = bucket
        .list(prefix.clone(), Some("/".to_owned()))
        .await
        .map_err(|e| AppError::new("err_s3_failed", format!("S3 list failed: {e}"), serde_json::json!({})))?;

    // Collect (key, timestamp) pairs for .age objects.
    let mut entries: Vec<(String, chrono::DateTime<Utc>)> = Vec::new();
    for page in results {
        for obj in page.contents {
            if !obj.key.ends_with(".age") {
                continue;
            }
            let bare = obj.key.strip_prefix(&prefix).unwrap_or(&obj.key);
            let filename = match bare.strip_suffix(".age") {
                Some(f) => f,
                None => continue,
            };
            if let Some(ts) = parse_backup_timestamp(filename) {
                entries.push((obj.key.clone(), ts));
            }
        }
    }

    // Newest first — first occurrence of a slot is the keeper.
    entries.sort_by(|a, b| b.1.cmp(&a.1));

    let now = Utc::now();
    let today = now.date_naive();
    let cy = today.year();
    let cm = today.month();

    let mut seen = std::collections::HashSet::new();
    for (key, ts) in &entries {
        match gfs_slot(*ts, today, cy, cm) {
            Some(slot) if seen.contains(&slot) => {
                // Duplicate slot — delete older one.
                let _ = bucket.delete_object(key).await;
            }
            Some(slot) => {
                seen.insert(slot);
            }
            None => {
                // Too old — purge.
                let _ = bucket.delete_object(key).await;
            }
        }
    }

    Ok(())
}
