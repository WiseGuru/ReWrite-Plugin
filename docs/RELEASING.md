# Releasing ReWrite (Voice Notes)

How to cut a new release the Obsidian way, without tripping the community-plugin review. Read this before every release.

Releases are automated by [.github/workflows/release.yml](../.github/workflows/release.yml): pushing a version tag builds the bundle, attaches build-provenance attestations, and publishes the GitHub release. Your job is the version bump, the pre-flight checks, and pushing a correctly named tag.

## TL;DR

```bash
# 0. On master, clean working tree, everything you want shipped is committed.
npm run build && npm run lint          # must both pass
# 1. Bump version files (no auto commit/tag so we control the message)
npm version patch --no-git-tag-version # or minor / major
# 2. Commit the bump
git add manifest.json package.json package-lock.json versions.json
git commit -m "1.0.1"                  # use the new version as the subject
# 3. Tag with the BARE version (no leading v) and push
git tag -a 1.0.1 -m "Release 1.0.1"
git push origin master
git push origin 1.0.1
# 4. Watch CI, then verify provenance (see Verify below)
```

The tag name must equal `manifest.json`'s `version` exactly. `.npmrc` already pins `tag-version-prefix=""`, so `npm version` produces a bare tag too if you ever let it tag directly.

## Hard rules (Obsidian requirements)

- **No `v` in the tag.** The release tag must match `manifest.json` `version` character-for-character: `1.0.1`, never `v1.0.1`.
- **Three loose asset files.** `main.js`, `manifest.json`, `styles.css` attached as individual binary assets, never zipped. The workflow does this; do not hand-upload.
- **A new release needs a new version number.** Obsidian's automated review only registers a change when the version increments. Re-pushing the same version does not count as a new submission. Bump the patch/minor/major rather than overwriting a published version.
- **`minAppVersion` must be >= the highest `@since` of every Obsidian API you call directly** (anything not behind a runtime feature-detect). Check `node_modules/obsidian/obsidian.d.ts` for the `@since` of new APIs. Example from this project: `FileManager.processFrontMatter` is `@since 1.4.4`, which is why `minAppVersion` is `1.4.4`. Feature-detected APIs (like `app.secretStorage`) do not raise the floor.
- **`versions.json` maps plugin version -> minAppVersion.** Our [version-bump.mjs](../version-bump.mjs) only adds a new line when the `minAppVersion` value is not already present (i.e. when the floor actually changes). That is valid: Obsidian reads the latest version straight from the release `manifest.json`, and consults `versions.json` only to find the newest plugin version compatible with an older app. If you raise `minAppVersion`, confirm a new `versions.json` entry was written; if you keep it, no new line is expected.
- **Public repo + LICENSE.** The repo must be public to be listed, with a real LICENSE whose copyright holder is correct (this plugin is 0BSD). The README must disclose network use, and `manifest.json` carries `author`, `authorUrl`, and (if you take donations) `fundingUrl`.

## Pre-flight checklist

1. `npm run build` passes (this is `tsc -noEmit` then esbuild production; a type error here is a release blocker).
2. `npm run lint` passes with zero warnings. The local `eslint-plugin-obsidianmd` is looser than the official review bot, so also eyeball the conflict checklist below.
3. Manual smoke test in a real vault for anything you touched. At minimum for a code change: record + Quick Record, run a template insert (cursor / new file / append), and on desktop start the local whisper.cpp server. Install by copying `main.js` / `manifest.json` / `styles.css` into `<Vault>/.obsidian/plugins/rewrite-voice-notes/` (folder name must match the plugin `id`) and reloading.
4. Update docs for any behavioral change ([CLAUDE.md](../CLAUDE.md) and the user-facing template guide), per the doc-maintenance rules in CLAUDE.md.

## Guideline-conflict checklist (what the review bot flags)

These are the recurring findings; clear them before tagging. Most are also why the items above exist.

- **Plugin `id`**: lowercase letters and hyphens only, must not end in `plugin`, must not contain `obsidian`. Locked once published; do not change it. (Ours is `rewrite-voice-notes`.)
- **No newer-than-minAppVersion APIs**: see the `minAppVersion` rule above.
- **No `eslint-disable` directives.** The bot rejects disabling its rules. If a string trips `ui/sentence-case` (e.g. a random example), pass it through a variable instead of a string literal; the rule only inspects literals.
- **Popout-window safety**: use `activeDocument` / `activeWindow` instead of `document` / `window`-as-globalThis where a popout could differ; use `window.setTimeout` / `window.clearTimeout` (not bare `setTimeout`); avoid `globalThis` (use `window`). For paired `addEventListener` / `removeEventListener`, capture one document reference so removal targets the same object.
- **No `!important` in [styles.css](../styles.css).** Raise specificity, use CSS variables, or toggle via Obsidian's `el.toggle()` / `hide()` / `show()` (which set inline display) instead.
- **Manifest `description`**: action-focused, <= 250 chars, ends with a period, no emoji.
- **Build provenance**: leave releases to CI so the attestation is generated; hand-uploaded assets are unattested.
- **Deferred by choice** (document, do not silently regress): the `display()` -> `getSettingDefinitions` settings migration (needs minAppVersion 1.13.0+, deferred) and full-vault enumeration (`getFiles` for audio collection is necessary and disclosed in the README "Vault access" section).

See [DEVCONFLICTS.md](DEVCONFLICTS.md) for the full history of conflicts found and how each was resolved or accepted.

## What the CI workflow does

On any pushed tag, [.github/workflows/release.yml](../.github/workflows/release.yml):

1. checks out, sets up Node 20, `npm ci`,
2. `npm run build` (produces `main.js`; `manifest.json` and `styles.css` are already in the repo),
3. `actions/attest-build-provenance@v2` over the three assets (cryptographic provenance proving they were built from source),
4. `softprops/action-gh-release@v2` publishes/updates the release for that tag with the three assets.

It runs with `permissions: contents: write, id-token: write, attestations: write`. If you ever change the workflow, keep all three permissions or attestation fails.

## Verify (after pushing the tag)

```bash
gh run watch <run-id> --repo WiseGuru/ReWrite-Voice-Notes --exit-status   # must exit 0
# Provenance check against the published asset:
gh release download 1.0.1 --repo WiseGuru/ReWrite-Voice-Notes --dir /tmp/rel --clobber
gh attestation verify /tmp/rel/main.js --repo WiseGuru/ReWrite-Voice-Notes # must exit 0
```

Also confirm the release page shows the bare tag (`1.0.1`, no `v`) and all three assets.

## Re-releasing the same version (rare)

Only for fixing a botched release that nobody has consumed, and never once the version is accepted/depended on. Move the tag to the new commit and force-push to re-trigger CI:

```bash
git tag -d 1.0.1 && git tag -a 1.0.1 -m "Release 1.0.1"
git push origin 1.0.1 --force
```

For anything the community review should notice, cut a new version instead.

## Submitting to the community list (first time only)

After a clean, attested release exists on a public repo, open a PR against [obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases) adding an entry to `community-plugins.json` with `id`, `name`, `author`, `description`, and `repo` set to `WiseGuru/ReWrite-Voice-Notes`. The automated reviewer runs the same checks in the conflict checklist above against your latest release.
