# NFG project index

Local working version of the `nfg-system.online` project index.

The root page is the canonical English project index. Nine additional,
server-rendered locale URLs are published under `ru`, `es`, `de`, `fr`,
`pt-br`, `zh-cn`, `ja`, `ko`, and `tr`; the legacy `/en/` URL redirects to the
root. Each index contains five real projects: Anvil Planner, the Anvil Empires
Russian and Spanish localization packages, Anvil Forge Helper, and NFG Hub.
There are no placeholder rows.

On the first English-root visit, a supported non-English browser language is
offered as a one-click suggestion. The site does not force a language redirect.
An explicit language choice is remembered and takes effect on future root
visits.

Localized copy lives in `content/home.locales.json`. Generated HTML, the sitemap,
and `llms.txt` are committed so that crawlers and users do not depend on
client-side JavaScript.

The NFG Discord invite is kept separate from the project list in the page footer: `https://discord.gg/RNJaFUyeyx`.

## Local preview

Generate or verify the localized pages:

```powershell
node scripts/generate-localized-home.mjs
node scripts/generate-localized-home.mjs --check
```

For an HTTP preview, from the repository root run:

```powershell
python -m http.server 4175 --bind 127.0.0.1
```

Then open `http://127.0.0.1:4175/` or a locale such as
`http://127.0.0.1:4175/ru/`.

There is no production runtime dependency. The published pages are plain
semantic HTML and CSS; Node.js is used only to regenerate checked-in files.

## Deployment

- Public site: `https://nfg-system.online/`
- Source branch: `main`

The Cloudflare Worker configuration in `wrangler.toml` and `worker.js` serves
the public site, maps locale URLs to their generated `index.html` files, and
applies an explicitly selected language preference.
