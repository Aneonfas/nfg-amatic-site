import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const content = JSON.parse(await readFile(path.join(rootDir, "content/home.locales.json"), "utf8"));
const source = await readFile(path.join(rootDir, "assets/language-poll.js"), "utf8");
const { POLL_ID, POLL_OPTIONS, TURNSTILE_SCRIPT_URL, validatePollSnapshot, requestPoll, initLanguagePoll, initPollShortcut, loadTurnstileScript, turnstileLanguage } =
  await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

function snapshot(counts = {}, selectedOption = null, turnstile = { siteKey: "test-public-sitekey", action: "language-poll" }) {
  const options = POLL_OPTIONS.map((id) => ({ id, votes: counts[id] ?? 0 }));
  return { pollId: POLL_ID, options, totalVotes: options.reduce((sum, option) => sum + option.votes, 0), selectedOption, alreadyVoted: selectedOption !== null, turnstile };
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
  replaceChildren() { this.children.clear(); }
  remove() { this.removed = true; }
  async fire(event, details = { preventDefault() {} }) { await this.listeners[event]?.(details); }
}

function shortcutFixture() {
  const ownerDocument = { activeElement: null };
  const root = new Element({ ownerDocument });
  const dock = new Element();
  const link = new Element({ ownerDocument, attributes: { href: "#language-poll" } });
  dock.children.set("[data-poll-shortcut]", link);
  class Observer {
    constructor(callback) { this.callback = callback; this.targets = []; }
    observe(target) { this.targets.push(target); }
    emit(...entries) { this.callback(entries); }
  }
  return { root, dock, link, ownerDocument, Observer };
}

function fixture(locale = "ru", { autoVerify = true } = {}) {
  const copy = { ...content.locales[locale].poll, locale: content.locales[locale].lang };
  const root = new Element({ ownerDocument: { activeElement: null } });
  const nodes = {};
  for (const name of ["form", "fieldset", "submit", "retry", "status", "results", "total", "verification", "verification-status", "verification-retry", "challenge"]) {
    nodes[name] = new Element();
    root.children.set(`[data-poll-${name}]`, nodes[name]);
  }
  for (const name of ["form", "retry", "status", "results", "verification", "verification-retry"]) nodes[name].hidden = true;
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
  const scriptLoads = [];
  const scriptQueue = [];
  const renders = [];
  const removedWidgets = [];
  const timers = new Map();
  let clock = 1_000;
  let timerId = 0;
  nodes.challenge.clientWidth = 480;
  const widgetApi = {
    render(host, config) {
      const id = `widget-${renders.length + 1}`;
      renders.push({ id, host, config });
      if (autoVerify) config.callback(`token-${renders.length}`);
      return id;
    },
    remove(id) { removedWidgets.push(id); },
  };
  const runtime = {
    Observer: null,
    ResizeObserver: null,
    now: () => clock,
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, at: clock + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async loadTurnstile() {
      scriptLoads.push(true);
      const result = scriptQueue.shift();
      if (result instanceof Error) throw result;
      if (typeof result === "function") return result();
      return widgetApi;
    },
  };
  const fetcher = async (url, options) => {
    calls.push({ url, ...options });
    const item = queue.shift();
    if (item instanceof Error) throw item;
    if (typeof item === "function") return item();
    assert.ok(item, "Unexpected API request");
    return item;
  };
  return {
    root, copy, nodes, radios, rows, calls, queue, fetcher, runtime, scriptLoads, scriptQueue, renders, removedWidgets, widgetApi,
    advance(ms) {
      clock += ms;
      for (const [id, timer] of timers) {
        if (timer.at > clock) continue;
        timers.delete(id);
        timer.callback();
      }
    },
    verify(token = `token-${renders.length}`) { renders.at(-1).config.callback(token); },
    async select(value) {
      for (const radio of radios) radio.checked = radio.value === value;
      await nodes.form.fire("change");
    },
    async submit() { await nodes.form.fire("submit"); },
    async retry() { await nodes.retry.fire("click"); },
    async retryVerification() { await nodes["verification-retry"].fire("click"); },
  };
}

test("poll copies have the same complete schema and the eight approved options", () => {
  const expectedKeys = Object.keys(content.locales.en.poll).sort();
  const errorKeys = Object.keys(content.locales.en.poll.errors).sort();
  const verificationKeys = Object.keys(content.locales.en.poll.verification).sort();
  for (const [locale, { poll }] of Object.entries(content.locales)) {
    assert.deepEqual(Object.keys(poll).sort(), expectedKeys, locale);
    assert.deepEqual(Object.keys(poll.errors).sort(), errorKeys, locale);
    assert.deepEqual(Object.keys(poll.verification).sort(), verificationKeys, locale);
    assert.equal(Object.hasOwn(poll, "browserNote"), false, "The removed cookie sentence must not remain in source copy");
    assert.deepEqual(Object.keys(poll.options), POLL_OPTIONS, locale);
    for (const value of [...Object.values(poll).filter((entry) => typeof entry === "string"), ...Object.values(poll.errors), ...Object.values(poll.options), ...Object.values(poll.verification)]) {
      assert.ok(value.trim().length > 0, `${locale} has empty copy`);
    }
    assert.match(poll.totalVotes, /\{count\}/);
    assert.match(poll.resultCount, /\{votes\}/);
    assert.match(poll.resultCount, /\{percent\}/);
    assert.match(poll.success, /\{language\}/);
    assert.match(poll.voted, /\{language\}/);
    assert.match(poll.verification.wait, /\{seconds\}/);
  }
  assert.deepEqual(POLL_OPTIONS, ["fr", "pt-br", "it", "zh-cn", "ja", "ko", "other"]);
  for (const excluded of ["en", "ru", "es", "pl", "uk", "tr", "de"]) assert.ok(!POLL_OPTIONS.includes(excluded));
  assert.doesNotMatch(source, /localStorage|sessionStorage|innerHTML/);
});

for (const [locale, { poll }] of Object.entries(content.locales)) {
  test(`${locale}: generated poll follows the six products and has an accessible static fallback`, async () => {
    const html = await readFile(path.join(rootDir, locale, "index.html"), "utf8");
    assert.equal((html.match(/class="project-row project-row-active"/g) ?? []).length, 6);
    assert.equal((html.match(/data-language-poll/g) ?? []).length, 1);
    assert.ok(html.indexOf('id="language-poll"') > html.lastIndexOf("</article>"));
    assert.match(html, /<section[^>]*id="language-poll"[^>]*aria-labelledby="language-poll-title"/);
    const pollSection = html.match(/<section\b[^>]*\bid="language-poll"[^>]*>/)?.[0];
    assert.match(pollSection, /\btabindex="-1"/);
    const shortcuts = [...html.matchAll(/<a\b([^>]*\bdata-poll-shortcut\b[^>]*)>([\s\S]*?)<\/a>/g)];
    assert.equal(shortcuts.length, 1, "One shortcut must point to the existing poll");
    assert.ok(shortcuts[0].index < html.indexOf("<main"), "The shortcut must precede the main content");
    assert.match(shortcuts[0][1], /\bhref="#language-poll"/);
    assert.equal(typeof poll.shortcut, "string");
    const shortcutText = poll.shortcut.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    assert.ok(shortcuts[0][2].includes(shortcutText), `${locale} shortcut must use its localized label`);
    assert.match(html, /<script type="module" src="\.\.\/assets\/language-poll\.js\?v=/);
    assert.match(html, /<form data-poll-form[^>]*novalidate hidden>/);
    assert.match(html, /<form data-poll-form aria-describedby="language-poll-status"/);
    assert.doesNotMatch(html, /language-poll-note|poll-note|browserNote/);
    assert.match(html, /data-poll-verification hidden>/);
    assert.match(html, /data-poll-verification-retry hidden>/);
    assert.doesNotMatch(html, /<script[^>]+src="https:\/\/challenges\.cloudflare\.com/);
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

test("poll shortcut follows only the poll's viewport transitions without requesting or casting votes", (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("A shortcut must not call the API"); });
  const f = shortcutFixture();
  const observer = initPollShortcut(f.root, f.dock, f.Observer);
  assert.ok(observer instanceof f.Observer);
  assert.deepEqual(observer.targets, [f.root]);
  assert.equal(f.dock.dataset.pollInView, "false");
  observer.emit({ target: f.root, isIntersecting: false });
  assert.equal(f.dock.dataset.pollInView, "false");
  observer.emit({ target: f.root, isIntersecting: true });
  assert.equal(f.dock.dataset.pollInView, "true");
  observer.emit({ target: new Element(), isIntersecting: false });
  assert.equal(f.dock.dataset.pollInView, "true", "Unrelated entries cannot change poll visibility");
  observer.emit({ target: new Element(), isIntersecting: true }, { target: f.root, isIntersecting: false });
  assert.equal(f.dock.dataset.pollInView, "false");
  assert.equal(fetch.mock.callCount(), 0);
});

test("poll shortcut stays visible while its link has focus and hides after blur only if the poll is in view", async () => {
  const f = shortcutFixture();
  const observer = initPollShortcut(f.root, f.dock, f.Observer);
  f.ownerDocument.activeElement = f.link;
  await f.link.fire("focus");
  observer.emit({ target: f.root, isIntersecting: true });
  assert.equal(f.dock.dataset.pollInView, "false", "Scrolling must not hide a focused link");
  f.ownerDocument.activeElement = f.root;
  await f.link.fire("blur");
  assert.equal(f.dock.dataset.pollInView, "true");

  observer.emit({ target: f.root, isIntersecting: false });
  f.ownerDocument.activeElement = f.link;
  await f.link.fire("focus");
  f.ownerDocument.activeElement = null;
  await f.link.fire("blur");
  assert.equal(f.dock.dataset.pollInView, "false", "Blur alone cannot hide the shortcut to an offscreen poll");
});

test("without IntersectionObserver the poll shortcut remains a working native anchor", async () => {
  for (const Observer of [null, undefined]) {
    const f = shortcutFixture();
    assert.equal(initPollShortcut(f.root, f.dock, Observer), null);
    assert.notEqual(f.dock.dataset.pollInView, "true");
    assert.equal(f.link.attributes.href, "#language-poll");
    let prevented = false;
    await f.link.fire("click", { preventDefault() { prevented = true; } });
    assert.equal(prevented, false, "The shortcut must retain native anchor navigation");
  }
});

test("snapshot validation normalizes order and refuses inconsistent or incomplete results", () => {
  const good = snapshot({ ja: 2, fr: 1 }, "ja");
  assert.deepEqual(validatePollSnapshot({ ...good, options: [...good.options].reverse() }), good);
  const invalid = [
    null, {}, { ...good, pollId: "another-poll" }, { ...good, selectedOption: undefined },
    { ...good, selectedOption: "ru" }, { ...good, selectedOption: "pl" },
    { ...good, selectedOption: "uk" }, { ...good, selectedOption: "de" },
    { ...good, totalVotes: 99 }, { ...good, totalVotes: -1 }, { ...good, totalVotes: 3.1 },
    { ...good, options: good.options.slice(1) },
    { ...good, options: good.options.map((item, i) => i === 0 ? { ...item, votes: -1 } : item) },
    { ...good, options: good.options.map((item, i) => i === 0 ? { ...item, votes: 0.5 } : item) },
    { ...good, options: good.options.map((item, i) => i === 0 ? { ...item, votes: Number.MAX_SAFE_INTEGER + 1 } : item) },
    { ...good, options: good.options.map((item, i) => i === 0 ? { ...item, id: "unknown" } : item) },
    { ...good, options: good.options.map((item, i) => i === 0 ? { ...item, id: good.options[1].id } : item) },
  ];
  for (const value of invalid) assert.throws(() => validatePollSnapshot(value), { code: "unavailable" });
});

test("requests use only the same-origin API with uncached credentials and explicit POST JSON", async () => {
  const calls = [];
  const fetcher = async (url, options) => { calls.push({ url, ...options }); return json(snapshot({ ja: 1 }, "ja")); };
  await requestPoll("GET", undefined, fetcher);
  await requestPoll("POST", "ja", fetcher, "test-turnstile-token");
  assert.deepEqual(calls.map(({ url, method, credentials, cache }) => ({ url, method, credentials, cache })), [
    { url: "/api/polls/next-language", method: "GET", credentials: "same-origin", cache: "no-store" },
    { url: "/api/polls/next-language", method: "POST", credentials: "same-origin", cache: "no-store" },
  ]);
  assert.equal(calls[0].body, undefined);
  assert.equal(calls[1].headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[1].body), { option: "ja", turnstileToken: "test-turnstile-token" });
});

test("failed HTTP, malformed JSON and network failures are not converted into a tally", async () => {
  await assert.rejects(requestPoll("POST", "ja", async () => json({ error: "cookie_required" }, 428), "test-turnstile-token"), { code: "cookie_required" });
  await assert.rejects(requestPoll("GET", undefined, async () => new Response("<html>Error</html>")), { code: "unavailable" });
  await assert.rejects(requestPoll("GET", undefined, async () => { throw new Error("network"); }), { code: "unavailable" });
});

test("loading disables voting and does not display a made-up zero total", async () => {
  const f = fixture();
  let finish;
  f.queue.push(() => new Promise((resolve) => { finish = resolve; }));
  const ready = initLanguagePoll(f.root, f.fetcher, f.runtime);
  assert.equal(f.nodes.fieldset.disabled, true);
  assert.equal(f.nodes.submit.disabled, true);
  assert.equal(f.nodes.results.hidden, true);
  assert.equal(f.nodes.total.textContent, "");
  assert.equal(f.nodes.status.textContent, f.copy.loading);
  finish(json(snapshot({ ja: 8 })));
  await ready;
  assert.equal(f.nodes.results.hidden, false);
  assert.equal(f.nodes.total.textContent, "Всего голосов: 8");
  assert.equal(f.nodes.submit.disabled, true);
});

test("unavailable initial poll has a localized retry and no visible results", async () => {
  const f = fixture();
  f.queue.push(json({ error: "unavailable" }, 503));
  await initLanguagePoll(f.root, f.fetcher, f.runtime);
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
  f.queue.push(json(snapshot({ fr: 2 })), json(snapshot({ ja: 1, fr: 2 }, "ja")));
  await initLanguagePoll(f.root, f.fetcher, f.runtime);
  await f.select("ja");
  assert.equal(f.calls.length, 1);
  assert.equal(f.nodes.submit.disabled, false);
  await f.submit();
  assert.equal(f.calls.length, 2);
  assert.equal(f.nodes.form.hidden, true);
  assert.equal(f.nodes.results.open, true);
  assert.equal(f.nodes.total.textContent, "Всего голосов: 3");
  assert.equal(f.nodes.status.textContent, "Спасибо! Ваш голос: Японский.");
  assert.equal(f.nodes.status.focused, true);
  const selectedRow = f.rows.find(row => row.dataset.pollResult === "ja");
  assert.equal(selectedRow.querySelector("[data-poll-selected]").hidden, false);
  assert.match(selectedRow.querySelector("[data-poll-count]").textContent, /Голосов: 1/);
  await f.submit();
  assert.equal(f.calls.length, 2);
});

test("a saved server choice is restored without POST, including after a locale switch", async () => {
  const f = fixture("fr");
  f.queue.push(json(snapshot({ "pt-br": 4 }, "pt-br")));
  await initLanguagePoll(f.root, f.fetcher, f.runtime);
  assert.equal(f.calls.length, 1);
  assert.equal(f.nodes.form.hidden, true);
  assert.equal(f.nodes.results.open, true);
  assert.equal(f.radios.find((radio) => radio.checked).value, "pt-br");
  assert.match(f.nodes.status.textContent, /Portugais \(Brésil\)/);
  assert.equal(f.nodes.submit.disabled, true);
});

test("the Italian page restores an Italian vote with localized results and messages", async () => {
  const f = fixture("it");
  f.queue.push(json(snapshot({ it: 3 }, "it")));
  await initLanguagePoll(f.root, f.fetcher, f.runtime);
  assert.equal(f.calls[0].method, "GET");
  assert.equal(f.nodes.form.hidden, true);
  assert.equal(f.nodes.total.textContent, "Voti totali: 3");
  assert.equal(f.nodes.status.textContent, "Il tuo voto è registrato: Italiano.");
  assert.equal(f.radios.find((radio) => radio.checked).value, "it");
  assert.match(f.rows.find((row) => row.dataset.pollResult === "it").querySelector("[data-poll-count]").textContent, /Voti: 3/);
});

test("uncertain POST immediately checks GET and recovers a vote accepted before connection loss", async () => {
  const f = fixture();
  f.queue.push(json(snapshot()), new Error("response lost"), json(snapshot({ ja: 1 }, "ja")));
  await initLanguagePoll(f.root, f.fetcher, f.runtime);
  await f.select("ja");
  await f.submit();
  assert.equal(f.radios.find((radio) => radio.checked).value, "ja");
  assert.equal(f.nodes.retry.hidden, true);
  assert.deepEqual(f.calls.map((call) => call.method), ["GET", "POST", "GET"]);
  assert.equal(f.nodes.form.hidden, true);
  assert.equal(f.nodes.total.textContent, "Всего голосов: 1");
  assert.equal(f.nodes.status.textContent, "Ваш голос учтён: Японский.");
});

test("failed refresh retains the chosen radio, hides unavailable results, and enables it again after retry", async () => {
  const f = fixture();
  f.queue.push(json(snapshot({ ja: 1 })), json({ error: "unavailable" }, 503), json(snapshot({ ja: 2 })));
  const controller = await initLanguagePoll(f.root, f.fetcher, f.runtime);
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
  f.queue.push(json(snapshot()), json({ error: "cookie_required" }, 428), json(snapshot()), json(snapshot({ it: 1 }, "it")));
  await initLanguagePoll(f.root, f.fetcher, f.runtime);
  await f.select("it");
  await f.submit();
  assert.equal(f.nodes.status.textContent, f.copy.errors.cookie_required);
  assert.equal(f.radios.find((radio) => radio.checked).value, "it");
  await f.retry();
  assert.equal(f.radios.find((radio) => radio.checked).value, "it");
  await f.submit();
  assert.equal(f.nodes.status.textContent, "Спасибо! Ваш голос: Итальянский.");
});

test("in-flight submission disables controls and prevents duplicate requests", async () => {
  const f = fixture();
  let finish;
  f.queue.push(json(snapshot()), () => new Promise((resolve) => { finish = resolve; }));
  await initLanguagePoll(f.root, f.fetcher, f.runtime);
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
  await initLanguagePoll(f.root, f.fetcher, f.runtime);
  await f.select("ja");
  await f.submit();
  assert.equal(f.radios.find((radio) => radio.checked).value, "fr");
  assert.equal(f.nodes.status.textContent, "Ваш голос учтён: Французский.");
  assert.equal(f.nodes.total.textContent, "Всего голосов: 1");
});

for (const withSnapshot of [true, false]) {
  test(`already_voted error ${withSnapshot ? "with snapshot" : "followed by GET"} recovers the saved choice`, async () => {
    const f = fixture();
    const saved = snapshot({ fr: 1 }, "fr");
    f.queue.push(json(snapshot()), json({ error: "already_voted", ...(withSnapshot ? saved : {}) }, 409));
    if (!withSnapshot) f.queue.push(json(saved));
    await initLanguagePoll(f.root, f.fetcher, f.runtime);
    await f.select("ja");
    await f.submit();
    assert.equal(f.radios.find((radio) => radio.checked).value, "fr");
    assert.equal(f.nodes.form.hidden, true);
    assert.equal(f.nodes.status.textContent, "Ваш голос учтён: Французский.");
  });
}

for (const withSnapshot of [true, false]) {
  test(`a withdrawn prior choice ${withSnapshot ? "with snapshot" : "followed by GET"} shows active results and stays locked`, async () => {
    const f = fixture("it");
    const activeResults = snapshot({ ja: 2 });
    f.queue.push(json(activeResults), json({ error: "already_voted", ...(withSnapshot ? activeResults : {}) }, 409));
    if (!withSnapshot) f.queue.push(json(activeResults));
    await initLanguagePoll(f.root, f.fetcher, f.runtime);
    await f.select("it");
    await f.submit();
    assert.equal(f.nodes.status.textContent, f.copy.errors.already_voted);
    assert.equal(f.nodes.form.hidden, true);
    assert.equal(f.nodes.submit.disabled, true);
    assert.equal(f.nodes.results.hidden, false);
    assert.equal(f.nodes.results.open, true);
    assert.equal(f.nodes.total.textContent, "Voti totali: 2");
    assert.equal(f.nodes.retry.hidden, true);
    await f.submit();
    assert.deepEqual(f.calls.map((call) => call.method), withSnapshot ? ["GET", "POST"] : ["GET", "POST", "GET"]);
  });
}

test("rate-limited voting retains the selection and uses localized retry guidance", async () => {
  const f = fixture();
  f.queue.push(json(snapshot()), json({ error: "rate_limited" }, 429));
  await initLanguagePoll(f.root, f.fetcher, f.runtime);
  await f.select("other");
  await f.submit();
  assert.equal(f.nodes.status.textContent, f.copy.errors.rate_limited);
  assert.equal(f.radios.find((radio) => radio.checked).value, "other");
  assert.equal(f.nodes.retry.hidden, false);
});

test("a successful HTTP status without a confirmed vote cannot show success", async () => {
  const f = fixture();
  f.queue.push(json(snapshot()), json(snapshot()), json(snapshot()));
  await initLanguagePoll(f.root, f.fetcher, f.runtime);
  await f.select("ja");
  await f.submit();
  assert.equal(f.nodes.status.textContent, f.copy.errors.vote_failed);
  assert.equal(f.nodes.form.hidden, false);
  assert.equal(f.radios.find((radio) => radio.checked).value, "ja");
});

test("unknown error codes cannot display unlocalized inherited object properties", async () => {
  const f = fixture();
  f.queue.push(json(snapshot()), json({ error: "__proto__" }, 500), json(snapshot()));
  await initLanguagePoll(f.root, f.fetcher, f.runtime);
  await f.select("ja");
  await f.submit();
  assert.equal(f.nodes.status.textContent, f.copy.errors.vote_failed);
});

test("missing or invalid Turnstile config does not discard valid public results", () => {
  for (const config of [null, undefined, {}, { siteKey: "key", action: "other" }, { siteKey: "<script>", action: "language-poll" }]) {
    const data = snapshot({ ja: 7 });
    data.turnstile = config;
    const result = validatePollSnapshot(data);
    assert.equal(result.totalVotes, 7);
    assert.equal(result.turnstile, null);
  }
  const oldResponse = snapshot();
  delete oldResponse.alreadyVoted;
  delete oldResponse.turnstile;
  assert.equal(validatePollSnapshot(oldResponse).alreadyVoted, false);
  assert.equal(validatePollSnapshot(oldResponse).turnstile, null);
});

test("Turnstile language codes follow all eleven page locales including regional variants", () => {
  for (const [slug, locale] of Object.entries(content.locales)) assert.equal(turnstileLanguage(locale.lang), slug);
  assert.equal(turnstileLanguage("pt-BR"), "pt-br");
  assert.equal(turnstileLanguage("zh-CN"), "zh-cn");
  assert.equal(turnstileLanguage("unsupported"), "auto");
});

test("POST refuses missing or oversized verification tokens before any network request", async () => {
  let requests = 0;
  const fetcher = async () => { requests += 1; return json(snapshot({ ja: 1 }, "ja")); };
  for (const token of [undefined, null, "", "x".repeat(2049)]) {
    await assert.rejects(requestPoll("POST", "ja", fetcher, token), { code: "verification_required" });
  }
  assert.equal(requests, 0);
  await requestPoll("POST", "ja", fetcher, "x".repeat(2048));
  assert.equal(requests, 1);
});

function scriptDocument() {
  const scripts = [];
  const doc = {
    defaultView: {},
    createElement(name) { assert.equal(name, "script"); return new Element(); },
    head: { appendChild(script) { scripts.push(script); } },
  };
  return { doc, scripts, api: { render() {}, ready() { throw new Error("ready() must not be called after explicit script loading"); } } };
}

test("Turnstile script loader uses the official explicit URL and shares concurrent loads", async () => {
  const f = scriptDocument();
  const first = loadTurnstileScript(f.doc);
  const second = loadTurnstileScript(f.doc);
  assert.equal(first, second);
  assert.equal(f.scripts.length, 1);
  assert.equal(f.scripts[0].src, "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit");
  assert.equal(f.scripts[0].src, TURNSTILE_SCRIPT_URL);
  assert.equal(f.scripts[0].async, true);
  f.doc.defaultView.turnstile = f.api;
  f.scripts[0].onload();
  assert.equal(await first, f.api);
  assert.equal(await loadTurnstileScript(f.doc), f.api);
  assert.equal(f.scripts.length, 1);
});

test("a failed script load is removed and can be retried from the official source", async () => {
  const f = scriptDocument();
  const first = loadTurnstileScript(f.doc);
  f.scripts[0].onerror();
  await assert.rejects(first, /turnstile_script_unavailable/);
  assert.equal(f.scripts[0].removed, true);
  const retried = loadTurnstileScript(f.doc);
  assert.equal(f.scripts.length, 2);
  assert.equal(f.scripts[1].src, TURNSTILE_SCRIPT_URL);
  f.doc.defaultView.turnstile = f.api;
  f.scripts[1].onload();
  assert.equal(await retried, f.api);
});

test("a preloaded Turnstile render API works without calling unsupported ready()", async () => {
  const f = scriptDocument();
  f.doc.defaultView.turnstile = f.api;
  assert.equal(await loadTurnstileScript(f.doc), f.api);
  assert.equal(f.scripts.length, 0);
});

test("a Turnstile script timeout removes the stalled load and permits a fresh load", async (t) => {
  const timers = [];
  const cancelled = [];
  t.mock.method(globalThis, "setTimeout", (callback, delay) => {
    const timer = { callback, delay, unref() {} };
    timers.push(timer);
    return timer;
  });
  t.mock.method(globalThis, "clearTimeout", (timer) => { cancelled.push(timer); });
  const f = scriptDocument();
  const first = loadTurnstileScript(f.doc);
  assert.equal(f.scripts.length, 1);
  const oldOnload = f.scripts[0].onload;
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 12_000);
  timers[0].callback();
  await assert.rejects(first, /turnstile_script_timeout/);
  assert.ok(cancelled.includes(timers[0]));
  assert.equal(f.scripts[0].removed, true);
  const second = loadTurnstileScript(f.doc);
  assert.equal(timers.length, 2);
  assert.equal(f.scripts.length, 2);
  f.doc.defaultView.turnstile = f.api;
  oldOnload();
  assert.equal(cancelled.includes(timers[1]), false);
  f.scripts[1].onload();
  assert.equal(await second, f.api);
  assert.ok(cancelled.includes(timers[1]));
});

class TestObserver {
  static instances = [];
  constructor(callback) { this.callback = callback; this.targets = []; TestObserver.instances.push(this); }
  observe(target) { this.targets.push(target); }
  disconnect() { this.disconnected = true; }
  emit(...entries) { this.callback(entries); }
}

test("results load before CAPTCHA; the widget is lazy until the poll enters the viewport", async () => {
  const f = fixture("ru", { autoVerify: false });
  f.runtime.Observer = TestObserver;
  f.queue.push(json(snapshot({ fr: 2 })));
  const controller = await initLanguagePoll(f.root, f.fetcher, f.runtime);
  const observer = TestObserver.instances.at(-1);
  assert.equal(f.scriptLoads.length, 0);
  assert.equal(f.nodes.results.hidden, false);
  assert.equal(f.nodes.total.textContent, "Всего голосов: 2");
  observer.emit({ target: f.root, isIntersecting: false });
  assert.equal(f.scriptLoads.length, 0);
  observer.emit({ target: f.root, isIntersecting: true });
  await controller.beginVerification();
  assert.equal(f.scriptLoads.length, 1);
  assert.equal(f.renders.length, 1);
  assert.equal(f.renders[0].config.action, "language-poll");
  assert.equal(f.renders[0].config["response-field"], false);
  assert.equal(f.renders[0].config.retry, "never");
  assert.equal(f.nodes.submit.disabled, true);
  controller.destroy();
  assert.equal(observer.disconnected, true);
});

test("existing active and withdrawn votes skip the widget and show results without verification", async () => {
  for (const retired of [false, true]) {
    const f = fixture("it", { autoVerify: false });
    const data = retired ? { ...snapshot({ fr: 3 }), alreadyVoted: true } : snapshot({ it: 3 }, "it");
    f.queue.push(json(data));
    const controller = await initLanguagePoll(f.root, f.fetcher, f.runtime);
    await controller.beginVerification();
    await f.select("ja");
    await f.submit();
    assert.equal(f.scriptLoads.length, 0);
    assert.equal(f.renders.length, 0);
    assert.equal(f.nodes.form.hidden, true);
    assert.equal(f.nodes.results.hidden, false);
    assert.equal(f.nodes.results.open, true);
    assert.deepEqual(f.calls.map((call) => call.method), ["GET"]);
  }
});

test("absent configuration keeps results readable and prevents voting until a configured GET", async () => {
  const f = fixture("ru", { autoVerify: false });
  f.queue.push(json(snapshot({ ja: 9 }, null, null)), json(snapshot({ ja: 9 })));
  await initLanguagePoll(f.root, f.fetcher, f.runtime);
  await f.select("ja");
  await f.submit();
  assert.equal(f.calls.length, 1);
  assert.equal(f.scriptLoads.length, 0);
  assert.equal(f.nodes.results.hidden, false);
  assert.equal(f.nodes.total.textContent, "Всего голосов: 9");
  assert.equal(f.nodes.submit.disabled, true);
  assert.equal(f.nodes["verification-status"].textContent, f.copy.verification.unavailable);
  await f.retry();
  assert.equal(f.renders.length, 1);
  assert.equal(f.radios.find((radio) => radio.checked).value, "ja");
  f.verify();
  assert.equal(f.nodes.submit.disabled, false);
});

test("script failure preserves selection and results, and the localized retry restores verification", async () => {
  const f = fixture("ru", { autoVerify: false });
  f.queue.push(json(snapshot({ fr: 2 })));
  f.scriptQueue.push(new Error("script blocked"));
  await initLanguagePoll(f.root, f.fetcher, f.runtime);
  await f.select("ja");
  assert.equal(f.nodes.submit.disabled, true);
  assert.equal(f.nodes.results.hidden, false);
  assert.equal(f.radios.find((radio) => radio.checked).value, "ja");
  assert.equal(f.nodes["verification-status"].textContent, f.copy.verification.unavailable);
  assert.equal(f.nodes["verification-retry"].hidden, false);
  assert.equal(f.nodes["verification-retry"].disabled, false);
  await f.retryVerification();
  assert.equal(f.scriptLoads.length, 2);
  assert.equal(f.renders.length, 1);
  assert.equal(f.nodes["verification-status"].focused, true);
  f.verify();
  assert.equal(f.nodes.submit.disabled, false);
});

test("verification is required, expires, and ignores callbacks from a replaced widget", async () => {
  const f = fixture("ru", { autoVerify: false });
  f.queue.push(json(snapshot()));
  await initLanguagePoll(f.root, f.fetcher, f.runtime);
  await f.select("ja");
  await f.submit();
  assert.equal(f.calls.length, 1);
  assert.equal(f.nodes.submit.disabled, true);
  f.verify("token-A");
  assert.equal(f.nodes.submit.disabled, false);
  const oldCallbacks = f.renders[0].config;
  oldCallbacks["expired-callback"]();
  assert.equal(f.nodes.submit.disabled, true);
  assert.equal(f.nodes["verification-status"].textContent, f.copy.verification.expired);
  assert.equal(f.radios.find((radio) => radio.checked).value, "ja");
  await f.retryVerification();
  oldCallbacks.callback("token-A");
  assert.equal(f.nodes.submit.disabled, true);
  f.verify("token-B");
  assert.equal(f.nodes.submit.disabled, false);
  f.advance(290_000);
  assert.equal(f.nodes.submit.disabled, true, "Local expiration also blocks tokens if the widget's expiration event is delayed");
});

test("widget errors, interactive timeouts and unsupported browsers leave public results accessible", async () => {
  for (const [callback, message] of [["error-callback", "failed"], ["timeout-callback", "expired"], ["unsupported-callback", "unavailable"]]) {
    const f = fixture("it", { autoVerify: false });
    f.queue.push(json(snapshot({ it: 2 })));
    await initLanguagePoll(f.root, f.fetcher, f.runtime);
    await f.select("it");
    f.renders[0].config[callback]();
    assert.equal(f.nodes["verification-status"].textContent, f.copy.verification[message]);
    assert.equal(f.nodes["verification-retry"].hidden, false);
    assert.equal(f.nodes.submit.disabled, true);
    assert.equal(f.nodes.results.hidden, false);
  }
});

test("a late script load cannot render a widget after GET discovers a saved vote", async () => {
  const f = fixture("ru", { autoVerify: false });
  let finish;
  f.scriptQueue.push(() => new Promise((resolve) => { finish = resolve; }));
  f.queue.push(json(snapshot()), json(snapshot({ ja: 1 }, "ja")));
  const controller = await initLanguagePoll(f.root, f.fetcher, f.runtime);
  const selecting = f.select("ja");
  await controller.refresh();
  finish(f.widgetApi);
  await selecting;
  assert.equal(f.renders.length, 0);
  assert.equal(f.nodes.form.hidden, true);
  assert.equal(f.nodes.results.open, true);
});

test("each POST consumes its token and retry requires a fresh verification token", async () => {
  const f = fixture("ru", { autoVerify: false });
  f.queue.push(json(snapshot()), json({ error: "verification_failed" }, 403), json(snapshot({ it: 1 }, "it")));
  await initLanguagePoll(f.root, f.fetcher, f.runtime);
  await f.select("it");
  f.verify("token-first");
  const oldCallbacks = f.renders[0].config;
  await f.submit();
  assert.equal(f.nodes.status.textContent, f.copy.errors.verification_failed);
  assert.equal(f.nodes.submit.disabled, true);
  oldCallbacks.callback("token-first");
  assert.equal(f.nodes.submit.disabled, true);
  await f.retryVerification();
  assert.equal(f.nodes.submit.disabled, true);
  f.verify("token-second");
  await f.submit();
  assert.deepEqual(f.calls.filter((call) => call.method === "POST").map((call) => JSON.parse(call.body).turnstileToken), ["token-first", "token-second"]);
  assert.equal(f.nodes.form.hidden, true);
});

test("429 honors Retry-After, blocks retries during cooldown and still needs a fresh token afterward", async () => {
  const f = fixture("ru", { autoVerify: false });
  f.queue.push(json(snapshot()), Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } }), json(snapshot({ other: 1 }, "other")));
  await initLanguagePoll(f.root, f.fetcher, f.runtime);
  await f.select("other");
  f.verify("token-before-limit");
  await f.submit();
  assert.equal(f.nodes.retry.disabled, true);
  assert.equal(f.nodes["verification-retry"].disabled, true);
  assert.match(f.nodes["verification-status"].textContent, /60/);
  await f.retry();
  await f.retryVerification();
  await f.submit();
  assert.equal(f.calls.length, 2);
  assert.equal(f.renders.length, 1);
  f.advance(59_999);
  assert.equal(f.nodes.retry.disabled, true);
  f.advance(1);
  assert.equal(f.nodes.retry.disabled, false);
  assert.equal(f.nodes.submit.disabled, true);
  await f.retryVerification();
  f.verify("token-after-limit");
  await f.submit();
  assert.equal(f.nodes.form.hidden, true);
  assert.deepEqual(f.calls.filter((call) => call.method === "POST").map((call) => JSON.parse(call.body).turnstileToken), ["token-before-limit", "token-after-limit"]);
});

test("uncertain POST plus failed recovery GET blocks further POST until a later GET resolves the saved state", async () => {
  const f = fixture();
  f.queue.push(json(snapshot()), new Error("lost response"), json({ error: "unavailable" }, 503), json(snapshot({ ja: 1 }, "ja")));
  await initLanguagePoll(f.root, f.fetcher, f.runtime);
  await f.select("ja");
  await f.submit();
  assert.deepEqual(f.calls.map((call) => call.method), ["GET", "POST", "GET"]);
  assert.equal(f.nodes.status.textContent, f.copy.errors.vote_failed);
  assert.equal(f.nodes.submit.disabled, true);
  assert.equal(f.radios.find((radio) => radio.checked).value, "ja");
  await f.submit();
  assert.equal(f.calls.length, 3);
  await f.retry();
  assert.equal(f.nodes.status.textContent, "Ваш голос учтён: Японский.");
  assert.equal(f.nodes.form.hidden, true);
  assert.equal(f.scriptLoads.length, 1);
});

test("narrow containers use compact widgets and resizing invalidates the former token safely", async () => {
  const f = fixture("pt-br", { autoVerify: false });
  f.runtime.ResizeObserver = TestObserver;
  f.queue.push(json(snapshot()));
  const controller = await initLanguagePoll(f.root, f.fetcher, f.runtime);
  const observer = TestObserver.instances.at(-1);
  await f.select("pt-br");
  assert.equal(f.renders[0].config.size, "flexible");
  assert.equal(f.renders[0].config.language, "pt-br");
  f.verify();
  f.nodes.challenge.clientWidth = 234;
  observer.emit({ target: f.nodes.challenge });
  await controller.beginVerification();
  assert.equal(f.renders[1].config.size, "compact");
  assert.equal(f.nodes.submit.disabled, true);
  assert.equal(f.radios.find((radio) => radio.checked).value, "pt-br");
  controller.destroy();
  assert.equal(observer.disconnected, true);
});

test("the removed cookie note has no remaining CSS selector", async () => {
  const css = await readFile(path.join(rootDir, "assets/home.css"), "utf8");
  assert.doesNotMatch(css, /\.poll-note\b/);
});
