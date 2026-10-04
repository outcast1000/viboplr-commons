#!/usr/bin/env node
// Run the plugin against the REAL Wikidata + Commons APIs, the way the worker
// would (same sandbox, api.network.fetch backed by Node's fetch, limited to the
// manifest's hosts). Not part of `npm test` — it needs the network.
//
//   node scripts/live.cjs gallery "Portishead"
//   node scripts/live.cjs search '{"artist":"Björk","limit":5,"thumbnails":true}'
const { loadPlugin } = require("../test/harness/sandbox");
const manifest = require("../manifest.json");

const allowed = manifest.permissions.filter((p) => p.startsWith("network:")).map((p) => p.slice(8));

const api = {
  appVersion: "live",
  log: (level, message) => console.error(`[${level}] ${message}`),
  network: {
    async fetch(url, init = {}) {
      const host = new URL(url).hostname;
      if (!allowed.includes(host)) throw new Error(`PermissionError: network:${host} not in manifest`);
      const ctl = new AbortController();
      const t = init.timeoutMs ? setTimeout(() => ctl.abort(), init.timeoutMs) : null;
      try {
        const r = await fetch(url, { method: init.method, headers: init.headers, body: init.body, signal: ctl.signal, redirect: "manual" });
        const text = await r.text();
        return { status: r.status, headers: Object.fromEntries(r.headers), url: r.url, text: async () => text, json: async () => JSON.parse(text) };
      } finally {
        if (t) clearTimeout(t);
      }
    },
  },
  informationTypes: { handlers: {}, onFetch(id, h) { this.handlers[id] = h; } },
  assistant: { tools: {}, onTool(name, h) { this.tools[name] = h; } },
};

(async () => {
  const [mode, arg] = process.argv.slice(2);
  const plugin = loadPlugin();
  plugin.activate(api);
  const started = Date.now();
  let out;
  if (mode === "gallery") {
    out = await api.informationTypes.handlers.commons_photos({ kind: "artist", name: arg, id: 0 });
  } else if (mode === "search") {
    out = await api.assistant.tools.search_images(JSON.parse(arg));
  } else {
    console.error("usage: live.cjs gallery <artist> | search <json args>");
    process.exit(2);
  }
  console.log(JSON.stringify(out, null, 2));
  console.error(`(${Date.now() - started} ms)`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
