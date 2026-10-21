# Wilderness Almanac

**DM toolbox for sandbox RPG campaigns.**

Build a world, find a place worth exploring, and make it your own. Wilderness Almanac creates interactive hex maps with connected forests, mountain ranges, winding rivers, settlements and points of interest—all in a low-poly, isometric style.

**[Open Wilderness Almanac](https://wilderness-almanac.vercel.app)** · [Releases](https://github.com/ursusmeles/wilderness-almanac/releases) · [Report a bug or suggest a feature](https://github.com/ursusmeles/wilderness-almanac/issues)

![Wilderness Almanac map with the Hex Inspector open](docs/images/wilderness-almanac.jpg)

## Your next unexplored world

- **Generate a campaign.** Each seed creates a named map of 469 hexes across six regions, with villages, towns, cities, ruins, dungeons and other places to discover.
- **Shape the map.** Use the Hex Inspector to change terrain, elevation, settlements and points of interest. Regenerate a single hex, lock its dressing, mark it visited, or undo an edit.
- **Set the atmosphere.** Choose from nine palettes or make your own from three colours. The palette system keeps surfaces, water and props readable while preserving deep shadows and saturated accents.
- **Keep several adventures.** Name your campaigns, choose their tile icons and return to them from the campaign library.
- **Explore on desktop or mobile.** Pan and zoom, fold away the tool panels, or expand the map to fill the browser viewport. Trees, reeds and water have optional ambient motion.

Opening a campaign prepares up to eight tile icons: four settlements and four points of interest. Refresh cycles through these previews in order. You can also choose any hex with **Set as world icon** in the Hex Inspector. Before previews are ready, the card shows a meadow tile in a fixed dusk-and-ember palette.

Wilderness Almanac is actively developing. The Hex Inspector is functional; the Campaign Tracker panel is a placeholder for future campaign tools.

## Getting started

Open the app and choose **New campaign** to preview a map, choose a palette and name your campaign, then select **Create campaign**. You can also import a previously exported campaign JSON file. Click a hex to inspect and edit it. Drag to pan; use the zoom controls, mouse wheel or **+ / −** keys to look closer.

Open **Palette manager** in the main menu to add palettes, edit their three colours, rename them or choose a default for new campaigns. Bundled palettes stay read-only. Deleting a custom palette keeps existing campaigns’ colours; deleting the default restores Forbidden Lands as the default. Palettes save in this browser alongside your settings.

Turn **Multi edit is ON** above Wind in the palette and settings to edit several hexes together. You can also **Ctrl+click** a map hex to turn multi-edit on, keeping the inspected hex selected and adding the clicked hex. Click or tap hexes to add or remove them, or use **Select all** and **Clear selection** in the Inspector. Choose only the fields you want to change, then apply to the selection. One **Undo** restores the entire batch. Open water removes settlements and POIs; incompatible edits leave the whole batch unapplied. Turn Multi edit off to return to the single-hex Inspector.

Select connected town or city hexes to **Join town** or **Join city**. Villages always occupy one hex each.

**Reset selected**, next to Undo, restores the selected hexes to their generated defaults after confirmation. It clears their edits, visited status and dressing locks. Undo restores the reset hexes.

**Regenerate** changes the map's cosmetic dressing while keeping its geography and locations. **New Map** replaces the world in the current campaign slot. Hexes with locked dressing keep their appearance through map-wide regeneration.

### Saving and sharing

Campaigns save automatically **in your current browser**. There are no accounts or cloud sync. Export campaign JSON to back up your work or move it between computers; clearing browser storage can remove local campaigns.

- **Share map** copies a link with the seed, dressing variant and palette. It recreates the generated map, but does **not** include your hex edits or visited status.
- **Export campaign** downloads the complete campaign replay record, including edits and dressing locks. Import it on another device to continue working.

If campaign saving fails, a persistent warning stays visible and the map offers **Download campaign**. Saved campaigns that this version cannot read are preserved; **Download recovery file** backs up the stored library. Keep recovery files for troubleshooting or a compatible app version; they are separate from individual campaign exports.

Exports are named `wilderness-almanac-[campaignname]-[YYYY-MM-DD].json`. Replay files depend on their generator version; unsupported versions are rejected rather than silently producing a different map.

## Run locally

You need [Node.js](https://nodejs.org/) 24 or later. The repository includes an `.nvmrc` for Node 24.

```sh
git clone https://github.com/ursusmeles/wilderness-almanac.git
cd wilderness-almanac
npm ci
npm run dev
```

Open the address printed in your terminal. No backend, API keys or environment variables are needed. To make a production build, run `npm run build`; `npm run preview` serves it locally.

## Contributing

Bug reports, map examples and feature ideas are welcome in [GitHub Issues](https://github.com/ursusmeles/wilderness-almanac/issues). For map-related reports, include the seed and a screenshot; an exported campaign is helpful when the issue involves edits.

For the code structure, development checks and save format, see the [development guide](docs/DEVELOPMENT.md). [Project state](docs/PROJECT_STATE.md) explains the generation rules, visual constraints and current limits.

## License and credits

Wilderness Almanac is licensed under the [GNU Affero General Public License v3.0](LICENSE).

Built with [Three.js](https://threejs.org/) and [Vite](https://vite.dev/). The interface uses [Geist Sans and Geist Pixel Square](public/fonts/OFL.txt) under the SIL Open Font License, and a small [Pixelarticons](public/icons/README.md) subset under the MIT License. Map generation draws inspiration from [Red Blob Games](https://www.redblobgames.com/maps/mapgen4/), with a visual direction inspired by Thronefall.
