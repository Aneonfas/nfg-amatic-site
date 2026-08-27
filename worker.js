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
  "de", "fr", "pt-br", "pl", "it", "uk", "tr", "zh-cn", "ja", "ko", "other",
];
const LANGUAGE_POLL_COOKIE = "__Host-nfg_language_poll";
const LANGUAGE_POLL_BODY_LIMIT = 256;
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
    let option = null;
    if (request.method === "POST") {
      option = await readPollOption(request);
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
    let result;

    if (request.method === "POST") {
      // The primary key is the authority for deduplication, including across
      // Worker instances. D1 batch is transactional; read the result with the
      // insert so concurrent retries cannot overcount or report a changed vote.
      const batch = await db.batch([
        db.prepare(`
          INSERT INTO language_poll_votes (poll_id, voter_hash, option_id)
          VALUES (?1, ?2, ?3)
          ON CONFLICT (poll_id, voter_hash) DO NOTHING
        `).bind(LANGUAGE_POLL_ID, voterHash, option),
        snapshotStatement,
      ]);
      if (batch[0]?.success !== true) throw new Error("Poll write failed");
      result = batch[1];
    } else {
      // No Sessions API: D1 serves these reads from the primary, including the
      // first GET after a vote. A GET never creates a database row.
      result = await snapshotStatement.all();
    }

    const snapshot = languagePollSnapshot(result);
    if (request.method === "POST" && snapshot.selectedOption === null) {
      throw new Error("Poll write missing from snapshot");
    }

    const headers = {};
    if (!existingToken) {
      headers["set-cookie"] = `${LANGUAGE_POLL_COOKIE}=${voterToken}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`;
    }
    return pollJson(snapshot, 200, headers);
  } catch (error) {
    if (error instanceof PollRequestError) {
      return pollJson({ error: error.code }, error.status);
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

async function readPollOption(request) {
  const mediaType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new PollRequestError("unsupported_media_type", 415);
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > LANGUAGE_POLL_BODY_LIMIT)) {
    throw new PollRequestError("payload_too_large", 413);
  }
  if (!request.body) throw new PollRequestError("invalid_json", 400);

  // Content-Length can be absent or untrusted. Bound bytes while streaming,
  // rather than buffering an arbitrary request with request.json()/text().
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength === 0) continue;
      size += value.byteLength;
      if (size > LANGUAGE_POLL_BODY_LIMIT) {
        await reader.cancel();
        throw new PollRequestError("payload_too_large", 413);
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

  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new PollRequestError("invalid_json", 400);
  }
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).length !== 1 || !LANGUAGE_POLL_OPTIONS.includes(value.option)
  ) {
    throw new PollRequestError("invalid_option", 400);
  }
  return value.option;
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

function languagePollSnapshot(result) {
  if (result?.success !== true || !Array.isArray(result.results)) {
    throw new Error("Poll read failed");
  }
  const counts = new Map();
  let selectedOption = null;
  for (const row of result.results) {
    if (
      !LANGUAGE_POLL_OPTIONS.includes(row.option_id) || counts.has(row.option_id) ||
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
  return { pollId: LANGUAGE_POLL_ID, options, totalVotes, selectedOption };
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
