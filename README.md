# NFG project index

Local working version of the `nfg-system.online` project index.

The root URL is a language router. Eleven server-rendered canonical locale URLs
are published under `en`, `ru`, `es`, `de`, `fr`, `it`, `pt-br`, `zh-cn`, `ja`,
`ko`, and `tr`. Each index contains six real projects: Anvil Planner, the Anvil
Empires Russian, Spanish, Turkish and German localization packages, and NFG
Hub. There are no placeholder rows and no standalone language-selection page.

Root visits are redirected with a temporary `302`. An explicit remembered
choice wins, followed by the browser's `Accept-Language`, then Cloudflare's
country signal as a fallback, and finally English. Language-menu links go
directly to their canonical locale URL and remember the user's choice.

Localized copy lives in `content/home.locales.json`. Generated HTML, the sitemap,
and `llms.txt` are committed so that crawlers and users do not depend on
client-side JavaScript.

The NFG Discord invite is kept separate from the project list in the page footer: `https://discord.gg/RNJaFUyeyx`.

## Next localization poll

Every locale includes the same poll at `#language-poll`: which Anvil Empires
localization should come next. Russian, Spanish, Turkish and German are already available, so
the choices are French, Brazilian Portuguese, Italian,
Simplified Chinese, Japanese, Korean and Other. Visitors
can suggest a specific other language through the existing Discord link.

The Italian website is available at `/it/`; an Italian game localization is
still a poll option, not a released package. Polish and Ukrainian were withdrawn
from the poll. Turkish was retired after its 1.0.0 release and German after its 1.0.0-beta.1 release. Any earlier votes for those options stay in D1 but are excluded
from the displayed results and total. Their cookies cannot cast a replacement
vote; the API responds with `already_voted`. Other votes are unchanged.

A localized shortcut is visible from the first screen: a fixed side tab on
wide screens and a compact sticky strip below the header on narrow screens.
It links to the same poll, moves keyboard focus to its region, respects reduced
motion, and remains a working anchor without JavaScript. When the poll is in
view, the shortcut hides without shifting the page or hiding keyboard focus.

`GET /api/polls/next-language` returns shared results and this browser's choice.
`POST` to the same endpoint accepts only JSON such as
`{"option":"fr","turnstileToken":"<fresh widget response>"}`.
The first GET establishes a random, secure, HttpOnly cookie. D1's primary key
allows one recorded choice per retained cookie; duplicate or retried submissions
preserve the original choice. A failed response is not treated as proof that no
vote was saved: refreshing the poll recovers the server's recorded result.

The database stores only the poll ID, a poll-specific hash of the random cookie,
and the chosen option. It does not store IP addresses, user agents, names,
email addresses, free text or individual vote timestamps. Cookies are shared
across locale paths. This is a lightweight community poll, not authenticated
voting: clearing cookies, another browser/profile or overlapping first-time
cookie-less page loads can create another anonymous identity.

New votes also require a Cloudflare Turnstile token and pass a soft IP-based
rate limit. The server verifies the token with Siteverify, including the exact
hostname and poll action. Missing, expired, replayed or invalid tokens never
create a vote. The widget is loaded only when needed and does not require an
account. Results and recovery of an existing vote do not require a challenge.

The initial anti-flood setting is **20 new vote attempts per 60 seconds** per
IP key and Cloudflare location. This is a configurable starting policy, not a
threshold inferred from visitor traffic or a one-vote-per-IP rule. Families,
offices and mobile users can share an address. Cloudflare's limiter is local
and eventually consistent, not a precise global accounting system.
The rate-limit key is a keyed HMAC of the normalized Cloudflare client address
(IPv4) or the native IPv6 `/64` prefix. IPv4-mapped IPv6 is treated as IPv4.
The `/64` grouping reduces simple privacy-address rotation within one subnet;
it is a temporary anti-flood heuristic and can group different people.
The key stays separate from the cookie hash and is used only by the limiter. Raw IPs and
rate-limit keys are not added to the vote table or application logs. HMAC is
pseudonymization, not proof of anonymity; Cloudflare still processes requests.
IP changes and human-assisted abuse can bypass these protections. The poll
does not promise one vote per person.

If Turnstile or the limiter is unavailable or misconfigured, new votes fail
closed while the project pages and existing results stay available. A lost
submission response is recovered with GET before another attempt, because
Turnstile tokens are single-use. Error `429 rate_limited` includes
`Retry-After: 60`; the browser preserves the selected language during the wait.

Poll labels and errors live alongside the page copy in
`content/home.locales.json`; the progressive client is
`assets/language-poll.js`. If JavaScript or the database is unavailable, the
page keeps its project links and explains that voting/results are unavailable.
It never substitutes local or invented vote totals.

## Local preview

Generate or verify the localized pages:

```powershell
node scripts/generate-localized-home.mjs
node scripts/generate-localized-home.mjs --check
node --test
```

For an HTTP preview, from the repository root run:

```powershell
python -m http.server 4175 --bind 127.0.0.1
```

Then open a locale such as `http://127.0.0.1:4175/en/` or
`http://127.0.0.1:4175/ru/`. The checked-in root HTML is only a static fallback
to `/en/`; Cloudflare performs the production language routing.

This static preview has no poll API: voting will show an unavailable state.
To exercise the real Worker and a local D1 database, with Wrangler available:

```powershell
npx wrangler d1 migrations apply LANGUAGE_POLL_DB --local
npx wrangler dev --local --port 4175
```

The Worker preview uses local D1 but preserves the existing static proxy to
GitHub `main`; pending HTML/CSS/client edits still need the static preview or
a local asset server. Do not add test votes to the remote database.

Without the Turnstile and limiter bindings, preview results remain readable but
new submissions are disabled. Automated API tests use an isolated SQLite
database and controlled Siteverify responses, with no production credentials.
For a real local workerd/D1 smoke test, configure local rate-limit bindings and
an outbound Siteverify fixture in the test harness, not a bypass in `worker.js`.
Cloudflare's public dummy keys are suitable for the widget and transport tests;
their response can omit `action` and use a dummy hostname, so they must not be
accepted by weakening the production hostname/action checks.

The published pages use semantic HTML/CSS and a small JavaScript poll module.
New votes additionally load Cloudflare's official Turnstile widget; reading
results does not require it. The Worker uses an ES-module handler and a D1 binding;
Node.js is used for generation and tests, not in production.

## Deployment

- Public site: `https://nfg-system.online/`
- Source branch: `main`

The Cloudflare Worker configuration in `wrangler.toml` and `worker.js` serves
the public site, maps locale URLs to their generated `index.html` files, and
redirects root visits using the remembered choice, browser language, country
fallback, and English in that order.

The poll uses the dedicated D1 database `nfg-site-language-poll`, bound as
`LANGUAGE_POLL_DB`. Apply `migrations/` before deploying a Worker that needs
the new schema. The Turnstile/IP update does not change the schema and needs
no new production migration.

The dedicated managed Turnstile widget permits only `nfg-system.online` and
does not grant pre-clearance. Its public site key and expected hostname are in
`wrangler.toml`. Keep the two server secrets only in Cloudflare secret bindings
(or an ignored local `.dev.vars` for development):

```powershell
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put POLL_IP_HMAC_KEY
```

Use the widget's secret for `TURNSTILE_SECRET_KEY` and a cryptographically random
key of at least 32 bytes for `POLL_IP_HMAC_KEY`. Do not put either in source,
generated HTML, a PR body or shell command arguments. The HMAC key does not
replace the existing cookie identity. Do not rotate it as part of every deploy.
The Worker uses `CF-Connecting-IP`, not user-supplied `X-Forwarded-For` or
`X-Real-IP`. It does not trust a secondary `CF-Connecting-IPv6` header. Review
this integration if the zone enables Pseudo IPv4 overwrite; do not enable
secondary-header handling without verifying the matching Cloudflare setting.

For initial database setup only:

```powershell
npx wrangler d1 migrations apply LANGUAGE_POLL_DB --remote
```

Before publishing a change, run the tests and a dry run. Preserve existing
secrets and bind the limiter when deploying:

```powershell
npx wrangler deploy --dry-run
npx wrangler deploy --keep-vars
```

Integration references: [Turnstile server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
and [Workers rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

Keep the API and the generated poll pages/client in sync when changing choices.
Push the tested commit, temporarily deploy the Worker with `STATIC_BASE` pinned
to that exact commit, and verify all eleven locale pages, the JavaScript asset
and the read-only API. Then merge into `main`, verify its files match, and deploy
the checked-in Worker again to restore the normal `main` source. Already-open
pages may need a reload across the update; the source pin does not make a whole
multi-request page load atomic.
Keep production counts free of QA votes. Rollback must preserve the database;
do not drop the table or delete the D1 resource to roll back site code.
