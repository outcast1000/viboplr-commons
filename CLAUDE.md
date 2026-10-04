# CLAUDE.md

Viboplr plugin `commons` ("Wikimedia Commons"). Plugin = `index.js` (a function
body returning `{ activate, deactivate, _testHooks… }`) + `manifest.json`. Worker
runtime (`"runtime": "worker"`): no `fetch`, only `api.network.fetch`, and only to
the hosts in `permissions`.

## Rules

- **Artist by Wikidata, never by free text.** The gallery resolves the artist on
  Wikidata (`haswbstatement:P434` = has a MusicBrainz artist id) and accepts an
  exact normalized name match only — labels in every language before aliases.
  Free-text Commons search is the tool's last resort and says so in its `note`.
- **Every image keeps its credit.** Author, licence and file page travel with each
  image (gallery `source`/`pageUrl`/`author`/`license`; tool `credit`). Most
  Commons licences require attribution — never drop them.
- **Photos only.** `PHOTO_MIMES` + `NOT_A_PHOTO` / `NOT_A_PHOTO_DESCRIPTION`.
- **Use the URLs the API returns.** Commons snaps thumbnail widths to standard
  steps (330, 500, 960, 1280…); never build a thumbnail URL by hand.
- **Identify ourselves.** Every request sends `USER_AGENT` (Wikimedia API policy)
  and a `timeoutMs`.
- `search_images` must stay `readOnly: true` in the manifest.
- The gallery feeds the app's `get_cue_context` (`images`), which keeps https URLs
  only — keep `url` https.

## Commands

```
npm test        # node --test (test/*.test.js), no dependencies
npm run check   # node --check index.js
node scripts/live.cjs gallery "<artist>"     # against the real APIs
node scripts/live.cjs search '<json args>'
```

`test/harness/sandbox.js` loads `index.js` the way the worker does and shadows
the globals the worker deletes; `test/harness/host.js` is a fake plugin API that
routes `network.fetch` to the fixtures in `test/fixtures.js`.
