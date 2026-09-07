//! S3-compatible remote backup: upload, list, download, delete, retention.

use chrono::{Datelike, NaiveDate, Timelike, Utc};
use s3::creds::Credentials;
use s3::{Bucket, Region};
use serde::Serialize;

use crate::backup::{BackupInfo, BackupSource};
use crate::error::AppError;
use crate::settings::Settings;

/// One key whose remote delete failed during retention.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeleteFailure {
    pub key: String,
    /// HTTP status + response detail (or the raw error Display as fallback) —
    /// enough to tell a signing bug (e.g. SignatureDoesNotMatch) apart from a
    /// bucket policy denial (AccessDenied), which look identical otherwise.
    pub error: String,
}

/// Outcome of one `retention_remote` pass, surfaced to the UI and logged —
/// every previous delete failure was silently discarded (`let _ =`), so
/// "remote never prunes" had no observable cause.
#[derive(Debug, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RetentionSummary {
    /// Objects listed under the prefix with a parseable backup timestamp.
    pub listed: usize,
    /// Of those, how many the GFS policy marked for deletion.
    pub due: usize,
    pub deleted: usize,
    pub failed: Vec<DeleteFailure>,
    /// Due for deletion but never attempted, because an earlier delete in
    /// this pass already failed (see `retention_remote` doc comment).
    pub not_attempted: usize,
}

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

/// How long a presigned DELETE URL stays valid. It's used within the same
/// async call that mints it, so this only needs to survive network latency.
const PRESIGN_EXPIRY_SECS: u32 = 60;

/// Delete a key via a presigned URL rather than rust-s3's native
/// `delete_object` — see the doc comment on `delete_via_presigned_url` for why.
pub async fn delete(settings: &Settings, key: &str) -> Result<(), AppError> {
    let bucket = build_bucket(settings)?;
    let client = bucket.http_client();
    delete_via_presigned_url(&bucket, &client, key)
        .await
        .map_err(|detail| {
            AppError::new(
                "err_s3_failed",
                format!("S3 delete failed: {detail}"),
                serde_json::json!({ "detail": detail }),
            )
        })
}

/// Delete a key by issuing a plain HTTP DELETE against a presigned URL,
/// instead of rust-s3's native `Bucket::delete_object` (which sends a
/// natively-signed, header-authenticated request).
///
/// Confirmed against the vendored rust-s3 0.37.2 source
/// (`request/request_trait.rs::headers()`): every command other than
/// CopyObject/ListObjects*/HeadObject/GetObject*/ListBuckets — DeleteObject
/// included — gets `Content-Length` and `Content-Type: text/plain` inserted
/// into the same `HeaderMap` that both the SigV4 signature (`signing.rs::
/// canonical_header_string`, which signs *every* header in the map) and the
/// actual outgoing `reqwest` request are built from. So rust-s3 itself never
/// signs one header set and sends another — GetObject simply never
/// synthesizes a Content-Type/Content-Length in the first place, while
/// DeleteObject does. That synthetic pair on an otherwise bodyless DELETE is
/// the one structural difference between DeleteObject's signed headers and
/// every read path's, and matches R2's confirmed 403 SignatureDoesNotMatch on
/// DELETE specifically (PUT also signs Content-Type, but for a real body, and
/// that path works).
///
/// Query-string SigV4 (what `Bucket::presign_delete` produces) sidesteps this
/// entirely: `signing::authorization_query_params_no_sig` signs only `host`
/// for a presigned delete (no custom headers are passed for
/// `Command::PresignDelete`), so there is no Content-Type/Content-Length in
/// the signature to mismatch. Any 2xx status (204 included) is success.
async fn delete_via_presigned_url(
    bucket: &Bucket,
    client: &reqwest::Client,
    key: &str,
) -> Result<(), String> {
    let url = bucket
        .presign_delete(key, PRESIGN_EXPIRY_SECS)
        .await
        .map_err(|e| e.to_string())?;
    let resp = client
        .delete(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        return Ok(());
    }
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    Err(describe_delete_error(status, &body))
}

/// Turn a delete failure into a short, readable line: HTTP status plus the S3
/// `<Code>` (e.g. "HTTP 403 AccessDenied" vs "HTTP 403 SignatureDoesNotMatch"),
/// falling back to a truncated raw body when the XML doesn't parse that far.
fn describe_delete_error(status: u16, body: &str) -> String {
    let code = body
        .split_once("<Code>")
        .and_then(|(_, rest)| rest.split_once("</Code>"))
        .map(|(code, _)| code);
    match code {
        Some(code) => format!("HTTP {status} {code}"),
        None => format!("HTTP {status} {}", truncate(body)),
    }
}

fn truncate(s: &str) -> String {
    s.chars().take(200).collect()
}

/// Consecutive delete failures that abort a retention pass early. Deletes are
/// expected to succeed now (presigned-URL delete, see
/// `delete_via_presigned_url`); this cap exists only so a genuine outage
/// (bucket unreachable, credentials revoked) can't stall the app for minutes
/// working through a large backlog. A transient failure or two doesn't trip
/// it, since `deleted` resets the counter.
const MAX_CONSECUTIVE_DELETE_FAILURES: usize = 3;

/// Deletes attempted per retention pass. Bounds how long one pass can block:
/// each is a sequential round trip, and `backup_now` awaits the whole thing.
/// A long-neglected bucket drains over several passes rather than freezing the
/// window once.
const MAX_DELETES_PER_PASS: usize = 200;

/// Apply GFS retention to remote .age objects.
///
/// Every failed delete is collected into the returned summary instead of
/// being discarded — that silent discard was the actual bug behind "remote
/// never prunes" (the listing, prefix-stripping and GFS slotting are shared
/// with `list_remote`/local retention and already proven correct).
///
/// Attempts every due key rather than stopping at the first failure: with
/// deletes now expected to work (see `delete_via_presigned_url`), stopping on
/// the first failure would mean a lone bad key blocks the entire backlog
/// forever. It still bails out after `MAX_CONSECUTIVE_DELETE_FAILURES` failures
/// in a row so a genuine outage can't stall the app for minutes; remaining due
/// keys are reported as `not_attempted`, not silently dropped.
pub async fn retention_remote(settings: &Settings) -> Result<RetentionSummary, AppError> {
    let bucket = build_bucket(settings)?;
    let client = bucket.http_client();
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

    // Newest first — first occurrence of a slot is the keeper. (Identical
    // policy to backup::retention_local — do not change.)
    entries.sort_by(|a, b| b.1.cmp(&a.1));

    let now = Utc::now();
    let today = now.date_naive();
    let cy = today.year();
    let cm = today.month();

    let listed = entries.len();
    let mut seen = std::collections::HashSet::new();
    let mut due: Vec<String> = Vec::new();
    for (key, ts) in &entries {
        match gfs_slot(*ts, today, cy, cm) {
            Some(slot) if seen.contains(&slot) => due.push(key.clone()), // duplicate slot — delete older one
            Some(slot) => {
                seen.insert(slot);
            }
            None => due.push(key.clone()), // too old — purge
        }
    }
    let due_count = due.len();

    let mut deleted = 0usize;
    let mut failed: Vec<DeleteFailure> = Vec::new();
    let mut consecutive_failures = 0usize;
    let mut attempted = 0usize;
    for key in &due {
        // One presign + DELETE round trip per key, sequentially, and
        // `backup_now` awaits this on the command thread. A months-long
        // backlog would otherwise freeze the window for minutes on the first
        // successful pass. Bound the work instead: the rest come back as
        // `not_attempted` and the next pass takes them.
        if attempted >= MAX_DELETES_PER_PASS {
            break;
        }
        attempted += 1;
        match delete_via_presigned_url(&bucket, &client, key).await {
            Ok(()) => {
                deleted += 1;
                consecutive_failures = 0;
            }
            Err(detail) => {
                failed.push(DeleteFailure {
                    key: key.clone(),
                    error: detail,
                });
                consecutive_failures += 1;
                if consecutive_failures >= MAX_CONSECUTIVE_DELETE_FAILURES {
                    break;
                }
            }
        }
    }
    let not_attempted = due_count - attempted;

    Ok(RetentionSummary {
        listed,
        due: due_count,
        deleted,
        failed,
        not_attempted,
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn describe_delete_error_extracts_code_from_xml_body() {
        let body = "<?xml version=\"1.0\"?><Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>";
        assert_eq!(describe_delete_error(403, body), "HTTP 403 AccessDenied");
    }

    #[test]
    fn describe_delete_error_distinguishes_signature_from_access_denied() {
        let signing = "<Error><Code>SignatureDoesNotMatch</Code></Error>";
        let policy = "<Error><Code>AccessDenied</Code></Error>";
        assert_ne!(
            describe_delete_error(403, signing),
            describe_delete_error(403, policy)
        );
    }

    #[test]
    fn describe_delete_error_falls_back_to_truncated_body_without_code() {
        let body = "x".repeat(500);
        let msg = describe_delete_error(403, &body);
        assert!(msg.starts_with("HTTP 403 "));
        assert!(msg.len() < body.len());
    }

    /// `MAX_CONSECUTIVE_DELETE_FAILURES` caps consecutive failures, not total
    /// failures — a pass that alternates success/failure should never trip
    /// it, and `not_attempted` must reflect exactly how many of `due` were
    /// actually attempted before any early exit. This isolates that counting
    /// logic (the `retention_remote` loop body) without touching the network.
    #[test]
    fn consecutive_failure_counter_resets_on_success() {
        // 7 keys: fail, fail, ok, fail, fail, fail (trips cap here), fail (never attempted)
        let outcomes = [false, false, true, false, false, false, false];
        let due_count = outcomes.len();

        let mut deleted = 0usize;
        let mut failed = 0usize;
        let mut consecutive_failures = 0usize;
        let mut attempted = 0usize;
        for ok in outcomes {
            attempted += 1;
            if ok {
                deleted += 1;
                consecutive_failures = 0;
            } else {
                failed += 1;
                consecutive_failures += 1;
                if consecutive_failures >= MAX_CONSECUTIVE_DELETE_FAILURES {
                    break;
                }
            }
        }
        let not_attempted = due_count - attempted;

        assert_eq!(deleted, 1);
        assert_eq!(failed, 5);
        assert_eq!(attempted, 6);
        assert_eq!(not_attempted, 1);
    }
}
