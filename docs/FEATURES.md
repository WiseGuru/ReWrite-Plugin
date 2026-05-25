# ReWrite — Features To Add

Forward-looking backlog. Not committed to a release. Add items as they come up; move to a phase plan when picking one up.

## Open

### 1. Plugin-managed local whisper.cpp server (desktop) — Phase B (auto-start lifecycle)

Phase A shipped (see Done). Remaining work:

- "Start automatically when Obsidian opens" toggle (default off).
- "Stop when idle for N minutes" toggle (default off; useful for the large-v3 user who doesn't want 1.5 GB resident all day).
- Process supervision hardening based on real-world Phase A usage (zombies, orphans, signal handling differences across platforms).

---

## Done

### Plugin-managed local whisper.cpp server (Phase A: on-demand, button-driven)

Added [src/whisper-host.ts](../src/whisper-host.ts) `WhisperHost` class with `start` / `stop` / `status` / `baseUrl` / `getLog`. Lazy-requires `child_process`, `net`, `fs` inside a `Platform.isDesktop` guard (mirrors the [src/secrets.ts](../src/secrets.ts) `safeStorage` pattern). `start()` validates binary and model paths via `fs.existsSync`, probes the port via `net.createServer().listen(port)` to detect conflicts (does NOT kill unknown bound processes), spawns whisper-server, captures stdout/stderr to a 1 MB ring buffer, polls `net.createConnection` every 250ms for up to 5s before declaring `'running'`. `stop()` sends SIGTERM with a 3s SIGKILL fallback. New settings section "Local whisper.cpp server (desktop)" with binary/model/port fields, an Advanced disclosure for extra args, status indicator with Start/Stop button, and a View log disclosure (last ~50k chars of the ring buffer). New transcription provider option `'whisper-local'` filtered out of dropdowns on mobile; thin shim in [src/transcription/whisper-local.ts](../src/transcription/whisper-local.ts) POSTs to `http://127.0.0.1:<port>/v1/audio/transcriptions` (OpenAI-shaped). No API key field for this provider. [src/main.ts](../src/main.ts) instantiates the host in onload and fire-and-forget stops it in onunload. README has setup walkthrough + transparency disclosure. Phase B (auto-start lifecycle + idle timeout) deferred.

### Model field as a dropdown of available models

Added an optional `listModels(config, signal)` method to both `TranscriptionProvider` and `LLMProvider` interfaces. Implementations: OpenAI / Groq / Mistral (shared via the OpenAI-shaped adapter), Anthropic, Gemini, Deepgram. Skipped (text-only fallback): `openai-compatible` (URL-specific, list-shape varies), AssemblyAI, Rev.ai, Web Speech. Settings tab renders a hybrid Setting per model: dropdown of cached models + Refresh button (when the provider supports listing) plus an always-canonical text input that wins for "Custom" model names not yet in the dropdown. Cache lives at `GlobalSettings.modelCache.{transcription,llm}[providerId] = { ids, fetchedAt }`. No auto-fetch on settings open; the user clicks Refresh once their key is set. Errors surface via Notice with the provider-attributed `ProviderError` message.

### Act on existing text in a note

Added a `{ kind: 'text'; text: string }` source variant to the pipeline (skips transcription, same path as `paste`). Three entry points: `rewrite-plugin:process-text` command, an editor-menu item "ReWrite with template...", and a new "From note" tab in the main modal. All three resolve text from the active editor (selection if non-empty, otherwise whole note body) and open a lightweight template quick-picker before running. Setup-card gating split into voice (full check) vs text (LLM-only check) via `isProfileConfiguredForText` and a `purpose` param on `renderSetupCard`; the modal's per-tab rendering picks the right gate. Helpers live in [src/ui/text-source.ts](../src/ui/text-source.ts) (resolution + `runTextPipeline`) and [src/ui/template-picker.ts](../src/ui/template-picker.ts) (the quick-picker modal). Shipped without the per-invocation "Replace source" checkbox; can revisit if users ask.

### Collapse API key settings: per-profile only, hide rarely-changed fields under "Advanced"

Removed the "Global API keys" section and the by-family `apiKeys` map. Each profile now owns its own transcription and LLM keys directly on `transcriptionConfig.apiKey` / `llmConfig.apiKey`. The per-profile fields are no longer framed as "overrides"; they're the only slot. "Transcription language" and "LLM max tokens" moved into a per-profile `<details>` "Advanced" disclosure. The resolver functions (`resolveTranscriptionApiKey`, `resolveLLMApiKey`) and family helpers (`transcriptionProviderFamily`, `llmProviderFamily`) are gone, along with the `ProviderFamily` type. `secrets.json.nosync` now only contains `profile:{kind}:{side}` IDs.
