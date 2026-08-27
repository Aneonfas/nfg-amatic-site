# NFG project index

Local working version of the `nfg-system.online` project index.

The root URL is a language router. Ten server-rendered canonical locale URLs
are published under `en`, `ru`, `es`, `de`, `fr`, `pt-br`, `zh-cn`, `ja`, `ko`,
and `tr`. Each index contains five real projects: Anvil Planner, the Anvil
Empires Russian and Spanish localization packages, Anvil Forge Helper, and NFG
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
localization should come next. Russian and Spanish are already available, so
the choices are German, French, Brazilian Portuguese, Polish, Italian,
Ukrainian, Turkish, Simplified Chinese, Japanese, Korean and Other. Visitors
can suggest a specific other language through the existing Discord link.

A localized shortcut is visible from the first screen: a fixed side tab on
wide screens and a compact sticky strip below the header on narrow screens.
It links to the same poll, moves keyboard focus to its region, respects reduced
motion, and remains a working anchor without JavaScript. When the poll is in
view, the shortcut hides without shifting the page or hiding keyboard focus.

`GET /api/polls/next-language` returns shared results and this browser's choice.
`POST` to the same endpoint accepts only JSON such as `{"option":"de"}`.
The first GET establishes a random, secure, HttpOnly cookie. D1's primary key
allows one recorded choice per retained cookie; duplicate or retried submissions
preserve the original choice. A failed response is not treated as proof that no
vote was saved: refreshing the poll recovers the server's recorded result.

The database stores only the poll ID, a poll-specific hash of the random cookie,
and the chosen option. It does not store IP addresses, user agents, names,
email addresses, free text or individual vote timestamps. Cookies are shared
across locale paths. This is a lightweight community poll, not authenticated
voting: clearing cookies, another browser/profile or overlapping first-time
cookie-less page loads can create another anonymous identity. There is no
CAPTCHA or per-person/bot guarantee.

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

The published pages are semantic HTML/CSS plus one dependency-free JavaScript
module for the poll. The Worker uses an ES-module handler and a D1 binding;
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
the new schema:

```powershell
npx wrangler d1 migrations apply LANGUAGE_POLL_DB --remote
npx wrangler deploy --keep-vars
```

Deploy the API/asset route before merging the generated poll pages and client
into GitHub `main`, since HTML is served directly from that branch. Verify all
ten locale pages, the JavaScript asset and the read-only API after publication.
Keep production counts free of QA votes. Rollback must preserve the database;
do not drop the table or delete the D1 resource to roll back site code.
