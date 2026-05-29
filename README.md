# NFG A-Matic Website

This repository contains the public website and Cloudflare Worker for NFG A-Matic.

The Player release artifacts are still published from the product repository:

https://github.com/Aneonfas/nfg-amatic-player

## Official links

- Website: https://nfg-system.online/
- Recommended installer: https://nfg-system.online/download
- Portable ZIP: https://nfg-system.online/download/portable
- GitHub release: https://github.com/Aneonfas/nfg-amatic-player/releases/tag/player-0.1.5-beta.1
- Package catalog: https://nfg-system.online/packages/
- Support: https://nfg-system.online/support
- Discord support: https://nfg-system.online/discord

## Current beta

- Player: `0.1.5-beta.1`
- Runtime/Core: `0.1.12`
- Platform: Windows x64
- Status: beta, unsigned

## Downloads

Recommended installer:

```text
NFG_A-Matic_Player_Setup_0.1.5-beta.1_win-x64.exe
```

Portable fallback archive:

```text
NFG_A-Matic_Player_0.1.5-beta.1_win-x64.zip
```

Release assets are hosted on GitHub Releases:

https://github.com/Aneonfas/nfg-amatic-player/releases/tag/player-0.1.5-beta.1

## Verification

- Installer SHA256: `805FBAD32071C82E80D788410AAFE2FCB7EB96CCBDD01B6A3B14DB1EC229EE64`
- Portable ZIP SHA256: `15FF8269068A4735EA3B95377337FF94EF242F393F67D13C57A05F3D829C43E4`

## Packages

Current public package:

- Foxhole Helper `0.5.0`

Planned package:

- Anvil Helper for Anvil Empires - soon, focused on forging and cooking assistance.

The package catalog source lives in:

https://github.com/Aneonfas/nfg-amatic-packages

## Deployment

The website is served by the Cloudflare Worker `polished-poetry-b345` on `nfg-system.online`.

Source:

- `index.html`, `foxhole-clicker/`, `packages/`, `support/` - static pages.
- `assets/` - CSS, JavaScript, brand assets, and public screenshots.
- `worker.js` - lightweight Cloudflare Worker router that serves site files from this repository and redirects downloads to GitHub Releases.
- `wrangler.toml` - deployment metadata for the Worker name and compatibility date.

## Notes

NFG A-Matic Player is currently in beta.

Known limitations:

- No Player auto-updater yet.
- Windows may show SmartScreen or Unknown Publisher warnings because the installer is not Authenticode-signed yet.
- Studio is not publicly distributed yet.
