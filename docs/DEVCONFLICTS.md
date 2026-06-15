# Developer-guideline conflicts and potential problems

A review of the ReWrite plugin against Obsidian's official developer documentation:

- Plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
- Submission requirements: https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins
- Developer policies: https://docs.obsidian.md/Developer+policies

Scope: this document only **identifies** conflicts and potential problems. It does not propose or apply fixes. Severity labels are this reviewer's estimate of how likely each item is to matter during community-plugin review.

---

## High: likely to be flagged in submission review

### 1. LICENSE file still attributes copyright to the sample plugin's author
[LICENSE](../LICENSE) reads `Copyright (C) 2020-2025 by Dynalist Inc.` — this is the verbatim license shipped with `obsidian-sample-plugin`, never updated to the actual author.

- Developer policy: plugins must "Include a LICENSE file and clearly indicate the license" and respect copyright / credit incorporated code.
- The license body (0BSD-style permissive grant) is fine, but the copyright holder is wrong, which is a copyright-attribution problem, not just cosmetic.

### 2. Node.js APIs used while `isDesktopOnly: false`
[manifest.json](../manifest.json) sets `isDesktopOnly: false`, but the plugin imports Node built-ins (`child_process`, `net`, `fs`, `process`) in [src/whisper-host.ts](../src/whisper-host.ts).

- Submission requirement: "If using Node.js packages like `fs`, `crypto`, or `os`, the plugin must be marked as desktop-only."
- The plugin does this deliberately and defensibly: the Node modules are lazy-`require`d only inside `Platform.isDesktop` guards (the local whisper.cpp host is a desktop-only feature), so mobile never touches them. This is the accepted pattern for a mixed desktop/mobile plugin.
- Still flag-worthy: automated review and human reviewers frequently catch Node imports in non-desktop-only manifests. Expect to have to justify it. The casts at [src/whisper-host.ts:83-92](../src/whisper-host.ts#L83-L92) (`window.require` / `globalThis.process`) are part of the same pattern.

### 3. `package.json` license identifier is not a valid SPDX id
[package.json](../package.json) line 14 declares `"license": "0-BSD"`. The SPDX identifier is `0BSD` (no hyphen). Tooling that validates SPDX will not recognize `0-BSD`.

---

## Medium: code-guideline deviations

### 4. `Vault.modify()` used instead of `Vault.process()` for read-modify-write
Guideline: "Use `Vault.process` instead of `Vault.modify`" for background edits (atomic), and "Use the Editor interface instead of `Vault.modify()` to the active file."

- [src/insert.ts:59-62](../src/insert.ts#L59-L62) — `insertAppend` reads the file then `vault.modify`s it. This is a non-atomic read-modify-write, and the target may be the **active** file (it falls back to the active view's file), where the guideline prefers the Editor interface to preserve cursor/selection.
- [src/templates-folder.ts:255](../src/templates-folder.ts#L255) — `vault.modify` during the template-update reconcile.
- [src/template-guide.ts:249](../src/template-guide.ts#L249) — `vault.modify` when rewriting the guide.

The latter two are background, non-active-file writes; `Vault.process` would be the recommended atomic form.

### 5. `app.vault.adapter` used instead of `app.vault`
Guideline: prefer `app.vault` over `app.vault.adapter` (caching + serialized, safer operations).

- [src/secrets.ts:296-314](../src/secrets.ts#L296-L314) — `adapter.exists/read/write` for `secrets.json.nosync`.
- [src/whisper-host.ts:397-427](../src/whisper-host.ts#L397-L427) — `adapter.exists/read/write/remove` for the PID sidecar.

Both touch config/sidecar files that are intentionally not regular vault notes (e.g. the `.nosync` secrets envelope), so direct adapter access is arguably justified — but it is still a documented deviation a reviewer may question.

### 6. Use of undocumented / private Obsidian internals
The guidelines steer away from relying on internals not in the public API (they can change without notice). The plugin reaches several via `as unknown as` casts:

- [src/ui/quick-record.ts:189](../src/ui/quick-record.ts#L189) — `app.hotkeyManager` (not in public typings).
- [src/ui/modal.ts:507](../src/ui/modal.ts#L507) — cast on `this.app` to reach an internal.
- [src/secrets.ts:111](../src/secrets.ts#L111) — `app.secretStorage`. This one is now a GA public API (1.11.4) but predates the installed typings, so it is reached via a cast; lower risk than the others but worth listing.

These are localized behind narrow interfaces (the documented pattern for when a cast is unavoidable), but they remain private-API dependencies that can break on an Obsidian update.

### 7. Editor-dependent commands use `callback` instead of `editorCheckCallback`
Guideline: "Use `editorCallback` or `editorCheckCallback` for commands requiring an active Markdown editor."

- [src/main.ts:80-86](../src/main.ts#L80-L86) — `process-text` requires an active Markdown editor/selection but is registered with a plain `callback` and checks for an editor internally (showing a Notice when absent). Using `editorCheckCallback` would let Obsidian hide the command when no editor is active, which is the recommended behavior. (The whisper start/stop commands already use `checkCallback` correctly.)

---

## Low: minor / conventional

### 8. `manifest.json` missing `author` / `authorUrl`
[manifest.json](../manifest.json) has no `author` or `authorUrl` fields. Not strictly required, but conventional and present in the sample manifest; pairs with finding #1 (the stale LICENSE copyright).

### 9. `app.vault.getFiles()` full-vault scan
[src/ui/audio-source.ts:18](../src/ui/audio-source.ts#L18) iterates all vault files to filter audio by extension. The guideline's "don't iterate all files" advice is specifically about *finding a file by path* (use `getFileByPath`), which this is not — there is no extension index in the API, so a scan is reasonable. Listed only for completeness; not a real conflict.

---

## Checked and clean (no conflict found)

For the record, these commonly-flagged items were checked and are compliant:

- **DOM safety**: no `innerHTML` / `outerHTML` / `insertAdjacentHTML` anywhere; DOM is built with `createEl`/`createDiv`/`createSpan`.
- **No hardcoded styling in JS**: no `el.style` / inline-style assignments; all styling lives in [styles.css](../styles.css) and uses Obsidian CSS variables (`--text-muted`, `--background-modifier-border`, etc.).
- **App instance**: uses `this.app` throughout; no `window.app` / global `app`.
- **No `var`**; `const`/`let` only. async/await used over raw Promises.
- **No default hotkeys** set on any command.
- **`normalizePath`** is used consistently for user-supplied paths.
- **Resource cleanup**: `registerEvent` / `registerInterval` used; the one manual DOM element (Quick Record floater) is torn down in `onunload`.
- **Settings headings**: routed through a `setHeading()` helper, no manual `<h2>`, no top-level "Settings"/plugin-name heading.
- **Sentence case** in UI text and command names; the one `eslint-disable obsidianmd/ui/sentence-case` ([src/ui/passphrase-modal.ts:160](../src/ui/passphrase-modal.ts#L160)) is a legitimate exemption for a literal random-string example.
- **Manifest description**: action-focused, ends with a period, under 250 characters, no emoji.
- **Network-use disclosure** (developer policy): the README states keys are user-supplied, "Nothing is sent to a ReWrite server," and lists every provider endpoint.
- **No telemetry, no ads, no self-update mechanism, no code obfuscation** (developer policy prohibitions).
- **Frontmatter** modified via `FileManager.processFrontMatter` ([src/insert.ts:94](../src/insert.ts#L94)), not manual YAML editing of the note.
