# ReWrite — Features To Add

Forward-looking backlog. Not committed to a release. Add items as they come up; move to a phase plan when picking one up.

## Open

### 1. Plugin-managed local whisper.cpp server (desktop)

**Goal:** let a desktop user run fully on-device transcription with whisper.cpp without ever opening a terminal during normal use. Plugin spawns the server, plugin tears it down, pipeline talks to it via the existing `openai-compatible` adapter under the hood.

**Scope: desktop only.** Mobile profile is unaffected and continues to use remote or `openai-compatible` providers. Guard everything with `Platform.isDesktop` and lazy-require Node modules inside the guard, the same pattern [src/secrets.ts](../src/secrets.ts) uses for `safeStorage`.

**Obsidian policy:** clean. Confirmed against [Obsidian's Developer policies](https://docs.obsidian.md/Developer+policies) and [Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines) on 2026-05-24: no explicit prohibition on child processes or launching user-supplied binaries. Standard transparency rules apply (disclose in README, no obfuscation).

**Binary + model location:** user-supplied absolute paths in settings, not a fixed location under `<vault>/.obsidian/plugins/rewrite-plugin/`. Two reasons: (a) people often keep binaries in `~/bin/` or a tools dir and would rather not duplicate, (b) large model files (150 MB-1.5 GB) inside `.obsidian/` would inflate vault sync (Obsidian Sync, Syncthing, iCloud, etc.). Plugin only reads paths, never copies or downloads.

**Staged delivery:**

#### Phase A (the "C" option) — on-demand, button-driven

User experience:

- New settings section "Local whisper.cpp server (desktop)". Fields:
  - Binary path (absolute, file picker + text input)
  - Model path (absolute, file picker + text input)
  - Port (default 8080, integer)
  - Extra args (optional, advanced)
- Start / Stop buttons in settings. Status indicator (stopped / starting / running / crashed).
- When running, transcription provider auto-resolves base URL to `http://127.0.0.1:<port>` if the user selects a new "Local whisper.cpp" transcription provider, *or* the user can still point `openai-compatible` at it manually (no special-casing in pipeline).

Build:

- New module `src/whisper-host.ts`: `start()`, `stop()`, `status()`, `onLog(cb)`. Uses lazy-required `child_process.spawn`, `net` (port-in-use probe), `fs` (existence checks).
- Health check after spawn: poll `GET /` or `GET /v1/models` on the port for up to ~5s before declaring ready.
- Orphan handling on startup: if a previous Obsidian crash left a process bound to the configured port, surface that in status rather than silently failing or killing an unrelated process.
- Cross-platform: handle `.exe` suffix on Windows, `chmod +x` is the user's problem (document it).
- Capture stdout/stderr, ring-buffer to ~1 MB, show in a "View log" disclosure inside settings.
- Stop on plugin unload regardless of how the server was started.

#### Phase B — auto-start lifecycle

Once Phase A is solid:

- Add "Start automatically when Obsidian opens" toggle (default off).
- Add "Stop when idle for N minutes" toggle (default off; useful for the large-v3 user who doesn't want 1.5 GB resident all day).
- README updates: setup walkthrough with binary + model download links, troubleshooting (port in use, antivirus blocking, model load failure).

**Touch points:** [src/main.ts](../src/main.ts) (lifecycle hook for stop-on-unload only), new `src/whisper-host.ts`, [src/settings/tab.ts](../src/settings/tab.ts) (new section), [src/types.ts](../src/types.ts) (settings shape), [src/platform.ts](../src/platform.ts) (capability probe for `Platform.isDesktop` + `FileSystemAdapter`), [README.md](../README.md) (new section + disclosure of process-spawn behavior).

**Risks / things to watch:**

- Process supervision has long-tail bugs (zombies, orphans, signal handling differences across platforms). Phase A's button-driven model is forgiving; Phase B's auto-lifecycle is where these bite.
- Antivirus may quarantine `whisper-server.exe` on Windows on first run. Document it; don't try to work around it.
- The plugin must never spawn anything the user didn't explicitly configure. No discovery, no PATH lookup, no "auto-download." Path is supplied → spawn that exact file.

---

## Done

### Model field as a dropdown of available models

Added an optional `listModels(config, signal)` method to both `TranscriptionProvider` and `LLMProvider` interfaces. Implementations: OpenAI / Groq / Mistral (shared via the OpenAI-shaped adapter), Anthropic, Gemini, Deepgram. Skipped (text-only fallback): `openai-compatible` (URL-specific, list-shape varies), AssemblyAI, Rev.ai, Web Speech. Settings tab renders a hybrid Setting per model: dropdown of cached models + Refresh button (when the provider supports listing) plus an always-canonical text input that wins for "Custom" model names not yet in the dropdown. Cache lives at `GlobalSettings.modelCache.{transcription,llm}[providerId] = { ids, fetchedAt }`. No auto-fetch on settings open; the user clicks Refresh once their key is set. Errors surface via Notice with the provider-attributed `ProviderError` message.

### Act on existing text in a note

Added a `{ kind: 'text'; text: string }` source variant to the pipeline (skips transcription, same path as `paste`). Three entry points: `rewrite-plugin:process-text` command, an editor-menu item "ReWrite with template...", and a new "From note" tab in the main modal. All three resolve text from the active editor (selection if non-empty, otherwise whole note body) and open a lightweight template quick-picker before running. Setup-card gating split into voice (full check) vs text (LLM-only check) via `isProfileConfiguredForText` and a `purpose` param on `renderSetupCard`; the modal's per-tab rendering picks the right gate. Helpers live in [src/ui/text-source.ts](../src/ui/text-source.ts) (resolution + `runTextPipeline`) and [src/ui/template-picker.ts](../src/ui/template-picker.ts) (the quick-picker modal). Shipped without the per-invocation "Replace source" checkbox; can revisit if users ask.

### Collapse API key settings: per-profile only, hide rarely-changed fields under "Advanced"

Removed the "Global API keys" section and the by-family `apiKeys` map. Each profile now owns its own transcription and LLM keys directly on `transcriptionConfig.apiKey` / `llmConfig.apiKey`. The per-profile fields are no longer framed as "overrides"; they're the only slot. "Transcription language" and "LLM max tokens" moved into a per-profile `<details>` "Advanced" disclosure. The resolver functions (`resolveTranscriptionApiKey`, `resolveLLMApiKey`) and family helpers (`transcriptionProviderFamily`, `llmProviderFamily`) are gone, along with the `ProviderFamily` type. `secrets.json.nosync` now only contains `profile:{kind}:{side}` IDs.
