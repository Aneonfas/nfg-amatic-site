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

## Local preview

Generate or verify the localized pages:

```powershell
node scripts/generate-localized-home.mjs
node scripts/generate-localized-home.mjs --check
node --test tests/worker-locale-routing.test.mjs
```

For an HTTP preview, from the repository root run:

```powershell
python -m http.server 4175 --bind 127.0.0.1
```

Then open a locale such as `http://127.0.0.1:4175/en/` or
`http://127.0.0.1:4175/ru/`. The checked-in root HTML is only a static fallback
to `/en/`; Cloudflare performs the production language routing.

There is no production runtime dependency. The published pages are plain
semantic HTML and CSS; Node.js is used only to regenerate checked-in files.

## Deployment

- Public site: `https://nfg-system.online/`
- Source branch: `main`

The Cloudflare Worker configuration in `wrangler.toml` and `worker.js` serves
the public site, maps locale URLs to their generated `index.html` files, and
redirects root visits using the remembered choice, browser language, country
fallback, and English in that order.
