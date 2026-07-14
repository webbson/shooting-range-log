# Backlog

Deferred work. Core milestones M0–M5 are done and on `main`. Next: a fine-tuning
pass, then the deferred milestones below.

## Fine-tuning / polish (next session)
_Collect tweaks here as they come up._
- [ ] Bundle size: app JS chunk >500 kB — consider route-level `lazy()` code-splitting.
- [ ] `npm audit` reports 3 high (dev-tool transitive) — triage / `audit fix`.
- [ ] CSV export of log views (was marked stretch in M4 — add if wanted).
- [ ] Review touch sizing/layout at 1920×1080 / 1920×1200 / 2560×1440 on the actual laptop.
- [ ] (add items here)
- [ ] Retired members retain their preferred-weapon slot (star hidden for all on that weapon; exclusivity error names the retired holder) — decide policy: clear preference on deactivation, or allow taking over a weapon from an inactive holder.

## M6 — Backup / restore (deferred)
- Auto snapshot via SQLite `VACUUM INTO` to a local backups dir; on app close + periodic.
- Retention: keep last N.
- Restore UI: pick a snapshot, confirm, swap the DB file.
- **Encrypt the backup artifact before it leaves the device** (plaintext SSN — GDPR).
- S3-compatible upload = config stub, deferred further.
- Verify: snapshot → mutate → restore → data matches.

## M7 — Packaging / auto-update (deferred)
- Set up a git **remote** + Windows CI (workflow already at `.github/workflows/build-windows.yml`)
  to produce the `.msi`/NSIS installer. **This is the M0 exit criterion still outstanding**
  (no remote yet → installer never built).
- Tauri updater pointed at the bucket; code signing; release flow.

## Notes
- Identity/decisions: see `~/.claude/plans/read-project-md-and-make-agile-spark.md`
  and `primer.md` (session continuity, gitignored).
- All DB access via Rust commands; migrations auto-apply on launch; never edit a
  released migration (0001) — append a new `M::up` (0002) instead.
