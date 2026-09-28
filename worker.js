const PLAYER_VERSION = "0.1.5-beta.1";
const RUNTIME_VERSION = "0.1.12";
const RELEASE_URL = "https://github.com/Aneonfas/nfg-amatic-player/releases/tag/player-0.1.5-beta.1";
const SETUP_URL = "https://github.com/Aneonfas/nfg-amatic-player/releases/download/player-0.1.5-beta.1/NFG_A-Matic_Player_Setup_0.1.5-beta.1_win-x64.exe";
const ZIP_URL = "https://github.com/Aneonfas/nfg-amatic-player/releases/download/player-0.1.5-beta.1/NFG_A-Matic_Player_0.1.5-beta.1_win-x64.zip";
const REPO_URL = "https://github.com/Aneonfas/nfg-amatic-player";
const PACKAGE_REPO_URL = "https://github.com/Aneonfas/nfg-amatic-packages";
const DISCORD_URL = "https://discord.gg/RNJaFUyeyx";
const STATIC_BASE = "https://raw.githubusercontent.com/Aneonfas/nfg-amatic-site/main";
const STATIC_REV = "2026-08-10-auto-locale";
const DEFAULT_LOCALE = "en";
const LOCALE_COOKIE = "nfg_locale";
const LOCALE_SLUGS = new Set([
  "en",
  "ru",
  "es",
  "de",
  "fr",
  "it",
  "pt-br",
  "zh-cn",
  "ja",
  "ko",
  "tr",
]);
const CONTENT_LANGUAGES = {
  en: "en",
  ru: "ru",
  es: "es",
  de: "de",
  fr: "fr",
  it: "it",
  "pt-br": "pt-BR",
  "zh-cn": "zh-CN",
  ja: "ja",
  ko: "ko",
  tr: "tr",
};
const COUNTRY_LOCALES = {
  RU: "ru",
  ES: "es",
  MX: "es",
  AR: "es",
  CL: "es",
  CO: "es",
  PE: "es",
  VE: "es",
  UY: "es",
  PY: "es",
  BO: "es",
  EC: "es",
  CR: "es",
  PA: "es",
  DO: "es",
  GT: "es",
  HN: "es",
  SV: "es",
  NI: "es",
  CU: "es",
  DE: "de",
  AT: "de",
  FR: "fr",
  IT: "it",
  BR: "pt-br",
  CN: "zh-cn",
  SG: "zh-cn",
  JP: "ja",
  KR: "ko",
  TR: "tr",
};

const STATIC_ROUTES = {
  "/": "index.html",
  "/index.html": "index.html",
  "/foxhole-clicker": "foxhole-clicker/index.html",
  "/foxhole-clicker/": "foxhole-clicker/index.html",
  "/foxhole-clicker/index.html": "foxhole-clicker/index.html",
  "/packages": "packages/index.html",
  "/packages/": "packages/index.html",
  "/packages/index.html": "packages/index.html",
  "/support": "support/index.html",
  "/support/": "support/index.html",
  "/support/index.html": "support/index.html",
  "/assets/site.css": "assets/site.css",
  "/assets/site-20260529.css": "assets/site.css",
  "/assets/site-20260529b.css": "assets/site.css",
  "/assets/site-20260529c.css": "assets/site.css",
  "/assets/site-20260529d.css": "assets/site.css",
  "/assets/home.css": "assets/home.css",
  "/assets/site.js": "assets/site.js",
  "/assets/language-poll.js": "assets/language-poll.js",
  "/robots.txt": "robots.txt",
  "/sitemap.xml": "sitemap.xml",
  "/llms.txt": "llms.txt",
  "/favicon.ico": "favicon.ico",
};

const ASSET_PREFIXES = ["/assets/brand/", "/assets/foxhole-helper/"];

const LANGUAGE_POLL_PATH = "/api/polls/next-language";
const LANGUAGE_POLL_ID = "anvil-next-language-v1";
const LANGUAGE_POLL_OPTIONS = [
  "de", "fr", "pt-br", "it", "zh-cn", "ja", "ko", "other",
];
// Preserve historical rows from the first poll version, but exclude these
// choices from active results. Retiring an option must not reset identities.
const LANGUAGE_POLL_RETIRED_OPTIONS = ["pl", "uk", "tr"];
const LANGUAGE_POLL_COOKIE = "__Host-nfg_language_poll";
const LANGUAGE_POLL_BODY_LIMIT = 4096;
const LANGUAGE_POLL_TURNSTILE_TOKEN_LIMIT = 2048;
const LANGUAGE_POLL_TURNSTILE_ACTION = "language-poll";
const LANGUAGE_POLL_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const LANGUAGE_POLL_SITEVERIFY_TIMEOUT = 5000;
const LANGUAGE_POLL_SITEVERIFY_BODY_LIMIT = 16384;
const LANGUAGE_POLL_SNAPSHOT_SQL = `
  SELECT option_id, COUNT(*) AS votes,
         MAX(CASE WHEN voter_hash = ?2 THEN 1 ELSE 0 END) AS selected
  FROM language_poll_votes
  WHERE poll_id = ?1
  GROUP BY option_id
`;

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};

async function handleRequest(request, env = {}) {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);

  if (path === LANGUAGE_POLL_PATH || path === `${LANGUAGE_POLL_PATH}/`) {
    return handleLanguagePoll(request, url, env);
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    });
  }

  const isRoot = path === "/" || path === "/index.html";
  if (isRoot) {
    const requestedLocale = url.searchParams.get("lang")?.toLowerCase();
    if (requestedLocale && LOCALE_SLUGS.has(requestedLocale)) {
      return redirectToLocale(url, requestedLocale, true);
    }

    const savedLocale = readLocalePreference(request.headers.get("cookie"));
    if (savedLocale) {
      return redirectToLocale(url, savedLocale, false);
    }

    const browserLocale = localeFromAcceptLanguage(
      request.headers.get("accept-language"),
    );
    const countryLocale = localeFromCountry(request.cf?.country);
    return redirectToLocale(
      url,
      browserLocale || countryLocale || DEFAULT_LOCALE,
      false,
    );
  }

  const localeSlug = localeSlugFromPath(path);
  if (localeSlug) {
    return serveStatic(`${localeSlug}/index.html`, request.method, {
      "content-language": CONTENT_LANGUAGES[localeSlug],
    });
  }

  if (path === "/download" || path === "/download/" || path === "/download/installer") {
    return Response.redirect(SETUP_URL, 302);
  }

  if (path === "/download/portable" || path === "/download/zip") {
    return Response.redirect(ZIP_URL, 302);
  }

  if (path === "/release" || path === "/releases" || path === "/releases/") {
    return Response.redirect(RELEASE_URL, 302);
  }

  if (path === "/github") {
    return Response.redirect(REPO_URL, 302);
  }

  if (path === "/catalog") {
    return Response.redirect(`${PACKAGE_REPO_URL}/blob/main/catalog.json`, 302);
  }

  if (path === "/discord" || path === "/discord/") {
    return Response.redirect(DISCORD_URL, 302);
  }

  if (path === "/health") {
    return json({
      ok: true,
      playerVersion: PLAYER_VERSION,
      runtimeVersion: RUNTIME_VERSION,
      release: RELEASE_URL,
    });
  }

  const staticPath = resolveStaticPath(path);
  if (staticPath) {
    return serveStatic(staticPath, request.method);
  }

  return new Response("Not found", {
    status: 404,
    headers: responseHeaders("text/plain; charset=utf-8", 60),
  });
}

async function handleLanguagePoll(request, url, env) {
  if (request.method !== "GET" && request.method !== "POST") {
    return pollJson({ error: "method_not_allowed" }, 405, { allow: "GET, POST" });
  }

  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (
    (origin !== null && origin !== url.origin) ||
    (request.method === "POST" && origin !== url.origin) ||
    (fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none")
  ) {
    return pollJson({ error: "forbidden" }, 403);
  }

  try {
    const existingToken = readPollVoterToken(request.headers.get("cookie"));
    let submission = null;
    if (request.method === "POST") {
      submission = await readPollSubmission(request);
      // Establish identity in GET first. Concurrent cookie-less POSTs must not
      // each create a new identity and accidentally count the same retry twice.
      if (!existingToken) return pollJson({ error: "cookie_required" }, 428);
    }

    // D1 requires module Workers; bindings arrive through the request's env.
    // Missing/unavailable D1 only disables the poll; static routes still work.
    const db = env.LANGUAGE_POLL_DB;
    if (!db) return pollUnavailable();

    const voterToken = existingToken || createPollVoterToken();
    const voterHash = await hashPollVoterToken(voterToken);
    const snapshotStatement = db
      .prepare(LANGUAGE_POLL_SNAPSHOT_SQL)
      .bind(LANGUAGE_POLL_ID, voterHash);
    // Read before requiring a new challenge: a retry after a lost success
    // response must recover the recorded choice even if the token is spent or
    // the verification service is temporarily unavailable.
    let result = await snapshotStatement.all();
    let snapshot = languagePollSnapshot(result, env);

    if (request.method === "POST" && !snapshot.alreadyVoted) {
      await protectNewPollVote(request, env, submission.turnstileToken);
      // The primary key is the authority for deduplication, including across
      // Worker instances. D1 batch is transactional; read the result with the
      // insert so concurrent retries cannot overcount or report a changed vote.
      const batch = await db.batch([
        db.prepare(`
          INSERT INTO language_poll_votes (poll_id, voter_hash, option_id)
          VALUES (?1, ?2, ?3)
          ON CONFLICT (poll_id, voter_hash) DO NOTHING
        `).bind(LANGUAGE_POLL_ID, voterHash, submission.option),
        snapshotStatement,
      ]);
      if (batch[0]?.success !== true) throw new Error("Poll write failed");
      result = batch[1];
      snapshot = languagePollSnapshot(result, env);
    }

    if (request.method === "POST" && snapshot.selectedOption === null) {
      if (snapshot.alreadyVoted) {
        return pollJson({ error: "already_voted", ...snapshot }, 409);
      }
      throw new Error("Poll write missing from snapshot");
    }

    const headers = {};
    if (!existingToken) {
      headers["set-cookie"] = `${LANGUAGE_POLL_COOKIE}=${voterToken}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`;
    }
    return pollJson(snapshot, 200, headers);
  } catch (error) {
    if (error instanceof PollRequestError) {
      if (error.code === "verification_unavailable") {
        console.error(JSON.stringify({ event: "language_poll_verification_unavailable" }));
      }
      return pollJson({ error: error.code }, error.status,
        error.status === 429 || error.status === 503 ? { "retry-after": "60" } : {});
    }
    // Do not log request headers, cookie identifiers, IPs or database contents.
    console.error(JSON.stringify({ event: "language_poll_unavailable" }));
    return pollUnavailable();
  }
}

class PollRequestError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

async function readPollSubmission(request) {
  const mediaType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new PollRequestError("unsupported_media_type", 415);
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > LANGUAGE_POLL_BODY_LIMIT)) {
    throw new PollRequestError("payload_too_large", 413);
  }
  if (!request.body) throw new PollRequestError("invalid_json", 400);

  const bytes = await readPollBody(request.body, LANGUAGE_POLL_BODY_LIMIT,
    new PollRequestError("payload_too_large", 413));
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new PollRequestError("invalid_json", 400);
  }
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).some(key => key !== "option" && key !== "turnstileToken") ||
    !LANGUAGE_POLL_OPTIONS.includes(value.option)
  ) {
    throw new PollRequestError("invalid_option", 400);
  }
  // Token presence is checked only for a new vote, after cookie recovery.
  return value;
}

async function readPollBody(body, limit, tooLargeError) {
  // Content-Length can be absent or untrusted. Bound both incoming JSON and
  // Siteverify responses while streaming, before parsing either document.
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength === 0) continue;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw tooLargeError;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

function pollTurnstileConfiguration(env) {
  const siteKey = env.TURNSTILE_SITE_KEY;
  return typeof siteKey === "string" && /^[a-zA-Z0-9_-]{1,256}$/.test(siteKey)
    ? { siteKey, action: LANGUAGE_POLL_TURNSTILE_ACTION }
    : null;
}

function validPollSecret(value, minimumLength = 1) {
  return typeof value === "string" && value.length >= minimumLength &&
    value.length <= 2048 && !/\s/.test(value);
}

function validPollHostname(value) {
  return typeof value === "string" && value.length <= 253 &&
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(value);
}

async function protectNewPollVote(request, env, token) {
  if (token === undefined || token === null || token === "" ||
      (typeof token === "string" && token.trim() === "")) {
    throw new PollRequestError("verification_required", 400);
  }
  if (typeof token !== "string" || token.length > LANGUAGE_POLL_TURNSTILE_TOKEN_LIMIT) {
    throw new PollRequestError("verification_failed", 400);
  }

  if (
    !pollTurnstileConfiguration(env) ||
    !validPollSecret(env.TURNSTILE_SECRET_KEY) ||
    !validPollSecret(env.POLL_IP_HMAC_KEY, 32) ||
    !validPollHostname(env.TURNSTILE_EXPECTED_HOSTNAME) ||
    typeof env.POLL_RATE_LIMITER?.limit !== "function"
  ) {
    throw new PollRequestError("verification_unavailable", 503);
  }

  // Only Cloudflare's connecting address is trusted. Do not accept alternate
  // forwarded headers or CF-Connecting-IPv6 without a verified zone policy.
  const bucket = pollIpBucket(request.headers.get("cf-connecting-ip"));
  if (bucket === null) throw new PollRequestError("verification_unavailable", 503);

  let outcome;
  try {
    const key = await pollIpRateKey(bucket, env.POLL_IP_HMAC_KEY);
    outcome = await env.POLL_RATE_LIMITER.limit({ key });
  } catch {
    throw new PollRequestError("verification_unavailable", 503);
  }
  if (!outcome || typeof outcome.success !== "boolean") {
    throw new PollRequestError("verification_unavailable", 503);
  }
  if (outcome.success !== true) throw new PollRequestError("rate_limited", 429);
  await verifyPollTurnstile(token, env);
}

function pollIpv4(address) {
  if (!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(address)) return null;
  const octets = address.split(".").map(Number);
  return octets.every(octet => octet <= 255) ? octets : null;
}

function pollIpBucket(address) {
  if (typeof address !== "string" || address.length > 45 || !/^[0-9a-fA-F:.]+$/.test(address)) {
    return null;
  }
  if (!address.includes(":")) {
    const octets = pollIpv4(address);
    return octets ? `ipv4:${octets.join(".")}` : null;
  }

  // Expand an embedded IPv4 tail before parsing IPv6 words. This makes dotted
  // and hexadecimal IPv4-mapped spellings share the ordinary IPv4 bucket.
  if (address.includes(".")) {
    const tail = address.lastIndexOf(":") + 1;
    const octets = pollIpv4(address.slice(tail));
    if (!octets) return null;
    address = `${address.slice(0, tail)}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] === "" ? [] : halves[0].split(":");
  const right = halves.length === 1 || halves[1] === "" ? [] : halves[1].split(":");
  if ([...left, ...right].some(word => !/^[0-9a-fA-F]{1,4}$/.test(word))) return null;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const words = [...left, ...Array(missing).fill("0"), ...right].map(word => parseInt(word, 16));
  if (words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff) {
    return `ipv4:${[words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255].join(".")}`;
  }
  // Native IPv6 privacy addresses rotate within a /64. Only the canonical
  // network prefix contributes to the soft limiter, never the voter identity.
  return `ipv6:${words.slice(0, 4).map(word => word.toString(16).padStart(4, "0")).join(":")}::/64`;
}

async function pollIpRateKey(bucket, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const input = encoder.encode(`language-poll-ip-v1:${LANGUAGE_POLL_ID}:${bucket}`);
  return bytesToHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, input)));
}

async function verifyPollTurnstile(token, env) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LANGUAGE_POLL_SITEVERIFY_TIMEOUT);
  try {
    const response = await fetch(LANGUAGE_POLL_SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token }),
      signal: controller.signal,
      // Workers supports only follow/manual; reject 3xx through the status
      // check below instead of forwarding the secret to a redirect target.
      redirect: "manual",
    });
    if (!response.ok || !response.body) throw new Error("Siteverify unavailable");
    const bytes = await readPollBody(response.body, LANGUAGE_POLL_SITEVERIFY_BODY_LIMIT,
      new PollRequestError("verification_unavailable", 503));
    const result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!result || typeof result !== "object" || Array.isArray(result) ||
        typeof result.success !== "boolean") {
      throw new Error("Invalid Siteverify response");
    }
    if (result.success !== true) {
      const codes = result["error-codes"];
      if (!Array.isArray(codes) || codes.length === 0 ||
          codes.some(code => !["missing-input-response", "invalid-input-response", "timeout-or-duplicate"].includes(code))) {
        throw new Error("Siteverify unavailable");
      }
      throw new PollRequestError("verification_failed", 403);
    }
    if (typeof result.hostname !== "string" || typeof result.action !== "string") {
      throw new Error("Invalid Siteverify response");
    }
    if (result.hostname !== env.TURNSTILE_EXPECTED_HOSTNAME || result.action !== LANGUAGE_POLL_TURNSTILE_ACTION) {
      throw new PollRequestError("verification_failed", 403);
    }
  } catch (error) {
    if (error instanceof PollRequestError) throw error;
    throw new PollRequestError("verification_unavailable", 503);
  } finally {
    clearTimeout(timeout);
  }
}

function readPollVoterToken(cookieHeader) {
  if (!cookieHeader) return null;
  const matching = cookieHeader.split(";")
    .map(part => part.trim())
    .filter(part => part.startsWith(`${LANGUAGE_POLL_COOKIE}=`));
  if (matching.length !== 1) return null;
  const token = matching[0].slice(LANGUAGE_POLL_COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}

function createPollVoterToken() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

async function hashPollVoterToken(token) {
  // Persist a poll-specific hash, not the cookie itself. This is an anonymous
  // browser identifier, not authentication or a claim of one vote per person.
  const input = new TextEncoder().encode(`${LANGUAGE_POLL_ID}:${token}`);
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", input)));
}

function bytesToHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function languagePollSnapshot(result, env) {
  if (result?.success !== true || !Array.isArray(result.results)) {
    throw new Error("Poll read failed");
  }
  const counts = new Map();
  let selectedOption = null;
  for (const row of result.results) {
    if (
      (!LANGUAGE_POLL_OPTIONS.includes(row.option_id) && !LANGUAGE_POLL_RETIRED_OPTIONS.includes(row.option_id)) ||
      counts.has(row.option_id) ||
      !Number.isSafeInteger(row.votes) || row.votes < 1 ||
      (row.selected !== 0 && row.selected !== 1) ||
      (row.selected === 1 && selectedOption !== null)
    ) {
      throw new Error("Invalid poll snapshot");
    }
    counts.set(row.option_id, row.votes);
    if (row.selected === 1) selectedOption = row.option_id;
  }
  const options = LANGUAGE_POLL_OPTIONS.map(id => ({ id, votes: counts.get(id) || 0 }));
  const totalVotes = options.reduce((sum, entry) => sum + entry.votes, 0);
  if (!Number.isSafeInteger(totalVotes)) throw new Error("Invalid poll total");
  return {
    pollId: LANGUAGE_POLL_ID, options, totalVotes,
    selectedOption: LANGUAGE_POLL_OPTIONS.includes(selectedOption) ? selectedOption : null,
    alreadyVoted: selectedOption !== null,
    turnstile: pollTurnstileConfiguration(env),
  };
}

function pollUnavailable() {
  return pollJson({ error: "unavailable" }, 503, { "retry-after": "60" });
}

function pollJson(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      "cdn-cache-control": "no-store",
      "cloudflare-cdn-cache-control": "no-store",
      vary: "Cookie, Origin",
      "cross-origin-resource-policy": "same-origin",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex",
      ...extraHeaders,
    },
  });
}

function normalizePath(pathname) {
  if (!pathname || pathname === "") return "/";
  return pathname.replace(/\/{2,}/g, "/");
}

function resolveStaticPath(path) {
  if (STATIC_ROUTES[path]) return STATIC_ROUTES[path];
  if (path.includes("..")) return null;

  if (ASSET_PREFIXES.some(prefix => path.startsWith(prefix))) {
    return path.slice(1);
  }

  return null;
}

function localeSlugFromPath(path) {
  const match = path.match(/^\/([a-z]{2}(?:-[a-z]{2})?)(?:\/|\/index\.html)?$/);
  if (!match || !LOCALE_SLUGS.has(match[1])) return null;
  return match[1];
}

function readLocalePreference(cookieHeader) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name !== LOCALE_COOKIE) continue;
    const locale = valueParts.join("=").toLowerCase();
    return LOCALE_SLUGS.has(locale) ? locale : null;
  }
  return null;
}

function localeFromAcceptLanguage(header) {
  if (!header) return null;

  const ranges = header
    .split(",")
    .map((entry, index) => {
      const [rawRange, ...parameters] = entry.trim().split(";");
      let quality = 1;
      for (const parameter of parameters) {
        const match = parameter.trim().match(/^q=([0-9.]+)$/i);
        if (!match) continue;
        quality = Number(match[1]);
      }
      return {
        range: rawRange.toLowerCase().replaceAll("_", "-"),
        quality,
        index,
      };
    })
    .filter(
      ({ range, quality }) =>
        range && range !== "*" && Number.isFinite(quality) && quality > 0 && quality <= 1,
    )
    .sort((left, right) => right.quality - left.quality || left.index - right.index);

  for (const { range } of ranges) {
    const locale = localeFromLanguageTag(range);
    if (locale) return locale;
  }
  return null;
}

function localeFromLanguageTag(tag) {
  const primary = tag.split("-")[0];
  if (LOCALE_SLUGS.has(primary)) return primary;
  if (primary === "pt") return "pt-br";
  if (primary !== "zh") return null;
  if (/^zh-(?:tw|hk|mo|hant)(?:-|$)/.test(tag)) return null;
  return "zh-cn";
}

function localeFromCountry(country) {
  if (!country) return null;
  return COUNTRY_LOCALES[String(country).toUpperCase()] || null;
}

function redirectToLocale(url, locale, remember) {
  const location = `${url.origin}/${locale}/`;
  const headers = {
    location,
    "cache-control": "private, no-store",
    vary: "Cookie, Accept-Language",
  };
  if (remember) {
    headers["set-cookie"] = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
  }
  return new Response(null, { status: 302, headers });
}

async function serveStatic(staticPath, method, extraHeaders = {}) {
  const cacheTtl = cacheTtlFor(staticPath);
  const cacheBypass = cacheTtl <= 60 ? `&t=${Date.now()}` : "";
  const upstreamUrl = `${STATIC_BASE}/${staticPath}?v=${STATIC_REV}${cacheBypass}`;
  const fetchOptions = { headers: { "user-agent": "nfg-amatic-site-worker" } };
  if (cacheTtl > 60) fetchOptions.cf = { cacheEverything: true, cacheTtl };
  const upstreamResponse = await fetch(upstreamUrl, fetchOptions);

  if (!upstreamResponse.ok) {
    return new Response("Not found", {
      status: 404,
      headers: responseHeaders("text/plain; charset=utf-8", 60),
    });
  }

  return new Response(method === "HEAD" ? null : upstreamResponse.body, {
    status: 200,
    headers: {
      ...responseHeaders(contentTypeFor(staticPath), cacheTtl),
      ...extraHeaders,
    },
  });
}

function json(value) {
  return new Response(JSON.stringify(value), {
    headers: responseHeaders("application/json; charset=utf-8", 60),
  });
}

function responseHeaders(contentType, cacheTtl) {
  return {
    "content-type": contentType,
    "cache-control": cacheTtl > 60 ? `public, max-age=${cacheTtl}` : "no-cache",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
  };
}

function cacheTtlFor(path) {
  if (
    path.endsWith(".html") ||
    path === "robots.txt" ||
    path === "sitemap.xml" ||
    path === "llms.txt"
  ) {
    return 0;
  }
  if (path.endsWith(".css") || path.endsWith(".js")) return 0;
  return 86400;
}

function contentTypeFor(path) {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (path.endsWith(".xml")) return "application/xml; charset=utf-8";
  if (path.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (path.endsWith(".ico")) return "image/x-icon";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}
