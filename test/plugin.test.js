const test = require("node:test");
const assert = require("node:assert/strict");
const { loadPlugin } = require("./harness/sandbox");
const { makeHost } = require("./harness/host");
const { filePage, PORTISHEAD } = require("./fixtures");

// Route a request to the Portishead fixtures by what it asks for.
function portisheadRoute(u) {
  const p = Object.fromEntries(u.searchParams);
  if (u.hostname === "www.wikidata.org") {
    if (p.list === "search") return PORTISHEAD.search;
    if (p.action === "wbgetentities" && p.props === "labels|aliases") return PORTISHEAD.labels;
    if (p.action === "wbgetentities" && p.props === "claims") return PORTISHEAD.claims;
  }
  if (u.hostname === "commons.wikimedia.org") {
    if (p.titles === "File:Portishead Wolverhampton 20080413-1.jpg" && p.iiurlwidth === "1280") return PORTISHEAD.lead;
    if (p.gcmtitle === "Category:Portishead (band)") return PORTISHEAD.category;
    if (p.gcmtitle === "Category:Portishead (band) in concert") return PORTISHEAD.inConcert;
    if (p.iiurlwidth === "330") {
      return {
        query: {
          pages: p.titles.split("|").map((t) => ({ title: t, imageinfo: [{ url: "x", thumburl: `https://thumb.wikimedia.org/330px-${t}?utm_source=c` }] })),
        },
      };
    }
  }
  return undefined;
}

function setup(route = portisheadRoute) {
  const plugin = loadPlugin();
  const host = makeHost({ route });
  plugin.activate(host.api);
  return { plugin, host };
}

test("registers the Photos info type and the search tool", () => {
  const { host } = setup();
  assert.equal(typeof host.infoHandlers.commons_photos, "function");
  assert.equal(typeof host.tools.search_images, "function");
});

test("every request identifies itself and has a timeout", async () => {
  const { host } = setup();
  await host.infoHandlers.commons_photos({ kind: "artist", name: "Portishead", id: 0 });
  assert.ok(host.requests.length > 0);
  for (const r of host.requests) {
    assert.match(r.init.headers["User-Agent"], /^Viboplr-Commons\//);
    assert.equal(typeof r.init.timeoutMs, "number");
    assert.ok(["www.wikidata.org", "commons.wikimedia.org"].includes(r.url.hostname), r.url.hostname);
  }
});

test("artist gallery: lead image first, no repeats, only real photos, related subcategory, credited", async () => {
  const { host } = setup();
  const out = await host.infoHandlers.commons_photos({ kind: "artist", name: "Portishead", id: 0 });
  assert.equal(out.status, "ok");
  const titles = out.value.images.map((i) => i.pageUrl.split("/wiki/")[1]);
  assert.deepEqual(titles, [
    "Portishead_Wolverhampton_20080413-1.jpg",
    "Beth_Gibbons_2008.jpg",
    "Portishead_-_Primavera_Sound_2008.jpg",
  ]);
  const [lead, second, third] = out.value.images;
  assert.equal(lead.caption, "Portishead live in Wolverhampton (2008)");
  assert.equal(second.caption, "Beth Gibbons (Portishead) at Coliseu dos Recreios, Lisbon (2008)");
  assert.equal(second.source, "José Goulão · CC BY-SA 2.0");
  assert.equal(second.author, "José Goulão");
  assert.equal(second.license, "CC BY-SA 2.0");
  assert.match(second.url, /^https:\/\/thumb\.wikimedia\.org\/.*1280px-Beth_Gibbons_2008\.jpg$/, "utm params stripped");
  assert.equal(third.caption, "Concierto de Portishead (2008)");
  // "Beth Gibbons" is a member's category, not about the band — never opened.
  assert.ok(!host.requests.some((r) => r.url.searchParams.get("gcmtitle") === "Category:Beth Gibbons"));
});

test("artist gallery: exact name only — a near miss is not_found, not a wrong artist", async () => {
  const { host } = setup();
  const out = await host.infoHandlers.commons_photos({ kind: "artist", name: "Portis", id: 0 });
  assert.deepEqual(out, { status: "not_found" });
});

test("artist gallery: matches across accents and case, and on an alias", async () => {
  const route = (u) => {
    const p = Object.fromEntries(u.searchParams);
    if (p.list === "search") return { query: { search: [{ title: "Q1" }] } };
    if (p.props === "labels|aliases") {
      return { entities: { Q1: { labels: { mul: { value: "Björk" } }, aliases: { en: [{ value: "Bjork Gudmundsdottir" }] } } } };
    }
    if (p.props === "claims") return { entities: { Q1: { claims: { P18: [{ mainsnak: { datavalue: { value: "Bjork.jpg" } } }] } } } };
    if (p.titles === "File:Bjork.jpg") return { query: { pages: [filePage("File:Bjork.jpg")] } };
    return undefined;
  };
  for (const name of ["BJORK", "björk", "Bjork Gudmundsdottir"]) {
    const { host } = setup(route);
    const out = await host.infoHandlers.commons_photos({ kind: "artist", name, id: 0 });
    assert.equal(out.status, "ok", name);
    assert.equal(out.value.images.length, 1, name);
  }
});

test("artist gallery: a label beats an alias, whatever the search order", async () => {
  // George W. Bush has a MusicBrainz id and "Bush" as an alias; the band is labelled "Bush".
  const route = (u) => {
    const p = Object.fromEntries(u.searchParams);
    if (p.list === "search") return { query: { search: [{ title: "Q207" }, { title: "Q1" }] } };
    if (p.props === "labels|aliases") {
      assert.equal(p.languages, undefined, "labels in every language");
      return {
        entities: {
          Q207: { labels: { en: { value: "George W. Bush" } }, aliases: { en: [{ value: "Bush" }] } },
          Q1: { labels: { el: { value: "Μπους" }, en: { value: "Bush" } }, aliases: {} },
        },
      };
    }
    if (p.props === "claims") {
      assert.equal(p.ids, "Q1");
      return { entities: { Q1: { claims: { P18: [{ mainsnak: { datavalue: { value: "Bush band.jpg" } } }] } } } };
    }
    if (p.titles === "File:Bush band.jpg") return { query: { pages: [filePage("File:Bush band.jpg")] } };
    return undefined;
  };
  const { host } = setup(route);
  const out = await host.tools.search_images({ artist: "Bush" });
  assert.equal(out.source.wikidata, "https://www.wikidata.org/wiki/Q1");
  assert.equal(out.source.artist, "Bush", "English label reported");
});

test("only photos: no PNG/GIF, no logos, covers or charts", async () => {
  const route = (u) => {
    if (u.searchParams.get("gcmtitle") !== "Category:Band") return undefined;
    return {
      query: {
        pages: [
          filePage("File:Band live 2004.jpg"),
          filePage("File:Band album cover.jpg"),
          filePage("File:Band (Logo).jpg"),
          filePage("File:Sales chart.jpg"),
          filePage("File:Band backstage.png", { mime: "image/png" }),
          filePage("File:Coverdale on stage.jpg"),
        ],
      },
    };
  };
  const { host } = setup(route);
  const out = await host.tools.search_images({ category: "Band" });
  assert.deepEqual(out.images.map((i) => i.title), ["File:Band live 2004.jpg", "File:Coverdale on stage.jpg"]);
});

test("artist gallery: a Wikimedia failure is an error status, not a throw", async () => {
  const { host } = setup(() => ({ status: 503, body: {} }));
  const out = await host.infoHandlers.commons_photos({ kind: "artist", name: "Portishead", id: 0 });
  assert.equal(out.status, "error");
  assert.match(out.message, /503/);
  assert.equal(host.logs[0].level, "error");
});

test("search_images: needs exactly one of artist / category / query", async () => {
  const { host } = setup();
  await assert.rejects(host.tools.search_images({}), /exactly one/);
  await assert.rejects(host.tools.search_images({ artist: "a", query: "b" }), /exactly one/);
  await assert.rejects(host.tools.search_images({ artist: "a", limit: "lots" }), /number/);
});

test("search_images by artist: full metadata, subcategories listed, thumbnails on request", async () => {
  const { host } = setup();
  const out = await host.tools.search_images({ artist: "Portishead", limit: 2, thumbnails: true });
  assert.equal(out.source.kind, "artist");
  assert.equal(out.source.category, "Category:Portishead (band)");
  assert.equal(out.source.wikidata, "https://www.wikidata.org/wiki/Q191352");
  assert.deepEqual(out.subcategories, ["Portishead (band) in concert", "Beth Gibbons"]);
  assert.equal(out.more, true);
  assert.equal(out.images.length, 2);
  const img = out.images[1];
  assert.equal(img.title, "File:Beth Gibbons 2008.jpg");
  assert.equal(img.width, 2000);
  assert.equal(img.date, "2008-03-27");
  assert.equal(img.license, "CC BY-SA 2.0");
  assert.equal(img.licenseUrl, "https://creativecommons.org/licenses/by-sa/2.0");
  assert.equal(img.attributionRequired, true);
  assert.equal(img.credit, "Photo: José Goulão, CC BY-SA 2.0, via Wikimedia Commons");
  assert.equal(img.thumbUrl, "https://thumb.wikimedia.org/330px-File:Beth Gibbons 2008.jpg");
});

test("search_images by artist: unknown artist answers with a note, not an error", async () => {
  const { host } = setup((u) => (u.searchParams.get("list") === "search" ? { query: { search: [] } } : undefined));
  const out = await host.tools.search_images({ artist: "Nobody At All" });
  assert.deepEqual(out.images, []);
  assert.match(out.note, /No music artist/);
});

test("search_images by category: prefix optional, minWidth respected", async () => {
  const { host } = setup();
  const out = await host.tools.search_images({ category: "Portishead_(band)", minWidth: 0 });
  assert.equal(out.source.category, "Category:Portishead (band)");
  // svg is never a photo; the 300px file passes once minWidth is 0.
  assert.deepEqual(out.images.map((i) => i.title), [
    "File:Beth Gibbons 2008.jpg",
    "File:Portishead Wolverhampton 20080413-1.jpg",
    "File:Tiny.jpg",
  ]);
});

test("search_images by query: keeps search rank and warns about free text", async () => {
  const route = (u) => {
    if (u.searchParams.get("generator") !== "search") return undefined;
    assert.equal(u.searchParams.get("gsrsearch"), "Portishead filetype:bitmap");
    assert.equal(u.searchParams.get("gsrnamespace"), "6");
    return { query: { pages: [filePage("File:Pier.jpg", { index: 2 }), filePage("File:Band.jpg", { index: 1 })] } };
  };
  const { host } = setup(route);
  const out = await host.tools.search_images({ query: "Portishead" });
  assert.deepEqual(out.images.map((i) => i.title), ["File:Band.jpg", "File:Pier.jpg"]);
  assert.match(out.note, /Free-text/);
});

test("helpers", () => {
  const plugin = loadPlugin();
  assert.equal(plugin._htmlToText('<a href="x">A &amp; B</a>&nbsp;<br>c &#39;d&#39;'), "A & B c 'd'");
  assert.equal(plugin._categoryTitle("category: Foo_Bar"), "Category:Foo Bar");
  assert.equal(plugin._categoryStem("Category:Portishead (band)"), "portishead");
  assert.equal(plugin._cleanUrl("https://x/a.jpg?utm_source=c&utm_campaign=d"), "https://x/a.jpg");
  assert.equal(plugin._capText("one two three four", 9), "one two…");
  assert.equal(plugin._withYear("Live in Urbino on 6 August 2005.", "2005-08-06"), "Live in Urbino on 6 August 2005.");
  assert.equal(plugin._withYear("Live in Urbino", "2005-08-06"), "Live in Urbino (2005)");
  assert.equal(plugin._withYear("Live in Urbino", null), "Live in Urbino");
  assert.equal(plugin._withYear("Live", "circa"), "Live");
});
