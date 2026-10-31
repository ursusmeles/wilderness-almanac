# Wilderness Almanac

**A DM toolbox for sandbox RPG campaigns.**

Generate editable isometric hex maps with forests, mountains, rivers, settlements,
roads and points of interest. Keep multiple campaigns, move a party token,
uncover fog of war, and record notes, dice rolls and oracle answers in the Party
Journal. Low poly is the default art style; Pixelart is optional.

**[Open Wilderness Almanac](https://the.wilderness.al)** · [Releases](https://github.com/ursusmeles/wilderness-almanac/releases) · [Report an issue](https://github.com/ursusmeles/wilderness-almanac/issues)

![Map with the Inspector open](docs/images/wilderness-almanac.jpg)

## Start a campaign

Choose **New campaign**, adjust the seed and world preferences, generate a preview,
and choose **Create campaign**. Most maps have 469 hexes; the reserved `heliotest`
seed provides a seven-hex map. See the [user guide](docs/USER_GUIDE.md) for map
controls, editing, palettes, fog, journals, and sharing.

Campaigns save in IndexedDB in your current browser. Export campaign JSON regularly
for backups or transfers between devices. Share-map links recreate generated maps
without your edits or visited flags. Optional **Account & sync** provides explicit
account save/load on configured self-hosted deployments; local work remains available
offline. See [self-hosting](docs/SELF_HOSTING.md).

Only generator **10** is supported. Older campaigns and unversioned seed links
are rejected rather than regenerated. Old localStorage campaigns are not migrated.
Unsupported IndexedDB records are retained for recovery downloads.

## Run locally

Use Node.js 24 or later (`.nvmrc` selects Node 24):

```sh
git clone https://github.com/ursusmeles/wilderness-almanac.git
cd wilderness-almanac
npm ci
npm run dev
```

Open the address printed in the terminal. Browser-only use needs no backend or API
keys. `npm run build` creates `dist/`; `npm run preview` serves that build locally.

## Contributing

For map issues, include the seed and, where relevant, a screenshot or campaign export.
See the [development guide](docs/DEVELOPMENT.md) for architecture and checks,
[project state](docs/PROJECT_STATE.md) for current capabilities and constraints,
and [AGENTS.md](AGENTS.md) for repository working instructions.

## License and credits

Licensed under the [GNU AGPLv3](LICENSE). Built with [Three.js](https://threejs.org/)
and [Vite](https://vite.dev/). [Geist Sans and Geist Pixel Square](public/fonts/README.md)
use the SIL Open Font License; the [Pixelarticons subset](public/icons/README.md)
uses the MIT License. Map generation draws inspiration from
[Red Blob Games](https://www.redblobgames.com/maps/mapgen4/), with a visual direction
inspired by Thronefall.
