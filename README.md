# Wikimedia Commons for Viboplr

Freely licensed photos of your artists, from [Wikimedia Commons](https://commons.wikimedia.org).

- **Photos on artist pages.** A Photos tab on the artist page: the artist's own Commons photos,
  each one credited to its photographer with its licence. Click the credit to open the file's
  Commons page.
- **Real pictures for Now Playing cue sheets.** When an AI assistant writes a cue sheet
  (`get_cue_context`), this gallery is part of the material it gets, so its image cards show real,
  credited photos instead of guessed URLs.
- **An assistant tool.** `search_images` (MCP: `commons__search_images`) searches Commons by artist,
  by category or by free text. It is read-only, so it works without switching on Settings → AI
  control → Plugin actions.

## How it finds the right artist

Searching Commons by name returns anything with the words in its title, so a band named after a
town gets photos of the town. Instead the plugin looks the artist up on **Wikidata**, only among
items that carry a MusicBrainz artist id (that is, music artists), and accepts only an exact match
on the name, ignoring case and accents. A main label beats an alias, so "Bush" is the band and not
the president. From that item it takes the lead image and the artist's Commons category, then lists
the category's photos plus up to three subcategories about the same artist ("… in concert").
Members' own categories are left out.

Only photos are kept: JPEG/WebP/TIFF of at least 800px wide (the Wikidata lead image only needs
400px), and no logos, covers, charts or scans. Photos whose title or caption names the artist come
first.

## Limits

- An artist with no Commons category on Wikidata gets at most their lead image, and an artist with
  neither gets no gallery.
- Captions are written by uploaders. They may be wrong or in another language, and some categories
  hold things *around* the artist (their house, a fan's CD).
- The gallery is cached for 30 days, like other information sections.

## Permissions

Worker plugin. It asks for `network:commons.wikimedia.org` and `network:www.wikidata.org` and
nothing else. The images themselves are loaded from `upload.wikimedia.org` / `thumb.wikimedia.org`
by the app, the same way it loads any artist image.

## Development

```
npm test                                      # node --test, no dependencies
npm run check                                 # node --check index.js
node scripts/live.cjs gallery "Portishead"    # the artist gallery, against the real APIs
node scripts/live.cjs search '{"artist":"Björk","limit":5,"thumbnails":true}'
```

Release: bump `version` in `manifest.json`, add a `CHANGELOG.md` entry, then
`git tag vX.Y.Z && git push origin vX.Y.Z`. The Release workflow builds `commons.zip` and
`update.json` and publishes them; never run `gh release create` by hand.
