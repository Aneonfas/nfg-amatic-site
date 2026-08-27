import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerSource = await readFile(path.join(rootDir, "worker.js"), "utf8");
const fetchedUrls = [];
const context = vm.createContext({
  URL,
  Response,
  fetch: async url => {
    fetchedUrls.push(url);
    return new Response("<!doctype html><title>NFG</title>");
  },
});
// Only rewrite the module export for this isolated VM; execute the real handler.
vm.runInContext(workerSource.replace(/^export default /m, "globalThis.worker = "), context);

function rootRequest({ query = "", cookie, language, country } = {}) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (language) headers.set("accept-language", language);
  const request = new Request(`https://nfg-system.online/${query}`, { headers });
  if (country) Object.defineProperty(request, "cf", { value: { country } });
  return request;
}

test("explicit choice wins and is remembered", async () => {
  const response = await context.handleRequest(
    rootRequest({ query: "?lang=tr", cookie: "nfg_locale=ru", language: "fr" }),
  );
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://nfg-system.online/tr/");
  assert.match(response.headers.get("set-cookie"), /^nfg_locale=tr;/);
});

test("saved choice wins over browser language", async () => {
  const response = await context.handleRequest(
    rootRequest({ cookie: "nfg_locale=en", language: "ru-RU" }),
  );
  assert.equal(response.headers.get("location"), "https://nfg-system.online/en/");
});

test("browser languages honor quality values and q=0", async () => {
  const weighted = await context.handleRequest(
    rootRequest({ language: "de;q=0.4, fr-FR;q=0.9" }),
  );
  assert.equal(weighted.headers.get("location"), "https://nfg-system.online/fr/");

  const excluded = await context.handleRequest(
    rootRequest({ language: "ru;q=0, es;q=0.5" }),
  );
  assert.equal(excluded.headers.get("location"), "https://nfg-system.online/es/");
});

test("supported regional browser languages resolve to canonical locale slugs", async () => {
  const portuguese = await context.handleRequest(rootRequest({ language: "pt-PT" }));
  assert.equal(
    portuguese.headers.get("location"),
    "https://nfg-system.online/pt-br/",
  );
});

test("country is used only when browser language is unsupported", async () => {
  const response = await context.handleRequest(
    rootRequest({ language: "uk-UA", country: "JP" }),
  );
  assert.equal(response.headers.get("location"), "https://nfg-system.online/ja/");

  const browserWins = await context.handleRequest(
    rootRequest({ language: "en-US", country: "RU" }),
  );
  assert.equal(browserWins.headers.get("location"), "https://nfg-system.online/en/");
});

test("country and final English fallbacks work", async () => {
  const brazil = await context.handleRequest(rootRequest({ country: "BR" }));
  assert.equal(brazil.headers.get("location"), "https://nfg-system.online/pt-br/");

  const fallback = await context.handleRequest(rootRequest());
  assert.equal(fallback.headers.get("location"), "https://nfg-system.online/en/");
  assert.equal(fallback.headers.get("cache-control"), "private, no-store");
  assert.equal(fallback.headers.get("vary"), "Cookie, Accept-Language");
});

test("English canonical page is served without a redirect", async () => {
  const response = await context.handleRequest(
    new Request("https://nfg-system.online/en/"),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("content-language"), "en");
});

test("Italian query and saved choice preserve locale precedence", async () => {
  const explicit = await context.worker.fetch(rootRequest({
    query: "?lang=it", cookie: "nfg_locale=ru", language: "fr-FR", country: "DE",
  }), {});
  assert.equal(explicit.status, 302);
  assert.equal(explicit.headers.get("location"), "https://nfg-system.online/it/");
  assert.match(explicit.headers.get("set-cookie"), /^nfg_locale=it;/);

  const remembered = await context.worker.fetch(rootRequest({
    cookie: "nfg_locale=it", language: "ru-RU", country: "DE",
  }), {});
  assert.equal(remembered.headers.get("location"), "https://nfg-system.online/it/");
  assert.equal(remembered.headers.get("set-cookie"), null);

  const override = await context.worker.fetch(rootRequest({
    query: "?lang=en", cookie: "nfg_locale=it", language: "it-IT", country: "IT",
  }), {});
  assert.equal(override.headers.get("location"), "https://nfg-system.online/en/");
});

test("Italian browser tags honor quality values and exclusions", async () => {
  for (const language of ["it", "it-IT", "it-CH", "fr;q=0.2, it-IT;q=0.8"]) {
    const response = await context.worker.fetch(rootRequest({ language, country: "DE" }), {});
    assert.equal(response.headers.get("location"), "https://nfg-system.online/it/", language);
  }
  const weighted = await context.worker.fetch(rootRequest({ language: "it;q=0.1, de;q=0.9" }), {});
  assert.equal(weighted.headers.get("location"), "https://nfg-system.online/de/");
  const excluded = await context.worker.fetch(rootRequest({ language: "it;q=0, en;q=1" }), {});
  assert.equal(excluded.headers.get("location"), "https://nfg-system.online/en/");
});

test("Italy is a fallback only after remembered and browser choices", async () => {
  for (const language of [undefined, "pl-PL"]) {
    const response = await context.worker.fetch(rootRequest({ language, country: "IT" }), {});
    assert.equal(response.headers.get("location"), "https://nfg-system.online/it/");
  }
  const browser = await context.worker.fetch(rootRequest({ language: "de-DE", country: "IT" }), {});
  assert.equal(browser.headers.get("location"), "https://nfg-system.online/de/");
  const saved = await context.worker.fetch(rootRequest({ cookie: "nfg_locale=en", country: "IT" }), {});
  assert.equal(saved.headers.get("location"), "https://nfg-system.online/en/");
});

test("Italian canonical page and aliases serve Italian HTML for GET and HEAD", async () => {
  for (const pathname of ["/it/", "/it", "/it/index.html"]) {
    for (const method of ["GET", "HEAD"]) {
      const response = await context.worker.fetch(new Request(`https://nfg-system.online${pathname}`, {
        method, headers: { cookie: "nfg_locale=ru", "accept-language": "de-DE" },
      }), {});
      assert.equal(response.status, 200, `${method} ${pathname}`);
      assert.equal(response.headers.get("location"), null);
      assert.equal(response.headers.get("content-language"), "it");
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(new URL(fetchedUrls.at(-1)).pathname, "/Aneonfas/nfg-amatic-site/main/it/index.html");
      assert.equal((await response.text()).length > 0, method === "GET");
    }
  }
});
