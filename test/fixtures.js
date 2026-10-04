// Wikimedia responses shaped like the real ones (recorded against the live API
// on 2026-10-05 and trimmed): formatversion=2, pages as arrays, extmetadata
// values as { value } objects carrying HTML.

function filePage(title, o = {}) {
  const name = title.replace(/^File:/, "").replace(/ /g, "_");
  return {
    ns: 6,
    title,
    index: o.index,
    imageinfo: [{
      url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${name}`,
      thumburl: `https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/${name}/1280px-${name}?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail`,
      descriptionurl: `https://commons.wikimedia.org/wiki/${name}`,
      width: o.width ?? 2000,
      height: o.height ?? 1400,
      mime: o.mime ?? "image/jpeg",
      extmetadata: {
        ObjectName: { value: title.replace(/^File:/, "").replace(/\.\w+$/, "") },
        ImageDescription: { value: o.description ?? "<p>Beth Gibbons (Portishead) at Coliseu dos Recreios, Lisbon&nbsp;</p>" },
        Artist: { value: o.artist ?? '<a rel="nofollow" class="external text" href="https://www.flickr.com/people/x">José Goulão</a>' },
        LicenseShortName: { value: o.license ?? "CC BY-SA 2.0" },
        LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/2.0" },
        DateTimeOriginal: { value: o.date ?? "2008-03-27 23:20" },
        AttributionRequired: { value: "true" },
      },
    }],
  };
}

function subcat(title) {
  return { ns: 14, title };
}

const PORTISHEAD = {
  search: { query: { search: [{ ns: 0, title: "Q191352" }, { ns: 0, title: "Q1373294" }, { ns: 0, title: "Q233264" }] } },
  labels: {
    entities: {
      Q191352: { labels: { en: { language: "en", value: "Portishead" } }, aliases: {} },
      Q1373294: { labels: { en: { language: "en", value: "Adrian Utley" } }, aliases: {} },
      Q233264: { labels: { en: { language: "en", value: "Beth Gibbons" } }, aliases: {} },
    },
  },
  claims: {
    entities: {
      Q191352: {
        claims: {
          P373: [{ rank: "normal", mainsnak: { datavalue: { value: "Portishead (band)" } } }],
          P18: [{ rank: "normal", mainsnak: { datavalue: { value: "Portishead Wolverhampton 20080413-1.jpg" } } }],
        },
      },
    },
  },
  lead: { query: { pages: [filePage("File:Portishead Wolverhampton 20080413-1.jpg", { description: "Portishead live in Wolverhampton", date: "2008-04-13", width: 600 })] } },
  category: {
    continue: { gcmcontinue: "file|x" },
    query: {
      pages: [
        filePage("File:Beth Gibbons 2008.jpg"),
        filePage("File:Portishead Wolverhampton 20080413-1.jpg"), // also the lead — must not repeat
        filePage("File:Portishead logo.svg", { mime: "image/svg+xml" }),
        filePage("File:Tiny.jpg", { width: 300 }),
        subcat("Category:Portishead (band) in concert"),
        subcat("Category:Beth Gibbons"),
      ],
    },
  },
  inConcert: { query: { pages: [filePage("File:Portishead - Primavera Sound 2008.jpg", { description: "Concierto de <a href=\"x\">Portishead</a>", artist: "Alterna2", license: "CC BY 2.0" })] } },
};

module.exports = { filePage, subcat, PORTISHEAD };
