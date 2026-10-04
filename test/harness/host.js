// A fake plugin API plus a scripted Wikimedia: enough of ViboplrPluginAPI for
// activate() and the two handlers. Requests are recorded so tests can assert
// on what was asked.

function response(status, body) {
  return {
    status,
    headers: { "content-type": "application/json" },
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

// opts.route(url: URL) → { status?, body } | body | undefined (404)
function makeHost(opts = {}) {
  const requests = [];
  const logs = [];
  const infoHandlers = {};
  const tools = {};

  const api = {
    appVersion: "1.0.89",
    log: (level, message) => logs.push({ level, message }),
    network: {
      async fetch(url, init) {
        const u = new URL(url);
        requests.push({ url: u, init });
        const out = opts.route ? opts.route(u) : undefined;
        if (out === undefined) return response(404, { error: { info: "no route" } });
        if (out && typeof out.status === "number" && "body" in out) return response(out.status, out.body);
        return response(200, out);
      },
    },
    informationTypes: {
      onFetch(id, handler) { infoHandlers[id] = handler; },
    },
    assistant: {
      onTool(name, handler) { tools[name] = handler; },
    },
  };

  return { api, requests, logs, infoHandlers, tools };
}

module.exports = { makeHost, response };
