# NFG project index

Local working version of the `nfg-system.online` homepage.

The current page contains two real projects: Anvil Planner and the Anvil Empires Russian translation. There are no placeholder rows. The older A-Matic pages remain in the repository for now, but the new homepage does not link to them.

The NFG Discord invite is kept separate from the project list in the page footer: `https://discord.gg/RNJaFUyeyx`.

## Local preview

For a quick preview, open `index.html` directly in a browser. All homepage assets use relative paths, so the `file://` version is supported.

For an HTTP preview, from the repository root run:

```powershell
python -m http.server 4175 --bind 127.0.0.1
```

Then open `http://127.0.0.1:4175/`.

There is no build step and no runtime dependency. The page is plain semantic HTML and CSS.

## Deployment

- Public site: `https://nfg-system.online/`
- Source branch: `main`

The Cloudflare Worker configuration in `wrangler.toml` and `worker.js` serves the public site.
