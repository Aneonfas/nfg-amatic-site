import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerSource = await readFile(path.join(rootDir, "worker.js"), "utf8");
const context = vm.createContext({
  URL,
  Response,
  addEventListener() {},
  fetch: async () => new Response("<!doctype html><title>NFG</title>"),
});
vm.runInContext(workerSource, context);

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
