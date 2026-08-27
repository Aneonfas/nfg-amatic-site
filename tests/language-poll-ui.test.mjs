import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const content = JSON.parse(await readFile(path.join(rootDir, "content/home.locales.json"), "utf8"));
const source = await readFile(path.join(rootDir, "assets/language-poll.js"), "utf8");
const { POLL_ID, POLL_OPTIONS, validatePollSnapshot, requestPoll, initLanguagePoll } =
  await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

function snapshot(counts = {}, selectedOption = null) {
  const options = POLL_OPTIONS.map((id) => ({ id, votes: counts[id] ?? 0 }));
  return { pollId: POLL_ID, options, totalVotes: options.reduce((sum, option) => sum + option.votes, 0), selectedOption };
}

function json(payload, status = 200) {
  return Response.json(payload, { status });
}

class Element {
  constructor(properties = {}) {
    Object.assign(this, { hidden: false, disabled: false, checked: false, textContent: "", dataset: {}, style: {}, attributes: {}, listeners: {}, children: new Map() }, properties);
  }
  querySelector(selector) { return this.children.get(selector); }
  querySelectorAll(selector) { return this.children.get(selector) ?? []; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(event, callback) { this.listeners[event] = callback; }
  focus() { this.focused = true; }
  async fire(event) { await this.listeners[event]?.({ preventDefault() {} }); }
}

function fixture(locale = "ru") {
  const copy = { ...content.locales[locale].poll, locale: content.locales[locale].lang };
  const root = new Element();
  const nodes = {};
  for (const name of ["form", "fieldset", "submit", "retry", "status", "results", "total"]) {
    nodes[name] = new Element();
    root.children.set(`[data-poll-${name}]`, nodes[name]);
  }
  for (const name of ["form", "retry", "status", "results"]) nodes[name].hidden = true;
  nodes.fieldset.disabled = true;
  nodes.submit.disabled = true;
  nodes.results.children.set("summary", new Element());
  root.children.set("[data-poll-copy]", new Element({ textContent: JSON.stringify(copy) }));
  const radios = POLL_OPTIONS.map((value) => new Element({ value }));
  nodes.form.children.set('input[name="next-language"]', radios);
  const rows = POLL_OPTIONS.map((id) => {
    const row = new Element({ dataset: { pollResult: id } });
    for (const name of ["count", "bar", "selected"]) {
      row.children.set(`[data-poll-${name}]`, new Element({ hidden: name === "selected" }));
    }
    return row;
  });
  root.children.set("[data-poll-result]", rows);
  const calls = [];
  const queue = [];
  const fetcher = async (url, options) => {
    calls.push({ url, ...options });
    const item = queue.shift();
    if (item instanceof Error) throw item;
    if (typeof item === "function") return item();
    assert.ok(item, "Unexpected API request");
    return item;
  };
  return {
    root, copy, nodes, radios, rows, calls, queue, fetcher,
    async select(value) {
      for (const radio of radios) radio.checked = radio.value === value;
      await nodes.form.fire("change");
    },
    async submit() { await nodes.form.fire("submit"); },
    async retry() { await nodes.retry.fire("click"); },
  };
}

test("poll copies have the same complete schema and the same eleven language options", () => {
  const expectedKeys = Object.keys(content.locales.en.poll).sort();
  const errorKeys = Object.keys(content.locales.en.poll.errors).sort();
  for (const [locale, { poll }] of Object.entries(content.locales)) {
    assert.deepEqual(Object.keys(poll).sort(), expectedKeys, locale);
    assert.deepEqual(Object.keys(poll.errors).sort(), errorKeys, locale);
    assert.deepEqual(Object.keys(poll.options), POLL_OPTIONS, locale);
    for (const value of [...Object.values(poll).filter((entry) => typeof entry === "string"), ...Object.values(poll.errors), ...Object.values(poll.options)]) {
      assert.ok(value.trim().length > 0, `${locale} has empty copy`);
    }
    assert.match(poll.totalVotes, /\{count\}/);
    assert.match(poll.resultCount, /\{votes\}/);
    assert.match(poll.resultCount, /\{percent\}/);
    assert.match(poll.success, /\{language\}/);
    assert.match(poll.voted, /\{language\}/);
  }
  assert.equal(POLL_OPTIONS.length, 11);
  for (const existing of ["en", "ru", "es"]) assert.ok(!POLL_OPTIONS.includes(existing));
  assert.doesNotMatch(source, /localStorage|sessionStorage|innerHTML/);
});

for (const [locale, { poll }] of Object.entries(content.locales)) {
  test(`${locale}: generated poll follows the five products and has an accessible static fallback`, async () => {
    const html = await readFile(path.join(rootDir, locale, "index.html"), "utf8");
    assert.equal((html.match(/class="project-row project-row-active"/g) ?? []).length, 5);
    assert.equal((html.match(/data-language-poll/g) ?? []).length, 1);
    assert.ok(html.indexOf('id="language-poll"') > html.lastIndexOf("</article>"));
    assert.match(html, /<section[^>]*id="language-poll"[^>]*aria-labelledby="language-poll-title"/);
    assert.match(html, /<script type="module" src="\.\.\/assets\/language-poll\.js\?v=/);
    assert.match(html, /<form data-poll-form[^>]*novalidate hidden>/);
    assert.match(html, /<fieldset class="poll-fieldset" data-poll-fieldset disabled>/);
    assert.match(html, /role="status" aria-live="polite" aria-atomic="true"/);
    assert.match(html, /<details class="poll-results" data-poll-results hidden>/);
    assert.ok(html.includes(`<noscript><p class="poll-noscript">${poll.noscript}</p></noscript>`));
    assert.deepEqual([...html.matchAll(/name="next-language" value="([^"]+)" required/g)].map((match) => match[1]), POLL_OPTIONS);
    const config = JSON.parse(html.match(/<script type="application\/json" data-poll-copy>(.*?)<\/script>/s)[1]);
    assert.deepEqual(config.options, poll.options);
    assert.equal(config.locale, content.locales[locale].lang);
  });
}

test("snapshot validation normalizes order and refuses inconsistent or incomplete results", () => {
  const good = snapshot({ de: 2, fr: 1 }, "de");
  assert.deepEqual(validatePollSnapshot({ ...good, options: [...good.options].reverse() }), good);
  const invalid = [
    null, {}, { ...good, pollId: "another-poll" }, { ...good, selectedOption: undefined },
    { ...good, selectedOption: "ru" }, { ...good, selectedOption: "pl" },
    { ...good, totalVotes: 99 }, { ...good, totalVotes: -1 }, { ...good, totalVotes: 3.1 },
    { ...good, options: good.options.slice(1) },
    { ...good, options: good.options.map((item, i) => i === 0 ? { ...item, votes: -1 } : item) },
    { ...good, options: good.options.map((item, i) => i === 0 ? { ...item, votes: 0.5 } : item) },
    { ...good, options: good.options.map((item, i) => i === 0 ? { ...item, votes: Number.MAX_SAFE_INTEGER + 1 } : item) },
    { ...good, options: good.options.map((item, i) => i === 0 ? { ...item, id: "unknown" } : item) },
    { ...good, options: good.options.map((item, i) => i === 0 ? { ...item, id: "fr" } : item) },
  ];
  for (const value of invalid) assert.throws(() => validatePollSnapshot(value), { code: "unavailable" });
});

test("requests use only the same-origin API with uncached credentials and explicit POST JSON", async () => {
  const calls = [];
  const fetcher = async (url, options) => { calls.push({ url, ...options }); return json(snapshot({ de: 1 }, "de")); };
  await requestPoll("GET", undefined, fetcher);
  await requestPoll("POST", "de", fetcher);
  assert.deepEqual(calls.map(({ url, method, credentials, cache }) => ({ url, method, credentials, cache })), [
    { url: "/api/polls/next-language", method: "GET", credentials: "same-origin", cache: "no-store" },
    { url: "/api/polls/next-language", method: "POST", credentials: "same-origin", cache: "no-store" },
  ]);
  assert.equal(calls[0].body, undefined);
  assert.equal(calls[1].headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[1].body), { option: "de" });
});

test("failed HTTP, malformed JSON and network failures are not converted into a tally", async () => {
  await assert.rejects(requestPoll("POST", "de", async () => json({ error: "cookie_required" }, 428)), { code: "cookie_required" });
  await assert.rejects(requestPoll("GET", undefined, async () => new Response("<html>Error</html>")), { code: "unavailable" });
  await assert.rejects(requestPoll("GET", undefined, async () => { throw new Error("network"); }), { code: "unavailable" });
});

test("loading disables voting and does not display a made-up zero total", async () => {
  const f = fixture();
  let finish;
  f.queue.push(() => new Promise((resolve) => { finish = resolve; }));
  const ready = initLanguagePoll(f.root, f.fetcher);
  assert.equal(f.nodes.fieldset.disabled, true);
  assert.equal(f.nodes.submit.disabled, true);
  assert.equal(f.nodes.results.hidden, true);
  assert.equal(f.nodes.total.textContent, "");
  assert.equal(f.nodes.status.textContent, f.copy.loading);
  finish(json(snapshot({ de: 8 })));
  await ready;
  assert.equal(f.nodes.results.hidden, false);
  assert.equal(f.nodes.total.textContent, "Всего голосов: 8");
  assert.equal(f.nodes.submit.disabled, true);
});

test("unavailable initial poll has a localized retry and no visible results", async () => {
  const f = fixture();
  f.queue.push(json({ error: "unavailable" }, 503));
  await initLanguagePoll(f.root, f.fetcher);
  assert.equal(f.nodes.results.hidden, true);
  assert.equal(f.nodes.total.textContent, "");
  assert.equal(f.nodes.status.textContent, f.copy.errors.unavailable);
  assert.equal(f.nodes.retry.hidden, false);
  assert.equal(f.nodes.fieldset.disabled, true);
  f.queue.push(json(snapshot()));
  await f.retry();
  assert.equal(f.nodes.results.hidden, false);
  assert.equal(f.nodes.fieldset.disabled, false);
});

test("selecting does not vote; an explicit submit displays the shared updated tally and selected choice", async () => {
  const f = fixture();
  f.queue.push(json(snapshot({ fr: 2 })), json(snapshot({ de: 1, fr: 2 }, "de")));
  await initLanguagePoll(f.root, f.fetcher);
  await f.select("de");
  assert.equal(f.calls.length, 1);
  assert.equal(f.nodes.submit.disabled, false);
  await f.submit();
  assert.equal(f.calls.length, 2);
  assert.equal(f.nodes.form.hidden, true);
  assert.equal(f.nodes.results.open, true);
  assert.equal(f.nodes.total.textContent, "Всего голосов: 3");
  assert.equal(f.nodes.status.textContent, "Спасибо! Ваш голос: Немецкий.");
  assert.equal(f.nodes.status.focused, true);
  assert.equal(f.rows[0].querySelector("[data-poll-selected]").hidden, false);
  assert.match(f.rows[0].querySelector("[data-poll-count]").textContent, /Голосов: 1/);
  await f.submit();
  assert.equal(f.calls.length, 2);
});

test("a saved server choice is restored without POST, including after a locale switch", async () => {
  const f = fixture("fr");
  f.queue.push(json(snapshot({ "pt-br": 4 }, "pt-br")));
  await initLanguagePoll(f.root, f.fetcher);
  assert.equal(f.calls.length, 1);
  assert.equal(f.nodes.form.hidden, true);
  assert.equal(f.nodes.results.open, true);
  assert.equal(f.radios.find((radio) => radio.checked).value, "pt-br");
  assert.match(f.nodes.status.textContent, /Portugais \(Brésil\)/);
  assert.equal(f.nodes.submit.disabled, true);
});

test("failed POST preserves the selection; a GET retry can recover a vote accepted before connection loss", async () => {
  const f = fixture();
  f.queue.push(json(snapshot()), new Error("response lost"), json(snapshot({ ja: 1 }, "ja")));
  await initLanguagePoll(f.root, f.fetcher);
  await f.select("ja");
  await f.submit();
  assert.equal(f.radios.find((radio) => radio.checked).value, "ja");
  assert.equal(f.nodes.form.hidden, false);
  assert.equal(f.nodes.status.textContent, f.copy.errors.vote_failed);
  assert.equal(f.nodes.retry.hidden, false);
  await f.retry();
  assert.deepEqual(f.calls.map((call) => call.method), ["GET", "POST", "GET"]);
  assert.equal(f.nodes.form.hidden, true);
  assert.equal(f.nodes.total.textContent, "Всего голосов: 1");
  assert.equal(f.nodes.status.textContent, "Ваш голос учтён: Японский.");
});

test("failed refresh retains the chosen radio, hides unavailable results, and enables it again after retry", async () => {
  const f = fixture();
  f.queue.push(json(snapshot({ de: 1 })), json({ error: "unavailable" }, 503), json(snapshot({ de: 2 })));
  const controller = await initLanguagePoll(f.root, f.fetcher);
  await f.select("ko");
  await controller.refresh();
  assert.equal(f.radios.find((radio) => radio.checked).value, "ko");
  assert.equal(f.nodes.results.hidden, true);
  assert.equal(f.nodes.submit.disabled, true);
  await f.retry();
  assert.equal(f.radios.find((radio) => radio.checked).value, "ko");
  assert.equal(f.nodes.submit.disabled, false);
  assert.equal(f.nodes.total.textContent, "Всего голосов: 2");
});

test("cookie_required explains recovery, preserves the choice, and allows voting after GET retry", async () => {
  const f = fixture();
  f.queue.push(json(snapshot()), json({ error: "cookie_required" }, 428), json(snapshot()), json(snapshot({ pl: 1 }, "pl")));
  await initLanguagePoll(f.root, f.fetcher);
  await f.select("pl");
  await f.submit();
  assert.equal(f.nodes.status.textContent, f.copy.errors.cookie_required);
  assert.equal(f.radios.find((radio) => radio.checked).value, "pl");
  await f.retry();
  assert.equal(f.radios.find((radio) => radio.checked).value, "pl");
  await f.submit();
  assert.equal(f.nodes.status.textContent, "Спасибо! Ваш голос: Польский.");
});

test("in-flight submission disables controls and prevents duplicate requests", async () => {
  const f = fixture();
  let finish;
  f.queue.push(json(snapshot()), () => new Promise((resolve) => { finish = resolve; }));
  await initLanguagePoll(f.root, f.fetcher);
  await f.select("it");
  const submitting = f.submit();
  assert.equal(f.nodes.fieldset.disabled, true);
  assert.equal(f.nodes.submit.textContent, f.copy.submitting);
  await f.submit();
  assert.equal(f.calls.length, 2);
  finish(json(snapshot({ it: 1 }, "it")));
  await submitting;
  assert.equal(f.nodes.results.open, true);
});

test("duplicate POST response retains the original server choice, not the attempted new one", async () => {
  const f = fixture();
  f.queue.push(json(snapshot()), json(snapshot({ fr: 1 }, "fr")));
  await initLanguagePoll(f.root, f.fetcher);
  await f.select("de");
  await f.submit();
  assert.equal(f.radios.find((radio) => radio.checked).value, "fr");
  assert.equal(f.nodes.status.textContent, "Ваш голос учтён: Французский.");
  assert.equal(f.nodes.total.textContent, "Всего голосов: 1");
});

for (const withSnapshot of [true, false]) {
  test(`already_voted error ${withSnapshot ? "with snapshot" : "followed by GET"} recovers the saved choice`, async () => {
    const f = fixture();
    const saved = snapshot({ tr: 1 }, "tr");
    f.queue.push(json(snapshot()), json({ error: "already_voted", ...(withSnapshot ? saved : {}) }, 409));
    if (!withSnapshot) f.queue.push(json(saved));
    await initLanguagePoll(f.root, f.fetcher);
    await f.select("de");
    await f.submit();
    assert.equal(f.radios.find((radio) => radio.checked).value, "tr");
    assert.equal(f.nodes.form.hidden, true);
    assert.equal(f.nodes.status.textContent, "Ваш голос учтён: Турецкий.");
  });
}

test("rate-limited voting retains the selection and uses localized retry guidance", async () => {
  const f = fixture();
  f.queue.push(json(snapshot()), json({ error: "rate_limited" }, 429));
  await initLanguagePoll(f.root, f.fetcher);
  await f.select("other");
  await f.submit();
  assert.equal(f.nodes.status.textContent, f.copy.errors.rate_limited);
  assert.equal(f.radios.find((radio) => radio.checked).value, "other");
  assert.equal(f.nodes.retry.hidden, false);
});

test("a successful HTTP status without a confirmed vote cannot show success", async () => {
  const f = fixture();
  f.queue.push(json(snapshot()), json(snapshot()));
  await initLanguagePoll(f.root, f.fetcher);
  await f.select("de");
  await f.submit();
  assert.equal(f.nodes.status.textContent, f.copy.errors.vote_failed);
  assert.equal(f.nodes.form.hidden, false);
  assert.equal(f.radios.find((radio) => radio.checked).value, "de");
});

test("unknown error codes cannot display unlocalized inherited object properties", async () => {
  const f = fixture();
  f.queue.push(json(snapshot()), json({ error: "__proto__" }, 500));
  await initLanguagePoll(f.root, f.fetcher);
  await f.select("de");
  await f.submit();
  assert.equal(f.nodes.status.textContent, f.copy.errors.vote_failed);
});
