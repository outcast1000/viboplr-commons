// viboplr-commons — freely licensed photos from Wikimedia Commons.
//
// Design notes:
//  - FIND THE ARTIST, NOT THE WORDS. Free-text search of Commons matches file
//    titles, so a band named after a town gets the town. Instead the artist is
//    looked up on Wikidata, restricted to items carrying a MusicBrainz artist id
//    (P434 — i.e. music artists), and accepted only on an exact label/alias
//    match. Its Commons category (P373) and lead image (P18) are what we list.
//  - EVERY IMAGE CARRIES ITS CREDIT. Commons is free to reuse but most of it
//    needs attribution, so author + licence + file page travel with each image,
//    into the gallery's attribution line and into the assistant's answers.
//  - THE GALLERY IS ALSO CUE MATERIAL. The host's get_cue_context reads every
//    image_gallery info value, so the artist gallery here is what an assistant
//    writing a Now Playing cue sheet picks pictures from.
//  - WORKER RUNTIME. No fetch, only api.network.fetch, scoped to the two hosts
//    in the manifest. Image URLs we return are loaded by the app's webview.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
var COMMONS_API = "https://commons.wikimedia.org/w/api.php";
var WIKIDATA_API = "https://www.wikidata.org/w/api.php";
// Wikimedia's API policy asks for an identifying User-Agent with a contact.
var USER_AGENT = "Viboplr-Commons/0.1 (https://github.com/outcast1000/viboplr-commons)";
var TIMEOUT_MS = 15000;
var DISPLAY_WIDTH = 1280; // a standard Commons thumbnail step
var THUMB_WIDTH = 330; // likewise — other widths get snapped to a step anyway
var GALLERY_LIMIT = 16;
var GALLERY_MIN_WIDTH = 800;
// Wikidata's lead image (P18) is a person's pick for the artist, often an
// older, smaller file; it gets a lower bar than the category's bulk.
var LEAD_MIN_WIDTH = 400;
var DEFAULT_LIMIT = 20;
var MAX_LIMIT = 50;
var MAX_SUBCATEGORIES = 3;
var CAPTION_CAP = 240;
var AUTHOR_CAP = 80;
// Photos are JPEG (TIFF/WebP rarely). PNG and GIF on an artist's category are
// almost always logos, charts, screenshots and scans of text.
var PHOTO_MIMES = ["image/jpeg", "image/webp", "image/tiff"];
// Files a category carries that are about the artist but are not pictures of
// them. Matched against the file title only.
var NOT_A_PHOTO_DESCRIPTION = /^(an? |the )?(front |back )?(cover|logo|sleeve|scan)\b/i;
var NOT_A_PHOTO = /\b(logo|logotype|cover|sleeve|album art|artwork|signature|autograph|chart|diagram|map|poster|flyer|ticket|setlist|wordmark)s?\b/i;
var EXTMETADATA = "ImageDescription|ObjectName|Artist|LicenseShortName|LicenseUrl|DateTimeOriginal|AttributionRequired";

var api = null;

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------
function htmlToText(html) {
  if (typeof html !== "string") return "";
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); })
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function capText(text, max) {
  if (!text || text.length <= max) return text;
  var cut = text.slice(0, max);
  var space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "") + "…";
}

// Same normalization the host backend uses for names: NFD, drop combining
// marks, lowercase, keep only letters/numbers of any script.
function normName(s) {
  if (!s) return "";
  return String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function categoryTitle(name) {
  var n = String(name || "").trim().replace(/_/g, " ");
  if (!n) return "";
  return /^category:/i.test(n) ? "Category:" + n.replace(/^category:\s*/i, "") : "Category:" + n;
}

function categoryName(title) {
  return String(title || "").replace(/^Category:/, "");
}

// "Portishead (band)" → "portishead": what a subcategory about the same
// artist will contain.
function categoryStem(title) {
  return normName(categoryName(title).replace(/\s*\([^)]*\)\s*$/, ""));
}

// Commons tacks analytics parameters onto every URL it hands out.
function cleanUrl(url) {
  if (typeof url !== "string") return null;
  return url.replace(/\?utm_[^#]*$/, "");
}

function fileLabel(title) {
  return String(title || "").replace(/^File:/, "").replace(/\.[a-z0-9]{2,5}$/i, "");
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------
function query(base, params) {
  var parts = [];
  var keys = Object.keys(params);
  for (var i = 0; i < keys.length; i++) {
    var v = params[keys[i]];
    if (v === undefined || v === null) continue;
    parts.push(encodeURIComponent(keys[i]) + "=" + encodeURIComponent(String(v)));
  }
  return base + "?" + parts.join("&");
}

async function getJson(base, params) {
  var url = query(base, Object.assign({ format: "json", formatversion: 2 }, params));
  var resp = await api.network.fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept": "application/json" },
    timeoutMs: TIMEOUT_MS,
  });
  if (resp.status === 429) throw new Error("Wikimedia is rate-limiting requests — try again in a minute");
  if (resp.status < 200 || resp.status >= 300) throw new Error("Wikimedia answered HTTP " + resp.status);
  var data = await resp.json();
  if (data && data.error) throw new Error("Wikimedia: " + (data.error.info || data.error.code || "error"));
  return data;
}

// ---------------------------------------------------------------------------
// Wikidata: artist → Commons category + lead image
// ---------------------------------------------------------------------------
// Labels first, then aliases, every language: the label is what an item is
// called, an alias only what it is also called ("Bush" is an alias of George
// W. Bush, who has a MusicBrainz id too, and the label of the band).
function entityNames(entity, which) {
  var names = [];
  var labels = (entity && entity.labels) || {};
  var aliases = (entity && entity.aliases) || {};
  if (which === "labels") {
    // English (or the language-neutral "mul") first, so the label we report reads well.
    ["en", "mul"].concat(Object.keys(labels)).forEach(function (k) {
      if (labels[k] && labels[k].value && names.indexOf(labels[k].value) === -1) names.push(labels[k].value);
    });
  } else {
    Object.keys(aliases).forEach(function (k) {
      (aliases[k] || []).forEach(function (a) { if (a && a.value) names.push(a.value); });
    });
  }
  return names;
}

function matches(names, wanted) {
  for (var i = 0; i < names.length; i++) if (normName(names[i]) === wanted) return true;
  return false;
}

function claimString(claims, prop) {
  var list = claims && claims[prop];
  if (!Array.isArray(list)) return null;
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    if (c && c.rank === "deprecated") continue;
    var v = c && c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
    if (typeof v === "string" && v) return v;
  }
  return null;
}

// Returns { qid, label, category, image } or null when no music artist on
// Wikidata carries exactly this name.
async function findArtist(name) {
  var wanted = normName(name);
  if (!wanted) return null;
  var search = await getJson(WIKIDATA_API, {
    action: "query",
    list: "search",
    srsearch: String(name).replace(/["\\]/g, " ") + " haswbstatement:P434",
    srnamespace: 0,
    srlimit: 7,
  });
  var hits = (search && search.query && search.query.search) || [];
  var ids = hits.map(function (h) { return h.title; }).filter(function (t) { return /^Q\d+$/.test(t); });
  if (ids.length === 0) return null;

  // No language filter: a Greek or Japanese name only matches its own label.
  var ents = await getJson(WIKIDATA_API, {
    action: "wbgetentities",
    ids: ids.join("|"),
    props: "labels|aliases",
  });
  var entities = (ents && ents.entities) || {};
  var qid = null;
  // Keep search order within each pass: it ranks the better-known artist first.
  ["labels", "aliases"].forEach(function (which) {
    for (var i = 0; i < ids.length && !qid; i++) {
      if (matches(entityNames(entities[ids[i]], which), wanted)) qid = ids[i];
    }
  });
  var label = qid ? (entityNames(entities[qid], "labels")[0] || name) : null;
  if (!qid) return null;

  var claims = await getJson(WIKIDATA_API, { action: "wbgetentities", ids: qid, props: "claims" });
  var c = claims && claims.entities && claims.entities[qid] && claims.entities[qid].claims;
  return {
    qid: qid,
    label: label,
    category: claimString(c, "P373"),
    image: claimString(c, "P18"),
  };
}

// ---------------------------------------------------------------------------
// Commons: pages → images
// ---------------------------------------------------------------------------
function meta(ext, key) {
  var m = ext && ext[key];
  return m && typeof m.value === "string" ? m.value : "";
}

// One Commons file page (with imageinfo) → our image shape, or null when it
// isn't a usable photo.
function toImage(page, opts) {
  var info = page && page.imageinfo && page.imageinfo[0];
  if (!info || !info.url) return null;
  if (PHOTO_MIMES.indexOf(info.mime) === -1) return null;
  if (NOT_A_PHOTO.test(fileLabel(page.title))) return null;
  if (opts.minWidth && (info.width || 0) < opts.minWidth) return null;
  var ext = info.extmetadata || {};
  var description = capText(htmlToText(meta(ext, "ImageDescription")), CAPTION_CAP);
  if (NOT_A_PHOTO_DESCRIPTION.test(description)) return null;
  var author = capText(htmlToText(meta(ext, "Artist")), AUTHOR_CAP);
  var license = htmlToText(meta(ext, "LicenseShortName"));
  var date = htmlToText(meta(ext, "DateTimeOriginal")).slice(0, 10);
  var credit = [author ? "Photo: " + author : "", license, "via Wikimedia Commons"].filter(Boolean).join(", ");
  var image = {
    title: page.title,
    url: cleanUrl(info.thumburl || info.url),
    width: info.width || null,
    height: info.height || null,
    mime: info.mime,
    description: description || htmlToText(meta(ext, "ObjectName")) || fileLabel(page.title),
    date: date || null,
    author: author || null,
    license: license || null,
    licenseUrl: meta(ext, "LicenseUrl") || null,
    attributionRequired: meta(ext, "AttributionRequired") !== "false",
    credit: credit,
    pageUrl: info.descriptionurl || "https://commons.wikimedia.org/wiki/" + encodeURIComponent(String(page.title).replace(/ /g, "_")),
  };
  return image;
}

function imageInfoParams(width) {
  return {
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: width,
    iiextmetadatafilter: EXTMETADATA,
    iiextmetadatalanguage: "en",
  };
}

function sortedPages(data) {
  var pages = (data && data.query && data.query.pages) || [];
  // Generators return pages unordered; `index` carries search rank.
  return pages.slice().sort(function (a, b) {
    if (a.index != null && b.index != null) return a.index - b.index;
    return 0;
  });
}

// Files and subcategories of one category. { files: [page], subcategories: [title], more }
async function listCategory(title, max) {
  var data = await getJson(COMMONS_API, Object.assign({
    action: "query",
    generator: "categorymembers",
    gcmtitle: title,
    gcmtype: "file|subcat",
    gcmlimit: Math.min(MAX_LIMIT, Math.max(max, 1)),
  }, imageInfoParams(DISPLAY_WIDTH)));
  var pages = sortedPages(data);
  return {
    files: pages.filter(function (p) { return p.ns === 6; }),
    subcategories: pages.filter(function (p) { return p.ns === 14; }).map(function (p) { return p.title; }),
    more: !!(data && data.continue),
  };
}

async function filePages(titles) {
  if (titles.length === 0) return [];
  var data = await getJson(COMMONS_API, Object.assign({
    action: "query",
    titles: titles.join("|"),
  }, imageInfoParams(DISPLAY_WIDTH)));
  return ((data && data.query && data.query.pages) || []).filter(function (p) { return !p.missing; });
}

async function searchFiles(text, max) {
  var data = await getJson(COMMONS_API, Object.assign({
    action: "query",
    generator: "search",
    gsrsearch: text + " filetype:bitmap",
    gsrnamespace: 6,
    gsrlimit: Math.min(MAX_LIMIT, Math.max(max, 1)),
  }, imageInfoParams(DISPLAY_WIDTH)));
  return { files: sortedPages(data), more: !!(data && data.continue) };
}

// Fill in thumbUrl at THUMB_WIDTH for already-built images (one request per 50).
async function addThumbnails(images) {
  for (var start = 0; start < images.length; start += MAX_LIMIT) {
    var batch = images.slice(start, start + MAX_LIMIT);
    var data = await getJson(COMMONS_API, {
      action: "query",
      titles: batch.map(function (i) { return i.title; }).join("|"),
      prop: "imageinfo",
      iiprop: "url",
      iiurlwidth: THUMB_WIDTH,
    });
    var byTitle = {};
    ((data && data.query && data.query.pages) || []).forEach(function (p) {
      var info = p.imageinfo && p.imageinfo[0];
      if (info) byTitle[p.title] = cleanUrl(info.thumburl || info.url);
    });
    // The API normalizes titles it was given; map those back.
    var norm = (data && data.query && data.query.normalized) || [];
    norm.forEach(function (n) { if (byTitle[n.to]) byTitle[n.from] = byTitle[n.to]; });
    batch.forEach(function (img) { if (byTitle[img.title]) img.thumbUrl = byTitle[img.title]; });
  }
}

function pushImages(out, seen, pages, opts) {
  for (var i = 0; i < pages.length && out.length < opts.limit; i++) {
    if (seen[pages[i].title]) continue;
    var img = toImage(pages[i], opts);
    if (!img) continue;
    seen[pages[i].title] = true;
    out.push(img);
  }
}

// An artist's images: the Wikidata lead image first, then the category's own
// files, then subcategories about the same artist ("X in concert") until the
// limit is met. Returns null when the artist isn't found on Wikidata.
async function artistImages(name, opts) {
  var artist = await findArtist(name);
  if (!artist) return null;
  var images = [];
  var seen = {};
  if (artist.image) {
    var leadOpts = Object.assign({}, opts, { minWidth: Math.min(opts.minWidth || 0, LEAD_MIN_WIDTH) });
    pushImages(images, seen, await filePages(["File:" + artist.image]), leadOpts);
  }
  var subcategories = [];
  var more = false;
  if (artist.category) {
    var title = categoryTitle(artist.category);
    var listing = await listCategory(title, MAX_LIMIT);
    pushImages(images, seen, listing.files, opts);
    subcategories = listing.subcategories;
    more = listing.more;
    var stem = categoryStem(title);
    var related = subcategories.filter(function (s) { return stem && normName(categoryName(s)).indexOf(stem) !== -1; });
    for (var i = 0; i < related.length && i < MAX_SUBCATEGORIES && images.length < opts.limit; i++) {
      var sub = await listCategory(related[i], MAX_LIMIT);
      pushImages(images, seen, sub.files, opts);
    }
  }
  // A category also collects things around the artist (their house, a fan's
  // CD). Pictures that name the artist come first; the lead image stays first.
  var artistStem = normName(artist.label);
  var lead = artist.image && images.length && images[0].title === "File:" + artist.image.replace(/_/g, " ") ? 1 : 0;
  var ranked = images.slice(lead).map(function (img, i) {
    var named = normName(img.title).indexOf(artistStem) !== -1 || normName(img.description).indexOf(artistStem) !== -1;
    return { img: img, rank: named ? 0 : 1, i: i };
  });
  ranked.sort(function (a, b) { return a.rank - b.rank || a.i - b.i; });
  images = images.slice(0, lead).concat(ranked.map(function (r) { return r.img; }));
  return {
    source: {
      kind: "artist",
      artist: artist.label,
      wikidata: "https://www.wikidata.org/wiki/" + artist.qid,
      category: artist.category ? categoryTitle(artist.category) : null,
    },
    images: images,
    subcategories: subcategories.map(categoryName),
    more: more,
  };
}

// ---------------------------------------------------------------------------
// Information type: artist Photos gallery
// ---------------------------------------------------------------------------
// "On stage in Lisbon" + 2008-03-27 → "On stage in Lisbon (2008)", unless the
// caption already says the year.
function withYear(caption, date) {
  var year = date ? date.slice(0, 4) : "";
  if (!/^\d{4}$/.test(year) || caption.indexOf(year) !== -1) return caption;
  return caption + " (" + year + ")";
}

function galleryValue(images) {
  return {
    images: images.map(function (img) {
      return {
        url: img.url,
        caption: withYear(img.description, img.date),
        source: [img.author, img.license].filter(Boolean).join(" · ") || "Wikimedia Commons",
        pageUrl: img.pageUrl,
        author: img.author || undefined,
        license: img.license || undefined,
        width: img.width || undefined,
        height: img.height || undefined,
      };
    }),
  };
}

async function fetchArtistPhotos(entity) {
  if (!entity || !entity.name) return { status: "not_found" };
  try {
    var result = await artistImages(entity.name, { minWidth: GALLERY_MIN_WIDTH, limit: GALLERY_LIMIT });
    if (!result || result.images.length === 0) return { status: "not_found" };
    return { status: "ok", value: galleryValue(result.images) };
  } catch (e) {
    api.log("error", "Photos for " + entity.name + " failed: " + (e && e.message ? e.message : e));
    return { status: "error", message: e && e.message ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Assistant tool: search_images
// ---------------------------------------------------------------------------
function intArg(v, def, min, max) {
  if (v === undefined || v === null || v === "") return def;
  var n = Number(v);
  if (!isFinite(n)) throw new Error("expected a number, got " + JSON.stringify(v));
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function strArg(v) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

async function searchImages(args) {
  args = args || {};
  var artist = strArg(args.artist);
  var category = strArg(args.category);
  var text = strArg(args.query);
  var given = [artist, category, text].filter(Boolean).length;
  if (given !== 1) throw new Error("Give exactly one of artist, category or query");
  var opts = {
    minWidth: intArg(args.minWidth, GALLERY_MIN_WIDTH, 0, 10000),
    limit: intArg(args.limit, DEFAULT_LIMIT, 1, MAX_LIMIT),
  };

  var result;
  if (artist) {
    result = await artistImages(artist, opts);
    if (!result) {
      return {
        source: { kind: "artist", artist: artist },
        images: [],
        note: "No music artist named exactly '" + artist + "' on Wikidata. Try category with a guess at their Commons category, or query.",
      };
    }
    if (!result.source.category) {
      result.note = "This artist has no Commons category on Wikidata; only their lead image (if any) is listed.";
    }
  } else if (category) {
    var title = categoryTitle(category);
    var listing = await listCategory(title, MAX_LIMIT);
    var images = [];
    pushImages(images, {}, listing.files, opts);
    result = {
      source: { kind: "category", category: title },
      images: images,
      subcategories: listing.subcategories.map(categoryName),
      more: listing.more,
    };
    if (listing.files.length === 0 && listing.subcategories.length === 0) {
      result.note = "'" + title + "' is empty or does not exist on Commons.";
    }
  } else {
    var found = await searchFiles(text, MAX_LIMIT);
    var hits = [];
    pushImages(hits, {}, found.files, opts);
    result = {
      source: { kind: "query", query: text },
      images: hits,
      more: found.more,
      note: "Free-text matches — check each caption is really about what you searched for.",
    };
  }

  if (args.thumbnails === true && result.images.length > 0) await addThumbnails(result.images);
  return result;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
function activate(pluginApi) {
  api = pluginApi;
  api.informationTypes.onFetch("artist_photos", fetchArtistPhotos);
  if (api.assistant) api.assistant.onTool("search_images", searchImages);
}

function deactivate() {
  api = null;
}

return {
  activate: activate,
  deactivate: deactivate,
  // Exposed for tests.
  _htmlToText: htmlToText,
  _capText: capText,
  _normName: normName,
  _categoryTitle: categoryTitle,
  _categoryStem: categoryStem,
  _cleanUrl: cleanUrl,
  _toImage: toImage,
  _galleryValue: galleryValue,
  _withYear: withYear,
  _findArtist: findArtist,
  _searchImages: searchImages,
  _fetchArtistPhotos: fetchArtistPhotos,
};
