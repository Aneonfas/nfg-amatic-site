import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(rootDir, "worker.js"), "utf8");
const migration = await readFile(path.join(rootDir, "migrations/0001_language_poll.sql"), "utf8");
const origin = "https://nfg-system.online";
const endpoint = `${origin}/api/polls/next-language`;
const cookieName = "__Host-nfg_language_poll";
const pollId = "anvil-next-language-v1";
const optionIds = ["de", "fr", "pt-br", "it", "tr", "zh-cn", "ja", "ko", "other"];

// A small D1 adapter executes the production migration and SQL on real SQLite.
// Deduplication is never faked in JS: independent Worker VM contexts share the
// same unique SQL key, and batch uses an actual SQLite transaction.
class SqliteD1 {
  constructor(t) {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec(migration);
    this.calls = [];
    t.after(() => this.sqlite.close());
  }

  prepare(sql) {
    const db = this;
    function prepared(values = []) {
      return {
        sql,
        values,
        bind(...bound) { return prepared(bound); },
        async all() {
          await setImmediate();
          return db.execute({ sql, values });
        },
      };
    }
    return prepared();
  }

  execute({ sql, values }) {
    this.calls.push({ sql, values });
    const results = this.sqlite.prepare(sql).all(...values);
    return { success: true, results, meta: {} };
  }

  async batch(statements) {
    await setImmediate();
    this.sqlite.exec("BEGIN");
    let results;
    try {
      results = statements.map((statement, index) => {
        if (index === 1 && this.failWithinBatch) throw new Error("private DB details");
        return this.execute(statement);
      });
      this.sqlite.exec("COMMIT");
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
    if (this.failAfterCommitOnce) {
      this.failAfterCommitOnce = false;
      throw new Error("simulated lost response after commit");
    }
    return results;
  }

  count() {
    return this.sqlite.prepare("SELECT COUNT(*) AS n FROM language_poll_votes").get().n;
  }
}

function worker(db) {
  const fetched = [];
  const errors = [];
  const globals = {
    URL, Response, TextEncoder, TextDecoder, crypto: webcrypto,
    console: { error: value => errors.push(value) },
    async fetch(url) {
      fetched.push(url);
      return new Response("<!doctype html><title>NFG</title>");
    },
  };
  const context = vm.createContext(globals);
  // Execute the production module entrypoint with only its export syntax
  // rewritten for node:vm. Runtime D1 integration is separately smoke-tested.
  vm.runInContext(source.replace(/^export default /m, "globalThis.worker = "), context);
  return {
    fetched, errors,
    handle(request) {
      return context.worker.fetch(request, db === undefined ? {} : { LANGUAGE_POLL_DB: db });
    },
  };
}

function request({ method = "GET", cookie, option = "de", headers = {}, body, url = endpoint } = {}) {
  const resultHeaders = new Headers(headers);
  if (cookie) resultHeaders.set("cookie", cookie);
  if (method === "POST") {
    if (!resultHeaders.has("origin")) resultHeaders.set("origin", origin);
    if (!resultHeaders.has("content-type")) resultHeaders.set("content-type", "application/json");
    if (body === undefined) body = JSON.stringify({ option });
  }
  return new Request(url, { method, headers: resultHeaders, body, duplex: "half" });
}

async function identity(instance, cookie) {
  const response = await instance.handle(request({ cookie }));
  assert.equal(response.status, 200);
  return {
    response,
    cookie: response.headers.get("set-cookie")?.split(";")[0] || cookie,
    snapshot: await response.json(),
  };
}

function assertPrivate(response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("cdn-cache-control"), "no-store");
  assert.equal(response.headers.get("cloudflare-cdn-cache-control"), "no-store");
  assert.equal(response.headers.get("vary"), "Cookie, Origin");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}

function historicalVote(db, cookie, option) {
  const hash = createHash("sha256").update(`${pollId}:${cookie.split("=")[1]}`).digest("hex");
  // Simulate an old Worker accepting a vote with the unchanged schema and
  // conflict policy. The updated Worker must preserve historical rows.
  return db.prepare(`
    INSERT INTO language_poll_votes (poll_id, voter_hash, option_id)
    VALUES (?1, ?2, ?3)
    ON CONFLICT (poll_id, voter_hash) DO NOTHING
  `).bind(pollId, hash, option);
}

function storedVotes(db) {
  return db.sqlite.prepare("SELECT * FROM language_poll_votes ORDER BY voter_hash").all();
}

test("GET returns the complete ordered poll, issues a secure anonymous cookie, and writes nothing", async t => {
  const db = new SqliteD1(t);
  const instance = worker(db);
  const { response, cookie, snapshot } = await identity(instance);
  assert.deepEqual(snapshot, {
    pollId, options: optionIds.map(id => ({ id, votes: 0 })), totalVotes: 0, selectedOption: null,
  });
  assert.match(cookie, /^__Host-nfg_language_poll=[a-f0-9]{64}$/);
  const setCookie = response.headers.get("set-cookie");
  for (const flag of ["Path=/", "Max-Age=31536000", "HttpOnly", "Secure", "SameSite=Lax"]) {
    assert.ok(setCookie.split("; ").includes(flag));
  }
  assert.doesNotMatch(setCookie, /Domain=/i);
  assertPrivate(response);

  const remembered = await identity(instance, cookie);
  assert.equal(remembered.response.headers.get("set-cookie"), null);
  assert.deepEqual(remembered.snapshot, snapshot);
  const newIdentities = await Promise.all(Array.from({ length: 16 }, () => identity(instance)));
  assert.equal(new Set([cookie, ...newIdentities.map(entry => entry.cookie)]).size, 17);
  assert.equal(db.count(), 0);
  assert.ok(db.calls.every(call => /^\s*SELECT/.test(call.sql)));
});

test("POST stores only the poll-specific hash and choice; other browsers see totals without the selection", async t => {
  const db = new SqliteD1(t);
  const instance = worker(db);
  const { cookie } = await identity(instance);
  const response = await instance.handle(request({ method: "POST", cookie, option: "it", headers: {
    "cf-connecting-ip": "192.0.2.1", "user-agent": "private test agent",
  } }));
  assert.equal(response.status, 200);
  assertPrivate(response);
  const snapshot = await response.json();
  assert.equal(snapshot.totalVotes, 1);
  assert.equal(snapshot.selectedOption, "it");
  assert.equal(snapshot.options.find(entry => entry.id === "it").votes, 1);
  assert.deepEqual((await identity(instance, cookie)).snapshot, snapshot);
  const stranger = await identity(instance);
  assert.equal(stranger.snapshot.totalVotes, 1);
  assert.equal(stranger.snapshot.selectedOption, null);

  const row = db.sqlite.prepare("SELECT * FROM language_poll_votes").get();
  assert.deepEqual(Object.keys(row), ["poll_id", "voter_hash", "option_id"]);
  assert.equal(row.voter_hash, createHash("sha256").update(`${pollId}:${cookie.split("=")[1]}`).digest("hex"));
  assert.notEqual(row.voter_hash, cookie.split("=")[1]);
  assert.equal(row.option_id, "it");
  assert.doesNotMatch(JSON.stringify(row), /192\.0\.2\.1|private test agent/);
  assert.deepEqual(instance.errors, []);
});

test("all nine active options can receive votes and totals equal their sum", async t => {
  const db = new SqliteD1(t);
  const instance = worker(db);
  for (const option of optionIds) {
    const { cookie } = await identity(instance);
    const response = await instance.handle(request({ method: "POST", cookie, option }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).selectedOption, option);
  }
  const { snapshot } = await identity(instance);
  assert.deepEqual(snapshot.options, optionIds.map(id => ({ id, votes: 1 })));
  assert.equal(snapshot.totalVotes, 9);
  assert.equal(db.count(), 9);
});

test("retired votes remain stored but are excluded from results without hiding active votes", async t => {
  const db = new SqliteD1(t);
  const instance = worker(db);
  const voters = [];
  for (const option of ["pl", "uk"]) {
    const { cookie } = await identity(instance);
    await db.batch([historicalVote(db, cookie, option)]);
    voters.push({ cookie, option });
  }
  const retiredOnly = await identity(instance);
  assert.deepEqual(retiredOnly.snapshot, {
    pollId, options: optionIds.map(id => ({ id, votes: 0 })), totalVotes: 0, selectedOption: null,
  });
  assert.equal(db.count(), 2);

  for (const option of ["de", "it", "it"]) {
    const { cookie } = await identity(instance);
    await db.batch([historicalVote(db, cookie, option)]);
    voters.push({ cookie, option });
  }
  const before = storedVotes(db);
  const expectedOptions = optionIds.map(id => ({ id, votes: id === "de" ? 1 : id === "it" ? 2 : 0 }));
  for (const { cookie, option } of voters) {
    const { response, snapshot } = await identity(instance, cookie);
    assertPrivate(response);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.deepEqual(snapshot.options, expectedOptions);
    assert.equal(snapshot.totalVotes, 3);
    assert.equal(snapshot.selectedOption, optionIds.includes(option) ? option : null);
  }
  assert.deepEqual(storedVotes(db), before);
  assert.equal(db.count(), 5);
  assert.deepEqual(instance.errors, []);
});

test("retired voters receive already_voted on concurrent retries without changing historical rows", async t => {
  const db = new SqliteD1(t);
  const instances = Array.from({ length: 4 }, () => worker(db));
  const retiredCookies = [];
  for (const option of ["pl", "uk"]) {
    const { cookie } = await identity(instances[0]);
    await db.batch([historicalVote(db, cookie, option)]);
    retiredCookies.push(cookie);
  }
  const { cookie: activeCookie } = await identity(instances[0]);
  await db.batch([historicalVote(db, activeCookie, "it")]);
  const before = storedVotes(db);
  const responses = await Promise.all(Array.from({ length: 36 }, (_, index) =>
    instances[index % 4].handle(request({
      method: "POST", cookie: retiredCookies[index % 2], option: optionIds[index % optionIds.length],
    })),
  ));
  for (const response of responses) {
    assert.equal(response.status, 409);
    assertPrivate(response);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.deepEqual(await response.json(), {
      error: "already_voted", pollId,
      options: optionIds.map(id => ({ id, votes: id === "it" ? 1 : 0 })),
      totalVotes: 1, selectedOption: null,
    });
  }
  for (const cookie of [...retiredCookies, activeCookie, undefined]) {
    for (const option of ["pl", "uk"]) {
      const response = await instances[0].handle(request({ method: "POST", cookie, option }));
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "invalid_option" });
    }
  }
  assert.deepEqual(storedVotes(db), before);
  const activeRetry = await instances[0].handle(request({ method: "POST", cookie: activeCookie, option: "de" }));
  assert.equal(activeRetry.status, 200);
  assert.equal((await activeRetry.json()).selectedOption, "it");
  assert.deepEqual(storedVotes(db), before);

  const { cookie: newCookie } = await identity(instances[0]);
  const newVote = await instances[0].handle(request({ method: "POST", cookie: newCookie, option: "fr" }));
  assert.equal(newVote.status, 200);
  assert.equal((await newVote.json()).totalVotes, 2);
  assert.equal(db.count(), 4);
  for (const original of before) {
    assert.deepEqual(storedVotes(db).find(row => row.voter_hash === original.voter_hash), original);
  }
});

test("a legacy retired vote racing an active vote never overwrites the first accepted row", async t => {
  for (const retired of ["pl", "uk"]) {
    const db = new SqliteD1(t);
    const instance = worker(db);
    const { cookie } = await identity(instance);
    const [response] = await Promise.all([
      instance.handle(request({ method: "POST", cookie, option: "it" })),
      db.batch([historicalVote(db, cookie, retired)]),
    ]);
    assert.equal(db.count(), 1);
    const recorded = storedVotes(db)[0].option_id;
    const result = await response.json();
    assert.ok(["it", retired].includes(recorded));
    assert.equal(response.status, recorded === "it" ? 200 : 409);
    assert.equal(result.selectedOption, recorded === "it" ? "it" : null);
    assert.equal(result.totalVotes, recorded === "it" ? 1 : 0);
    assert.deepEqual((await identity(instance, cookie)).snapshot.options, result.options);
    assert.equal(storedVotes(db)[0].option_id, recorded);
  }

  const db = new SqliteD1(t);
  const instance = worker(db);
  const { cookie } = await identity(instance);
  assert.equal((await instance.handle(request({ method: "POST", cookie, option: "it" }))).status, 200);
  const before = storedVotes(db);
  await db.batch([historicalVote(db, cookie, "uk")]);
  assert.deepEqual(storedVotes(db), before);
  const { snapshot } = await identity(instance, cookie);
  assert.equal(snapshot.selectedOption, "it");
  assert.equal(snapshot.totalVotes, 1);
});

test("same and changed-choice retries preserve the first recorded vote", async t => {
  const db = new SqliteD1(t);
  const instance = worker(db);
  const { cookie } = await identity(instance);
  for (const option of ["de", "de", "fr", "other"]) {
    const response = await instance.handle(request({ method: "POST", cookie, option }));
    assert.equal(response.status, 200);
    const snapshot = await response.json();
    assert.equal(snapshot.totalVotes, 1);
    assert.equal(snapshot.selectedOption, "de");
  }
  assert.equal(db.count(), 1);
});

test("64 concurrent retries across Worker contexts count one SQL row", async t => {
  const db = new SqliteD1(t);
  const instances = Array.from({ length: 4 }, () => worker(db));
  const { cookie } = await identity(instances[0]);
  const responses = await Promise.all(Array.from({ length: 64 }, (_, index) =>
    instances[index % 4].handle(request({ method: "POST", cookie, option: optionIds[index % optionIds.length] })),
  ));
  const snapshots = await Promise.all(responses.map(async response => {
    assert.equal(response.status, 200);
    return response.json();
  }));
  assert.ok(snapshots.every(snapshot => snapshot.totalVotes === 1));
  assert.equal(new Set(snapshots.map(snapshot => snapshot.selectedOption)).size, 1);
  assert.equal(db.count(), 1);
});

test("distinct browsers voting concurrently keep every vote", async t => {
  const db = new SqliteD1(t);
  const instances = Array.from({ length: 4 }, () => worker(db));
  const identities = await Promise.all(Array.from({ length: 27 }, (_, index) => identity(instances[index % 4])));
  const responses = await Promise.all(identities.map(({ cookie }, index) =>
    instances[index % 4].handle(request({ method: "POST", cookie, option: optionIds[index % optionIds.length] })),
  ));
  assert.ok(responses.every(response => response.status === 200));
  const { snapshot } = await identity(instances[0]);
  assert.equal(snapshot.totalVotes, 27);
  assert.deepEqual(snapshot.options, optionIds.map(id => ({ id, votes: 3 })));
  assert.equal(db.count(), 27);
});

test("absent, malformed and ambiguous cookies cannot create a vote; GET then retry recovers", async t => {
  const db = new SqliteD1(t);
  const instance = worker(db);
  const { cookie: validCookie } = await identity(instance);
  const cookies = [undefined, `${cookieName}=bad`, `${cookieName}=${"A".repeat(64)}`, `${validCookie}; ${validCookie}`];
  const responses = await Promise.all(cookies.flatMap(cookie => Array.from({ length: 8 }, () =>
    instance.handle(request({ method: "POST", cookie })),
  )));
  for (const response of responses) {
    assert.equal(response.status, 428);
    assert.deepEqual(await response.json(), { error: "cookie_required" });
    assert.equal(response.headers.get("set-cookie"), null);
    assertPrivate(response);
  }
  assert.equal(db.count(), 0);
  const { cookie } = await identity(instance, `${cookieName}=bad`);
  assert.match(cookie, /^__Host-nfg_language_poll=[a-f0-9]{64}$/);
  assert.equal((await instance.handle(request({ method: "POST", cookie }))).status, 200);
  assert.equal(db.count(), 1);
});

test("strict JSON schema rejects unsupported choices, free text, extra fields and malformed bodies", async t => {
  const db = new SqliteD1(t);
  const instance = worker(db);
  const { cookie } = await identity(instance);
  const invalidOptions = ["en", "ru", "es", "pl", "uk", "DE", "de ", "__proto__", "de'); DROP TABLE language_poll_votes;--", ""];
  const bodies = [
    ...invalidOptions.map(option => JSON.stringify({ option })),
    "null", "[]", '"de"', "42", "{}", '{"option":null}', '{"option":true}',
    '{"option":["de"]}', '{"option":"de","text":"private text"}',
  ];
  for (const body of bodies) {
    const response = await instance.handle(request({ method: "POST", cookie, body }));
    assert.equal(response.status, 400, body);
    assert.deepEqual(await response.json(), { error: "invalid_option" });
    assertPrivate(response);
  }
  for (const body of ["", "{", '{"option":"de",}', new Uint8Array([0xff])]) {
    const response = await instance.handle(request({ method: "POST", cookie, body }));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_json" });
  }
  for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
    const response = await instance.handle(request({ method: "POST", cookie, headers: { "content-type": type } }));
    assert.equal(response.status, 415);
    assert.deepEqual(await response.json(), { error: "unsupported_media_type" });
  }
  const missingContentType = request({ method: "POST", cookie });
  missingContentType.headers.delete("content-type");
  assert.equal((await instance.handle(missingContentType)).status, 415);
  assert.equal(db.count(), 0);
  assert.equal((await instance.handle(request({ method: "POST", cookie, headers: { "content-type": "application/json; charset=utf-8" } }))).status, 200);
});

test("body limit bounds streamed bytes with missing or false Content-Length", async t => {
  const db = new SqliteD1(t);
  const instance = worker(db);
  const { cookie } = await identity(instance);
  for (const headers of [{}, { "content-length": "1" }, { "content-length": "999999999999" }]) {
    const response = await instance.handle(request({ method: "POST", cookie, headers, body: " ".repeat(257) }));
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: "payload_too_large" });
  }
  let cancelled = false;
  let pulls = 0;
  const body = new ReadableStream({
    pull(controller) { pulls += 1; controller.enqueue(new Uint8Array(80)); },
    cancel() { cancelled = true; },
  });
  const response = await instance.handle(request({ method: "POST", cookie, body }));
  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
  assert.ok(pulls <= 5, `unexpected unbounded reads: ${pulls}`);
  assert.equal(db.count(), 0);
});

test("cross-origin and cross-site requests fail closed without CORS", async t => {
  const db = new SqliteD1(t);
  const instance = worker(db);
  const { cookie } = await identity(instance);
  const attempts = [
    { origin: "https://evil.example" }, { origin: "null" },
    { origin: "https://nfg-system.online.evil.example" },
    { origin: "https://sub.nfg-system.online" }, { origin: "http://nfg-system.online" },
    { origin, "sec-fetch-site": "cross-site" }, { origin, "sec-fetch-site": "same-site" },
  ];
  for (const headers of attempts) {
    for (const method of ["GET", "POST"]) {
      const response = await instance.handle(request({ method, cookie, headers }));
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: "forbidden" });
      assertPrivate(response);
    }
  }
  const missingOrigin = request({ method: "POST", cookie });
  missingOrigin.headers.delete("origin");
  assert.equal((await instance.handle(missingOrigin)).status, 403);
  assert.equal(db.count(), 0);
  assert.equal((await instance.handle(request({ method: "POST", cookie, headers: { "sec-fetch-site": "same-origin" } }))).status, 200);
});

test("poll methods are explicit and static route behavior is unchanged", async () => {
  const instance = worker();
  for (const method of ["HEAD", "PUT", "DELETE", "OPTIONS"]) {
    const response = await instance.handle(request({ method }));
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, POST");
    assertPrivate(response);
  }
  for (const locale of ["en", "ru", "es", "de", "fr", "it", "pt-br", "zh-cn", "ja", "ko", "tr"]) {
    const response = await instance.handle(new Request(`${origin}/${locale}/`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("set-cookie"), null);
    const head = await instance.handle(new Request(`${origin}/${locale}/`, { method: "HEAD" }));
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  }
  const script = await instance.handle(new Request(`${origin}/assets/language-poll.js`));
  assert.equal(script.status, 200);
  assert.equal(script.headers.get("content-type"), "application/javascript; charset=utf-8");
  assert.ok(instance.fetched.at(-1).includes("/assets/language-poll.js?"));
  const root = await instance.handle(new Request(`${origin}/`, { headers: { cookie: `nfg_locale=ru; ${cookieName}=${"a".repeat(64)}` } }));
  assert.equal(root.headers.get("location"), `${origin}/ru/`);
  assert.equal((await instance.handle(new Request(`${origin}/health`))).status, 200);
  const staticPost = await instance.handle(new Request(`${origin}/ru/`, { method: "POST" }));
  assert.equal(staticPost.status, 405);
  assert.equal(staticPost.headers.get("allow"), "GET, HEAD");
  assert.equal((await instance.handle(new Request(`${origin}/api/polls/unknown`))).status, 404);
});

test("legacy download and community redirects retain their existing targets", async () => {
  const instance = worker();
  const release = "https://github.com/Aneonfas/nfg-amatic-player/releases/tag/player-0.1.5-beta.1";
  const download = "https://github.com/Aneonfas/nfg-amatic-player/releases/download/player-0.1.5-beta.1";
  const redirects = [
    ["/download", `${download}/NFG_A-Matic_Player_Setup_0.1.5-beta.1_win-x64.exe`],
    ["/download/installer", `${download}/NFG_A-Matic_Player_Setup_0.1.5-beta.1_win-x64.exe`],
    ["/download/portable", `${download}/NFG_A-Matic_Player_0.1.5-beta.1_win-x64.zip`],
    ["/download/zip", `${download}/NFG_A-Matic_Player_0.1.5-beta.1_win-x64.zip`],
    ["/release", release], ["/releases/", release],
    ["/github", "https://github.com/Aneonfas/nfg-amatic-player"],
    ["/catalog", "https://github.com/Aneonfas/nfg-amatic-packages/blob/main/catalog.json"],
    ["/discord/", "https://discord.gg/RNJaFUyeyx"],
  ];
  for (const [route, target] of redirects) {
    const response = await instance.handle(new Request(`${origin}${route}`));
    assert.equal(response.status, 302, route);
    assert.equal(response.headers.get("location"), target, route);
  }
});

test("missing D1, a failed query or malformed DB results never invent an empty poll", async () => {
  const brokenBindings = [
    undefined,
    { prepare() { throw new Error("private database configuration"); } },
    ...[{ success: false }, { success: true }, { success: true, results: [{ option_id: "ru", votes: 4, selected: 0 }] },
      { success: true, results: [{ option_id: "zz", votes: 1, selected: 0 }] },
      { success: true, results: [{ option_id: "de", votes: -1, selected: 0 }] },
      { success: true, results: [{ option_id: "pl", votes: -1, selected: 0 }] },
      { success: true, results: [{ option_id: "pl", votes: 1, selected: 0 }, { option_id: "pl", votes: 1, selected: 0 }] },
      { success: true, results: [{ option_id: "pl", votes: 1, selected: 1 }, { option_id: "it", votes: 1, selected: 1 }] }]
      .map(result => ({ prepare() { return { bind() { return { async all() { return result; } }; } }; } })),
  ];
  for (const db of brokenBindings) {
    const instance = worker(db);
    const response = await instance.handle(request());
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "unavailable" });
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("retry-after"), "60");
    assertPrivate(response);
    assert.ok(instance.errors.every(line => line === '{"event":"language_poll_unavailable"}'));
  }
});

test("a failed transactional snapshot rolls back the inserted vote", async t => {
  const db = new SqliteD1(t);
  const instance = worker(db);
  const { cookie } = await identity(instance);
  db.failWithinBatch = true;
  const response = await instance.handle(request({ method: "POST", cookie }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "unavailable" });
  assert.equal(db.count(), 0);
  db.failWithinBatch = false;
  assert.equal((await instance.handle(request({ method: "POST", cookie }))).status, 200);
  assert.equal(db.count(), 1);
});

test("retry after a lost post-commit response finds the first vote without duplication", async t => {
  const db = new SqliteD1(t);
  const instance = worker(db);
  const { cookie } = await identity(instance);
  db.failAfterCommitOnce = true;
  assert.equal((await instance.handle(request({ method: "POST", cookie, option: "ja" }))).status, 503);
  assert.equal(db.count(), 1);
  for (const option of ["ja", "ko"]) {
    const response = await instance.handle(request({ method: "POST", cookie, option }));
    assert.equal(response.status, 200);
    const recovered = await response.json();
    assert.equal(recovered.selectedOption, "ja");
    assert.equal(recovered.totalVotes, 1);
  }
  assert.equal(db.count(), 1);
});

test("database constraints independently reject duplicate voters and invalid identifiers", t => {
  const db = new SqliteD1(t);
  const insert = db.sqlite.prepare("INSERT INTO language_poll_votes VALUES (?, ?, ?)");
  insert.run(pollId, "a".repeat(64), "de");
  assert.throws(() => insert.run(pollId, "a".repeat(64), "fr"), /UNIQUE constraint/);
  for (const option of ["en", "ru", "es", "arbitrary text"]) {
    assert.throws(() => insert.run(pollId, "b".repeat(64), option), /CHECK constraint/);
  }
  assert.throws(() => insert.run("other-poll", "b".repeat(64), "de"), /CHECK constraint/);
  assert.throws(() => insert.run(pollId, "not-a-hash", "de"), /CHECK constraint/);
  assert.equal(db.count(), 1);
});
