# Auto-update via public GitHub releases (M7, part 1)

Date: 2026-07-23
Status: approved

## Decision summary

The repo goes **public** on GitHub. Releases are plain GitHub releases; the Tauri
updater fetches `latest.json` from the latest release — no PAT, no bucket, no auth
anywhere. This supersedes `project.md`'s original plan to publish binaries to the
backup S3 bucket.

- Update host: public GitHub releases (`https://github.com/<owner>/shooting-range-log/releases/latest/download/latest.json`; owner = Tom's personal GitHub account, fixed at repo creation).
- Update UX: prompt on launch (yes/no modal), never silent, never blocking.
- Release trigger: tag push `vX.Y.Z` via the existing `/release` skill.
- Windows only (NSIS installer). No macOS/Linux builds.

## One-time setup (manual, done once)

1. **History scan before going public.** Scan the full git history for secrets and
   personal data (real SSNs, S3 credentials, passphrases). Seed data is mock and S3
   creds live in the runtime DB, so the expectation is clean — but verify before the
   first push. `primer.md` is gitignored and must stay so.
2. Create the public GitHub repo, add as `origin`, push `main`.
3. Generate the updater signing keypair: `npm run tauri signer generate`.
   - Public key → `tauri.conf.json`.
   - Private key + password → GitHub Actions secrets `TAURI_SIGNING_PRIVATE_KEY` and
     `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, plus a copy in Tom's password manager.
   - **A lost private key means shipped installs can never update again** (manual
     reinstall only). The password-manager copy is the recovery path.

## Configuration

- `src-tauri/tauri.conf.json`:
  - `bundle.createUpdaterArtifacts: true`
  - Windows bundle target: NSIS.
  - `plugins.updater`: `pubkey` + single endpoint
    `https://github.com/<owner>/shooting-range-log/releases/latest/download/latest.json`.
- Add `tauri-plugin-updater` and `tauri-plugin-process` (Cargo + npm packages),
  register both in `lib.rs`, grant capabilities (`updater:default`,
  process relaunch permission).
- **Version sync:** the git tag is the single version source. The release workflow
  stamps the tag version into `src-tauri/tauri.conf.json` before building — that is
  the version the updater compares. `package.json`/`Cargo.toml` versions stay at
  0.1.0 and carry no meaning. (Changed from the original "/release bumps three
  files" wording: the `/release` skill only tags, it never edits files.)

## App UX — prompt on launch

New frontend component `UpdatePrompt.tsx`, mounted once in `App.tsx`:

- On startup, call `check()` from `@tauri-apps/plugin-updater` exactly once.
- Update available → Mantine modal (sv/en i18n): title "Ny version X.Y.Z", question
  "Uppdatera nu?", two large touch buttons **Uppdatera nu** / **Senare**.
- **Uppdatera nu** → progress bar driven by `downloadAndInstall()` progress events,
  then `relaunch()` (process plugin). DB migrations auto-run on next launch as usual.
- **Senare** → modal closes; nothing more until next app launch.
- `check()` failure (offline, GitHub unreachable) → log to console, show nothing.
  The club laptop may be offline; startup must never block or nag on network errors.
- All user-facing strings in `i18n.ts` (sv + en), per project convention.

## Release flow

- Tom runs `/release` (patch/minor/major) → version bump commit + tag `vX.Y.Z` + push.
- `.github/workflows/release.yml`, triggered on `push: tags: ['v*']`:
  - `windows-latest` only, `permissions: contents: write`.
  - Steps: checkout → setup-node (npm cache) → stable Rust → `swatinem/rust-cache`
    (workspace `./src-tauri -> target`) → `npm ci` → `tauri-apps/tauri-action@v0`.
  - `tauri-action` env: `GITHUB_TOKEN`, `TAURI_SIGNING_PRIVATE_KEY`,
    `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
  - Publishes the release directly (no draft) with: NSIS installer, `.sig` file,
    `latest.json`.

## Documentation updates (same wave)

- `project.md`: binaries publish to GitHub releases, not the backup bucket.
- `BACKLOG.md`: M7 updater portion moves out of deferred; remaining M7 items
  (Windows code signing, anything else) stay listed.
- `CLAUDE.md`: status + file map (workflow file, `UpdatePrompt.tsx`), note that the
  repo is public.

## Explicitly out of scope

- **Windows Authenticode code signing** — costs money. Consequence: SmartScreen
  warning on the first manual install; updater-applied updates are verified by the
  Tauri signature instead. Stays on BACKLOG.
- S3 bucket as update host (superseded).
- macOS/Linux release builds.
- Auto-install without prompt, background periodic checks, "check for updates"
  settings button.

## Testing / verification

- `npm run build` and `cargo test` green (updater adds no Rust logic, but config and
  registration must compile).
- Modal UX (both buttons, offline silence) live-smoked in `npm run tauri dev` on Mac
  (check() against a real published release; download/install path is Windows-only).
- End-to-end proof on the Windows laptop: install release N manually, publish
  release N+1, launch app → prompt appears → update applies → app relaunches as N+1.
