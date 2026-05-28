# Mobile keyboard covers plugin text boxes (Android) — investigation log

Status: **UNRESOLVED.** Three substantively different code approaches have produced no
observable change on the user's Android device. This document records everything tried so
the problem can be tackled methodically (instrument first, then fix) rather than by more
blind guessing.

## Problem statement

On Android, when a text field managed by the plugin receives focus, the on-screen software
keyboard slides up and covers the text field. The field does not move out of the way, so the
user cannot see what they are typing. The expected behavior (seen in Obsidian core UIs and in
other plugins) is that the focused field scrolls/repositions above the keyboard.

Reporter platform: Android, Obsidian mobile. Desktop and iOS are not affected (the helper
early-returns on `!Platform.isMobile`, and iOS WebKit resizes the layout viewport when the
keyboard opens, which makes naive `scrollIntoView` work there).

## Test matrix

The reporter exercises these flows, positioning each field low enough that the keyboard would
overlap it:

| # | Flow | Surface | Container | Last reported result |
|---|------|---------|-----------|----------------------|
| 1 | Quick controls (bottom-right hamburger) → ReWrite → tap **Unlock** | Passphrase unlock prompt | `PassphraseModal` (popup) | FAIL |
| 2 | Quick controls → ReWrite → **Paste** → tap textarea | Paste tab textarea | `ReWriteModal` (popup) | FAIL |
| 3 | Sidebar → Settings gear → ReWrite (Voice Notes) → scroll to **Change passphrase** → tap both fields | Change-passphrase prompt | `PassphraseModal` (popup, `requireConfirm`) | FAIL |
| 4 | Sidebar → Settings gear → ReWrite (Voice Notes) → tap a field (transcription API key, assistant name, attachments folder, etc.) | Settings tab field | `ReWriteSettingTab` (settings panel) | PASS (confirmed still passing) |

**Disambiguation (confirmed by reporter):** test 4 still succeeds; tests 1-3 still fail. So the
split is stable: scrollable settings surface works, fixed-position popups do not.

**Critical caveat — this does NOT prove our code runs.** Test 4 passing is most likely *native
browser / Obsidian-core* behavior, not our helper. Chrome on Android natively scrolls a focused
input into view within its nearest scrollable ancestor, and is keyboard-aware when doing so. The
settings panel is exactly that: a tall scrollable surface. A fixed-position centered popup is not,
so native focus-scroll cannot move it and the field stays covered. In other words, the test 4 /
tests 1-3 split is fully explained by *the browser*, with our helper contributing nothing in any of
the four cases. **Hypothesis A (our code is a silent no-op because `visualViewport` never changes)
remains fully alive.** We still have zero positive evidence that `installMobileKeyboardScrollFix`
mutates anything on the device.

The reporter confirmed the build was deployed cleanly: they deleted the plugin's `main.js`,
`manifest.json`, and `styles.css` and recreated them (keeping `data.json` and
`secrets.json.nosync`), so stale-artifact caching is ruled out.

## The code under test

All attempts live in one helper: `installMobileKeyboardScrollFix(root)` in
[src/platform.ts](../src/platform.ts). It is attached (via `focusin`, which bubbles) to:

- [src/ui/modal.ts](../src/ui/modal.ts) line 31 — main modal `contentEl`
- [src/settings/tab.ts](../src/settings/tab.ts) line 69 — settings `containerEl`
- [src/ui/passphrase-modal.ts](../src/ui/passphrase-modal.ts) line 29 — passphrase modal `contentEl` (added this session)
- [src/insert.ts](../src/insert.ts) line 121 — `RenamePromptModal` `contentEl` (added this session)

The helper early-returns unless `Platform.isMobile`.

## Chronology of attempts

### Attempt 0 — pre-existing baseline (before this investigation)

- **Mechanism:** `focusin` → `setTimeout(300ms)` → `target.scrollIntoView({ block: 'center', behavior: 'smooth' })`.
- **Wired into:** main modal + settings tab only.
- **Theory:** scroll the focused input to the center of its scroll container after the keyboard
  animation starts.
- **Why it can't work on Android:** `scrollIntoView({ block: 'center' })` centers the element in
  the *layout* viewport (the full screen). Android (unlike iOS) does not shrink the layout
  viewport when the keyboard opens, so "center of the full screen" is still behind the keyboard's
  top edge for low fields.

### Attempt 1 — visualViewport + scroll nearest scrollable ancestor

- **Change:** Rewrote the helper to read `window.visualViewport`. On `focusin`: if the visual
  viewport is already shrunk act immediately, else wait for a one-shot `visualViewport` `resize`
  (600 ms safety timeout). Then compute `visibleBottom = vv.offsetTop + vv.height`, and if the
  input's `rect.bottom` is below `visibleBottom - 16`, scroll the nearest scrollable ancestor by
  the delta (fallback `window.scrollBy`). Kept a `scrollIntoView` fallback for when
  `visualViewport` is unavailable.
- **Also:** wired the helper into `PassphraseModal` and `RenamePromptModal`.
- **Theory:** `visualViewport` reflects the real post-keyboard visible region on Android even
  though the layout viewport does not, so we can scroll precisely.
- **Result:** Reporter: test 4 (settings) works; tests 1-3 (popups) fail.

### Attempt 2 — translate the `.modal` box via CSS transform

- **Change:** Added a branch: when no scrollable ancestor is found, walk up to the `.modal`
  element and apply a composed `transform: <computed> translateY(-delta)` to lift the modal box,
  restoring on `blur`. Composition read the current computed transform so as not to wipe
  Obsidian's centering transform.
- **Theory:** short popups have no scroll room, so the scroll path did nothing; lift the whole
  fixed-position modal instead.
- **Result:** Reporter: still broken for tests 1-3.

### Attempt 3 — shrink `.modal-container` so flex re-centers the popup

- **Change (current code):** Two-step in `liftAboveKeyboard`: (1) scroll the nearest scrollable
  ancestor and re-measure; (2) if the input is still below the visible region, walk up to
  `.modal-container` and set inline `top = vv.offsetTop` and `height = vv.height`, shrinking the
  fixed-position container to the visible region so Obsidian's flex centering re-positions
  `.modal` above the keyboard. Restore on `blur`; re-fit on subsequent `visualViewport` `resize`;
  fully restore when `vv.height` returns to near `window.innerHeight`.
- **Theory:** `.modal-content` actually has `overflow: auto`, so Attempt 2's scroll path was being
  taken and the transform branch never ran. Scrolling inside `.modal-content` shifts the input
  within the modal but cannot move the fixed, centered modal itself; shrinking the container makes
  the existing flex centering do the work.
- **Result:** Reporter: "No change for any of the tests."

## Current code (verbatim summary)

`liftAboveKeyboard(target, vv)`:
1. `visibleBottom = vv.offsetTop + vv.height`. If `rect.bottom <= visibleBottom - 16`, **return
   (do nothing)** — we believe the input is already visible.
2. Scroll nearest scrollable ancestor by delta; re-measure; return if now visible.
3. Else shrink `.modal-container` (`top`/`height`), restore on blur.
4. Else `window.scrollBy`.

The entry path waits for `visualViewport.resize` (or acts immediately if `vv.height <
window.innerHeight - 100`), with a 600 ms fallback timer.

## Unverified assumptions (the heart of the problem)

We have been writing code against a mental model that has **never been confirmed on the actual
device**. Every one of these is a guess:

1. **That the `focusin` listener fires at all.** Never confirmed. If `Platform.isMobile` is
   somehow false, or the listener is attached to the wrong element, nothing runs.
2. **That `window.visualViewport` shrinks when the Android keyboard opens.** This is the load-bearing
   assumption for all three attempts, and it is the most suspect (see hypothesis A).
3. **That `window.innerHeight` does / doesn't change** when the keyboard opens (drives the
   "already up" check and the restore condition).
4. **The DOM structure and class names** of Obsidian mobile modals (`.modal-container` > `.modal` >
   `.modal-content`), and that `.modal-content` has `overflow: auto`, and that `.modal-container`
   centers via flex. Never inspected on device.
5. **That step 1's early-return condition is ever false on the device.** If `visualViewport` does
   not shrink, `rect.bottom <= visibleBottom - 16` is always true and the function is a guaranteed
   no-op — which would perfectly explain "no change for any approach."
6. **Whether test 4 "working" is our code or Obsidian's own behavior.** If Obsidian core scrolls
   its own settings panel on focus, test 4 would "pass" regardless of our helper, and we have zero
   evidence our code does anything anywhere.

## Leading hypotheses (ranked)

### A. `visualViewport` does not reflect the keyboard in Obsidian's WebView (most likely)

Obsidian mobile is a Capacitor app. The Capacitor **Keyboard** plugin has a `resize` mode
(`native` / `body` / `ionic` / `none`). If Obsidian uses `resize: 'none'` (keyboard overlays
content), then **neither `window.innerHeight` nor `window.visualViewport.height` changes** when the
keyboard opens — the keyboard simply floats on top. In that case:

- The entry "already up" check (`vv.height < innerHeight - 100`) is never true.
- The `visualViewport` `resize` event may never fire, so we fall to the 600 ms timer.
- When `liftAboveKeyboard` finally runs, `visibleBottom` equals the full-screen bottom, so
  `rect.bottom <= visibleBottom - 16` is true and **we return immediately, doing nothing.**

This single hypothesis explains why three completely different mutation strategies all produced
no visible change: **none of them ever executed their mutation.** This is the first thing to
verify.

If true, the correct signal is the Capacitor keyboard event, not `visualViewport`. Capacitor
dispatches DOM events on `window`: `keyboardWillShow` / `keyboardDidShow` (with
`event.keyboardHeight`) and `keyboardWillHide` / `keyboardDidHide`. Obsidian is known to surface
these. The fix would key off `keyboardHeight` instead of `visualViewport`.

### B. The listener never fires / wrong element

Less likely given the helper is attached at four call sites, but unproven. Would also explain
"no change anywhere."

### C. `visualViewport` works, but our DOM model is wrong

If `visualViewport` does shrink (so step 1 does not early-return) but `.modal-container` is not the
real class, or it does not center via flex, or `top/height` are overridden by `!important` rules,
then step 3 silently fails. This is plausible only if hypothesis A is false.

## Recommended next step: instrument before fixing

Stop guessing. Add a temporary on-screen diagnostic (a `Notice`, or a fixed debug `<div>`) that
fires on `focusin` and again ~400 ms later, dumping the real numbers. Because remote DevTools on
Android Obsidian is fiddly, an on-screen readout is the lowest-friction way to get ground truth.

Capture, at focus time and after a delay:

- `Platform.isMobile`
- `window.innerHeight` before vs. after keyboard
- `window.visualViewport?.height`, `.offsetTop`, `.pageTop` before vs. after
- whether a `visualViewport` `resize` event fired (counter)
- whether any `keyboardDidShow` window event fired, and its `keyboardHeight` if present
- the focused element's `getBoundingClientRect().bottom`
- the chain of ancestor class names from the input up to `body` (to confirm `.modal-container` /
  `.modal` / `.modal-content` and which one, if any, is scrollable)

The single most important data point: **does `visualViewport.height` (or `innerHeight`) actually
decrease when the keyboard appears?** If no, hypothesis A is confirmed and we pivot to Capacitor
keyboard events. If yes, hypothesis A is dead and we debug the DOM model (hypothesis C).

If feasible, also enable remote debugging: connect the Android device over USB, open
`chrome://inspect` in desktop Chrome, inspect the Obsidian WebView, and watch the DOM/visualViewport
live while focusing a field. This is the gold-standard confirmation.

## Alternative fix approaches not yet tried

Pursue these only after instrumentation tells us which signal is real.

1. **Capacitor keyboard events (most promising if hypothesis A holds).** Listen on `window` for
   `keyboardWillShow` / `keyboardDidShow` and read `event.keyboardHeight`. Apply a bottom inset
   (e.g. `padding-bottom` on the scrollable region, or shrink `.modal-container` by
   `keyboardHeight`) and reverse it on `keyboardWillHide` / `keyboardDidHide`. This does not depend
   on `visualViewport` updating.
2. **CSS environment inset.** Newer WebViews expose `env(keyboard-inset-height)` /
   `env(keyboard-inset-bottom)` when the page opts in via the `interactive-widget` viewport meta —
   but a plugin cannot set the viewport meta, so this likely requires Obsidian-level support.
   Worth testing whether the env vars are non-zero on the device anyway.
3. **Pure CSS positioning of popups.** Anchor `.rewrite-modal` / `.rewrite-passphrase-modal` to the
   top of the screen on mobile (e.g. `.is-mobile .modal { top: 8px; transform: none; }`) so even a
   non-moving modal sits above where the keyboard appears. Crude, but independent of any JS signal,
   and a useful diagnostic: if a top-anchored modal is still covered, the keyboard is taller than
   assumed or our CSS is being overridden.
3b. **Make popups behave like the settings surface (highest-leverage, given the confirmed split).**
   The one thing that demonstrably works is a tall scrollable container (settings tab) where native
   keyboard-aware focus-scroll does the job. Mimic that for popups: on mobile, top-anchor the popup
   and give its content a scrollable region that can extend below the fold
   (`.is-mobile .rewrite-modal { top: 0; transform: none; max-height: 100%; }` plus an
   `overflow-y: auto` content area with enough height that the focused field can scroll up). If the
   browser then scrolls popup fields into view the same way it does settings fields, the bug is
   fixed without relying on `visualViewport` or Capacitor events at all. This is CSS-first and
   signal-independent, and it directly transplants the working case onto the failing cases — try it
   before the JS-signal approaches.
4. **Ask whether Obsidian already exposes a hook.** Check Obsidian's mobile behavior and any
   documented API for keyboard insets before reinventing it; mirror whatever the core settings
   panel does (since test 4 historically worked, the core mechanism is worth copying directly).
5. **Confirm the `webspeech` removal / unrelated churn isn't interfering.** Unlikely, but the
   working tree has broad uncommitted changes; verify the helper is actually the code shipping in
   `main.js` (search the built bundle for `visualViewport` / `modal-container`).

## Key references

- Helper: [src/platform.ts](../src/platform.ts) `installMobileKeyboardScrollFix` / `liftAboveKeyboard`
- Call sites: [src/ui/modal.ts](../src/ui/modal.ts):31, [src/settings/tab.ts](../src/settings/tab.ts):69, [src/ui/passphrase-modal.ts](../src/ui/passphrase-modal.ts):29, [src/insert.ts](../src/insert.ts):121
- Digital Garden plugin (referenced by the reporter as a working example): its Appearance modal is a
  bare `new Modal(app)` with **no** keyboard-handling code — its good behavior comes from Obsidian
  core, not plugin code. So "copy Digital Garden" reduces to "copy Obsidian core's modal behavior."
- Gotcha entry summarizing the helper: [CLAUDE.md](../CLAUDE.md) (search "Mobile keyboard scroll").
