# Auto-Update via Public GitHub Releases — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Windows club laptop gets a "Ny version X.Y.Z — uppdatera nu?" prompt on launch and can self-update from public GitHub releases.

**Architecture:** Repo goes public on GitHub. `/release` pushes a `vX.Y.Z` tag → GitHub Actions (windows-latest) stamps the tag version into `tauri.conf.json`, builds an NSIS installer via `tauri-action`, and publishes a release with installer + `.sig` + `latest.json`. The app's updater plugin fetches `latest.json` from the latest release; a small React component prompts the operator.

**Tech Stack:** Tauri 2 (`tauri-plugin-updater`, `tauri-plugin-process`), Mantine v9 Modal, GitHub Actions `tauri-apps/tauri-action@v0`.

**Spec:** `docs/superpowers/specs/2026-07-23-auto-update-design.md`

## Global Constraints

- `npm run build` and `cargo test --manifest-path src-tauri/Cargo.toml` must be green before any task is "done".
- All user-facing strings keyed in `src/i18n.ts`, **both `sv` and `en`**. Swedish default. Never hardcode UI copy.
- The updater must **never block or nag on startup failure** — offline `check()` errors are logged to console and swallowed.
- Git tag is the **single version source**. Never hand-edit versions to "sync" them; `package.json`/`Cargo.toml` stay at 0.1.0.
- Work on branch `feat/auto-update` (Tasks 2–5). Task 1 pushes `main` and is infra, not code.
- Windows only, NSIS only. No macOS/Linux release builds.
- This project has no JS test framework and this feature adds no Rust logic — verification is typecheck/compile green + the CI/E2E proof in Task 6. Do not add a test framework.

---

### Task 1: Go public — history scan, GitHub repo, signing keys, secrets

Manual/infra task, run from repo root. No code changes.

**Files:** none created in-repo. Produces: `origin` remote, `~/.tauri/shooting-range-log.key` (+ `.pub`), two GitHub Actions secrets.

**Interfaces:**
- Produces for Task 2: `OWNER` (GitHub login) and the pubkey string (contents of `~/.tauri/shooting-range-log.key.pub`).

- [ ] **Step 1: Scan full git history for secrets/personal data**

```bash
# Swedish SSN pattern (YYMMDD-XXXX / YYYYMMDD-XXXX with - or +), keys, credentials.
git log --all -p | grep -inE '([0-9]{2}|[0-9]{4})[0-9]{4}[-+][0-9]{4}|BEGIN [A-Z]+ PRIVATE KEY|passphrase|s3_secret|aws_secret|AKIA[0-9A-Z]{16}' | grep -viE 'test|seed|mock|passphrase_required|backup_passphrase(\b|_)' | head -50
```

Expected: no hits pointing at *real* data. Seed SSNs are deterministic mock values (`src-tauri/src/seed.rs`) — hits there are fine. Settings/S3 credentials live in the runtime DB, never in git. If anything real shows up, STOP and tell Tom — do not push.

- [ ] **Step 2: Verify primer.md is gitignored**

```bash
git check-ignore primer.md && echo OK
```

Expected: `primer.md` + `OK`. If not ignored, STOP (it is session-continuity scratch, must not go public).

- [ ] **Step 3: Create public repo and push main**

```bash
gh repo create shooting-range-log --public --source=. --remote=origin --push
gh api user -q .login   # record this as OWNER for Task 2
```

Expected: repo created, `main` pushed, login printed.

- [ ] **Step 4: Generate updater signing keypair**

```bash
npm run tauri signer generate -- -w ~/.tauri/shooting-range-log.key
```

Prompts for a password — Tom picks one and stores password + both key files in his password manager. **A lost private key means shipped installs can never update again.** The command prints the public key; it is also in `~/.tauri/shooting-range-log.key.pub`.

- [ ] **Step 5: Set GitHub Actions secrets**

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/shooting-range-log.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD   # paste the password interactively
gh secret list
```

Expected: both secrets listed.

---

### Task 2: Updater + process plugin plumbing

**Files:**
- Modify: `src-tauri/Cargo.toml` (dependencies block)
- Modify: `src-tauri/src/lib.rs:193-195` (plugin registration)
- Modify: `src-tauri/tauri.conf.json` (bundle + plugins)
- Modify: `src-tauri/capabilities/default.json`
- Modify: `package.json` (via `npm install`)

**Interfaces:**
- Consumes from Task 1: `OWNER`, pubkey string.
- Produces for Task 3: JS APIs `check()` from `@tauri-apps/plugin-updater` and `relaunch()` from `@tauri-apps/plugin-process`, permitted for the `main` window.

- [ ] **Step 1: Create branch**

```bash
git checkout -b feat/auto-update
```

- [ ] **Step 2: Add Rust dependencies**

In `src-tauri/Cargo.toml` `[dependencies]`, after `tauri-plugin-dialog = "2"`:

```toml
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

- [ ] **Step 3: Register plugins in lib.rs**

In `src-tauri/src/lib.rs` `run()`, the builder currently reads:

```rust
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
```

Add after the dialog plugin:

```rust
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
```

- [ ] **Step 4: Install npm plugin packages**

```bash
npm install @tauri-apps/plugin-updater @tauri-apps/plugin-process
```

- [ ] **Step 5: Configure tauri.conf.json**

Replace the `bundle` section and add `plugins` (top level). `PUBKEY` = the single-line contents of `~/.tauri/shooting-range-log.key.pub`; `OWNER` = GitHub login from Task 1:

```json
  "bundle": {
    "active": true,
    "targets": ["nsis"],
    "createUpdaterArtifacts": true,
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  },
  "plugins": {
    "updater": {
      "pubkey": "PUBKEY",
      "endpoints": [
        "https://github.com/OWNER/shooting-range-log/releases/latest/download/latest.json"
      ],
      "windows": {
        "installMode": "passive"
      }
    }
  }
```

- [ ] **Step 6: Grant capabilities**

`src-tauri/capabilities/default.json` permissions array becomes:

```json
  "permissions": [
    "core:default",
    "opener:default",
    "dialog:default",
    "updater:default",
    "process:default"
  ]
```

- [ ] **Step 7: Verify green**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
```

Expected: both pass (plugins compile, config schema validates at build).

- [ ] **Step 8: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/tauri.conf.json src-tauri/capabilities/default.json package.json package-lock.json
git commit -m "feat(updater): register updater + process plugins, GitHub releases endpoint"
```

---

### Task 3: UpdatePrompt component

**Files:**
- Create: `src/UpdatePrompt.tsx`
- Modify: `src/App.tsx` (import + mount)
- Modify: `src/i18n.ts` (6 keys, sv + en)

**Interfaces:**
- Consumes: `check()`/`Update` from `@tauri-apps/plugin-updater`, `relaunch()` from `@tauri-apps/plugin-process` (Task 2), i18n `t()` convention, Mantine `notifications` for errors.
- Produces: `<UpdatePrompt />`, self-contained, rendered once inside `MantineProvider`.

- [ ] **Step 1: Add i18n keys**

In `src/i18n.ts`, add to the `sv.translation` object (near the other generic keys):

```ts
      // Updater
      update_title: 'Ny version {{version}}',
      update_question: 'Vill du uppdatera nu?',
      update_now: 'Uppdatera nu',
      update_later: 'Senare',
      update_downloading: 'Laddar ner uppdatering…',
      update_failed: 'Uppdateringen misslyckades',
```

And the mirror in `en.translation`:

```ts
      // Updater
      update_title: 'New version {{version}}',
      update_question: 'Update now?',
      update_now: 'Update now',
      update_later: 'Later',
      update_downloading: 'Downloading update…',
      update_failed: 'Update failed',
```

- [ ] **Step 2: Create `src/UpdatePrompt.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { Button, Group, Modal, Progress, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

// Prompt-on-launch updater: checks GitHub releases once at startup and asks the
// operator before downloading. Startup must never block or nag — check failures
// (offline laptop, GitHub unreachable) are logged and swallowed.
export function UpdatePrompt() {
  const { t } = useTranslation();
  const [update, setUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const checked = useRef(false);

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    check()
      .then((u) => u && setUpdate(u))
      .catch((e) => console.warn('[updater] check failed:', e));
  }, []);

  if (!update) return null;

  const downloading = progress !== null;

  const install = async () => {
    setProgress(0);
    let total = 0;
    let received = 0;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0;
        } else if (event.event === 'Progress') {
          received += event.data.chunkLength;
          if (total > 0) setProgress(Math.min(100, Math.round((received / total) * 100)));
        }
      });
      await relaunch();
    } catch (e) {
      console.warn('[updater] install failed:', e);
      notifications.show({ color: 'red', message: t('update_failed') });
      setProgress(null);
      setUpdate(null);
    }
  };

  return (
    <Modal
      opened
      onClose={() => !downloading && setUpdate(null)}
      title={t('update_title', { version: update.version })}
      centered
      withCloseButton={false}
      closeOnClickOutside={false}
      closeOnEscape={!downloading}
    >
      <Stack>
        {downloading ? (
          <>
            <Text>{t('update_downloading')}</Text>
            <Progress value={progress ?? 0} animated />
          </>
        ) : (
          <>
            <Text>{t('update_question')}</Text>
            <Group grow>
              <Button size="xl" variant="default" onClick={() => setUpdate(null)}>
                {t('update_later')}
              </Button>
              <Button size="xl" onClick={install}>
                {t('update_now')}
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
```

- [ ] **Step 3: Mount in App.tsx**

Add to the imports in `src/App.tsx`:

```tsx
import { UpdatePrompt } from './UpdatePrompt';
```

And render it directly after `<Notifications position="top-right" />`:

```tsx
        <Notifications position="top-right" />
        <UpdatePrompt />
```

- [ ] **Step 4: Verify green + dev smoke**

```bash
npm run build
```

Expected: green. Then `npm run tauri dev`: app starts normally, no modal, console shows one `[updater] check failed:` warning (no release exists yet — this proves the silent-failure path).

- [ ] **Step 5: Commit**

```bash
git add src/UpdatePrompt.tsx src/App.tsx src/i18n.ts
git commit -m "feat(updater): prompt-on-launch update modal (sv/en)"
```

---

### Task 4: Release workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: secrets from Task 1, `createUpdaterArtifacts`/NSIS config from Task 2, `vX.Y.Z` tags from `/release`.
- Produces: GitHub release with NSIS installer + `.sig` + `latest.json` on every `v*` tag push; RC tags (`-rc.`) marked prerelease so `releases/latest` (the updater endpoint) only ever serves stable.

- [ ] **Step 1: Create `.github/workflows/release.yml`**

```yaml
name: release

on:
  push:
    tags:
      - 'v*'

jobs:
  build-windows:
    runs-on: windows-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4

      # The git tag is the single version source: stamp it into tauri.conf.json
      # (the version the bundler embeds and the updater compares).
      - name: Stamp app version from tag
        shell: bash
        run: |
          VERSION="${GITHUB_REF_NAME#v}"
          node -e "const fs=require('fs');const p='src-tauri/tauri.conf.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));c.version=process.argv[1];fs.writeFileSync(p,JSON.stringify(c,null,2)+'\n')" "$VERSION"

      # /release writes the changelog into the annotated tag message — reuse it
      # as the GitHub release body.
      - name: Read tag message
        id: tag
        shell: bash
        run: |
          git fetch --force origin "refs/tags/${GITHUB_REF_NAME}:refs/tags/${GITHUB_REF_NAME}"
          {
            echo 'message<<TAG_MSG_EOF'
            git tag -l --format='%(contents)' "${GITHUB_REF_NAME}"
            echo 'TAG_MSG_EOF'
          } >> "$GITHUB_OUTPUT"

      - uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: npm

      - uses: dtolnay/rust-toolchain@stable

      - uses: swatinem/rust-cache@v2
        with:
          workspaces: './src-tauri -> target'

      - run: npm ci

      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: 'Shooting Range Log ${{ github.ref_name }}'
          releaseBody: ${{ steps.tag.outputs.message }}
          releaseDraft: false
          prerelease: ${{ contains(github.ref_name, '-rc.') }}
```

- [ ] **Step 2: Verify the stamp one-liner locally**

```bash
cp src-tauri/tauri.conf.json /tmp/tauri.conf.json.bak
node -e "const fs=require('fs');const p='src-tauri/tauri.conf.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));c.version=process.argv[1];fs.writeFileSync(p,JSON.stringify(c,null,2)+'\n')" "9.9.9"
grep '"version"' src-tauri/tauri.conf.json
mv /tmp/tauri.conf.json.bak src-tauri/tauri.conf.json
```

Expected: `"version": "9.9.9"` printed, then file restored (`git status` clean for it).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: release workflow — NSIS installer + updater artifacts on tag push"
```

---

### Task 5: Documentation updates

**Files:**
- Modify: `project.md:48` (bucket → GitHub releases)
- Modify: `BACKLOG.md:38-42` (M7 section)
- Modify: `CLAUDE.md` (file map + status)

**Interfaces:** none — prose only, keep each edit surgical.

- [ ] **Step 1: project.md**

Line 48 currently ends "...published to the same bucket as the backup for update functionality. Though development can happen on Mac." Replace the sentence so it reads:

```
Interface will be built with Rust and Tauri and binaries built for windows, and published as public GitHub releases which the app's updater checks on launch. Though development can happen on Mac.
```

- [ ] **Step 2: BACKLOG.md**

In the `## M7 — Packaging / auto-update (deferred)` section, mark the updater + CI installer portion done (repo public, release workflow, updater prompt shipped) and leave remaining items — at minimum Windows Authenticode code signing — as still deferred. Keep the section's existing style.

- [ ] **Step 3: CLAUDE.md**

- File map: add `UpdatePrompt.tsx` (prompt-on-launch updater modal) to the `src/` list and mention `.github/workflows/release.yml`.
- Status: append the auto-update wave (`feat/auto-update`, 2026-07-23): repo public on GitHub, release workflow on `v*` tags (NSIS + updater artifacts, tag-stamped version), prompt-on-launch updater. Note git is no longer local-only.
- Commands: add release flow note: `/release patch|minor|major` → tag push → CI builds installer.

- [ ] **Step 4: Commit**

```bash
git add project.md BACKLOG.md CLAUDE.md
git commit -m "docs: auto-update wave — GitHub releases replace bucket plan"
```

---

### Task 6: Merge + first release + E2E proof

**Files:** none (git/CI operations).

**Interfaces:** consumes everything above.

- [ ] **Step 1: Merge and push**

```bash
git checkout main
git merge --no-ff feat/auto-update -m "Merge feat/auto-update: prompt-on-launch updater + GitHub release CI"
git push
```

- [ ] **Step 2: Tag first release**

Run `/release patch` (Tom's confirmation flow included) → tags and pushes `v0.1.1`.

- [ ] **Step 3: Watch CI**

```bash
gh run watch
```

Expected: `release` workflow green on windows-latest (first run ~10–20 min, no cache).

- [ ] **Step 4: Verify release assets**

```bash
gh release view v0.1.1
```

Expected assets: `Shooting.Range.Log_0.1.1_x64-setup.exe` (NSIS), matching `.sig`, and `latest.json`. Spot-check latest.json:

```bash
gh release download v0.1.1 --pattern latest.json --output - | head -20
```

Expected: JSON with `"version": "0.1.1"`, a `windows-x86_64` platform entry whose URL points at the setup.exe, and a `signature`.

- [ ] **Step 5: Mac dev smoke of the prompt path**

`npm run tauri dev` on Mac: latest.json now exists but has no macOS platform entry — expect the silent no-update/`check failed` path, app starts normally. (The visible prompt can only appear on Windows.)

- [ ] **Step 6: Windows laptop E2E (manual, Tom on site)**

1. Download and install `v0.1.1` setup.exe on the laptop (expect a SmartScreen warning — unsigned installer, click through; one-time cost per spec).
2. Back on Mac: make any trivial visible change, `/release patch` → `v0.1.2`, wait for CI green.
3. Launch the app on the laptop: modal "Ny version 0.1.2 — Vill du uppdatera nu?" appears.
4. **Senare** → modal closes, app usable. Relaunch app → modal reappears.
5. **Uppdatera nu** → progress bar → NSIS passive install → app relaunches as 0.1.2 (verify in title/about or by the modal no longer appearing).

Record the outcome in `primer.md`. This step is the spec's acceptance criterion.

---

## Self-review notes

- Spec coverage: setup (T1), config (T2), UX (T3), release flow (T4), docs (T5), testing/E2E (T6). Out-of-scope list untouched — no code signing, no bucket, no background checks.
- `bundle.targets` narrows `"all"` → `["nsis"]`: deliberate; nobody builds bundles locally and MSI would reject `-rc.N` versions.
- RC safety: prerelease flag keeps `releases/latest` (the updater endpoint) pointing at the last stable release.
