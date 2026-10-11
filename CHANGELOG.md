# Changelog

## v0.2.2
- Each permission now says why the plugin needs it, shown under it when Viboplr asks. No functional changes.

## v0.2.1
- Releases are now signed with the Viboplr plugin-signing key, so Viboplr allows the permissions this plugin asks for without prompting. No functional changes.

## 0.2.0

- The Photos tab's information type is now `artist_photos`, a shared name, so a future artist-photo provider joins the same Photos tab (orderable in Settings → Providers) instead of adding a second one. Photos cached under the old name are fetched again once.

## 0.1.0

- First release. Freely licensed photos from Wikimedia Commons.
- Artist pages: a Photos gallery with the artist's own Commons photos, each credited to its photographer with its licence. The credit links to the file's Commons page (Viboplr 1.0.89+).
- Finds the artist through Wikidata (exact name, music artists only) so the photos are of the right artist, not of something with the same name.
- Now Playing cue sheets: an AI assistant writing one gets this gallery as picture material (Viboplr 1.0.89+).
- `search_images` assistant tool (read-only): search Commons by artist, category or free text, with author, licence, credit line and optional thumbnails.
- Needs Viboplr 1.0.85 or newer.
