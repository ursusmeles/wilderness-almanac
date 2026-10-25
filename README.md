# Wilderness Almanac

**DM toolbox for sandbox RPG campaigns.**

Build a world, find a place worth exploring, and make it your own. Wilderness Almanac creates interactive hex maps with connected forests, mountain ranges, winding rivers, settlements and points of interest—all in a low-poly, isometric style.

**[Open Wilderness Almanac](https://wilderness-almanac.vercel.app)** · [Releases](https://github.com/ursusmeles/wilderness-almanac/releases) · [Report a bug or suggest a feature](https://github.com/ursusmeles/wilderness-almanac/issues)

![Wilderness Almanac map with the Hex Inspector open](docs/images/wilderness-almanac.jpg)

## Your next unexplored world

- **Generate a campaign.** Each seed creates a named map of 469 hexes across six regions, with villages, towns, cities, ruins, dungeons and other places to discover.
- **Shape the map.** Use the Hex Inspector to change terrain, elevation, settlements, points of interest and road exits. Regenerate a single hex, lock its dressing, mark it visited, or undo an edit.
- **Set the atmosphere.** Choose from nine palettes or make your own from three colours. The palette system keeps surfaces, water and props readable while preserving deep shadows and saturated accents.
- **Keep several adventures.** Name your campaigns, choose their tile icons and return to them from the campaign library.
- **Explore on desktop or mobile.** Pan and zoom, fold away the tool panels, or expand the map to fill the browser viewport. On mobile, both tool panels start closed below the map, with their headers visible on the first screen. Trees, reeds and water have optional ambient motion.

Opening a campaign prepares up to eight tile icons: four settlements and four points of interest. Hover over a campaign icon to show its refresh button, or tap the icon on touchscreens. Refresh cycles through these previews in order. You can also choose any hex with **Use as campaign icon** in the Hex Inspector. Before previews are ready, the card shows a meadow tile in a fixed dusk-and-ember palette.

Wilderness Almanac is actively developing. The Hex Inspector and party marker are functional; the Sandbox tools panel remains empty for future campaign tools.

The party marker starts at the settlement nearest the map centre and saves its position with the campaign. Its starting hex and each placement become visited in the Hex Inspector. Selecting the piece clears hex selection and opens the compact **Party Inspector**. Its editable name defaults to **Adventurers**. Click or tap the portrait to reveal colour and token-shape controls; the person icon cycles Warden, Waystone and Cairn. Metadata shows coordinates, nearby settlements and POIs, visited coverage, and days/sessions (both initially 1). Coverage excludes ocean/lake hexes and includes river-bank hexes. The compass button selects and focuses the party hex; map-pin buttons locate the nearest settlement/POI; the grid button selects all counted land hexes together. Selecting the piece highlights only its base and shows its name in the selection dropdown, where the party is always the first option. Drag and drop the party marker to move it on desktop or mobile, with fog on or off. On mobile, you can also select the party and tap a destination hex to confirm moving there. Cancel keeps the token in place and selects that hex instead. With the party selected, **Q / W / E** move to the three upper neighbours and **A / S / D** to the three lower neighbours. Key labels appear on adjacent hexes while using the keyboard. Movement marks the destination visited and works with fog on or off. Moving leaves the map view in place. **Find party** selects the party and centres the map on it, showing roughly five hexes across.

## Getting started

Open the app and choose **New campaign** to preview a map, adjust open water, elevation, forests and settlements, choose a palette and name your campaign, then select **Create campaign**. Choose **Generate preview** after changing the seed or world preferences, or choose **Keep current map** to restore the preview settings. You can also import a previously exported campaign JSON file. Click a hex to inspect and edit it. Drag to pan, or press an **arrow key** to jump the view two hexes. Use the zoom controls, mouse wheel or **+ / −** keys to look closer.

Open **Palette manager** in the main menu to add palettes, edit their three colours, rename them or choose a default for new campaigns. Choosing a different default also colours the main menu; Forbidden Lands keeps the original menu theme. Bundled palettes stay read-only. Deleting a custom palette keeps existing campaigns’ colours; deleting the default restores Forbidden Lands as the default. **Undo deletion** restores the palette. Palettes save in this browser alongside your settings.

Choose **Turn on multiselect** in the third button row of the Hex Inspector to edit several hexes together. You can also **Ctrl+click** (**Cmd+click on Mac**) a map hex to turn multi-edit on, keeping the inspected hex selected and adding the clicked hex. Once multiselect is on, click or tap hexes to add or remove them; **Ctrl** or **Cmd** clicks work the same way. On mobile, hold an unselected hex to add it to your selection and turn multi-edit on. The coordinate selector toggles hexes while multi-edit is on, and the Inspector offers **Select all** and **Clear selection**. Choose only the fields you want to change, then apply to the selection. One **Undo** restores the entire batch. Open water removes settlements and POIs; incompatible edits leave the whole batch unapplied. Choose **Turn off multiselect** beside Clear selection to return to the single-hex Inspector. Sandbox tools stays closed while multiselect is on; its expand button becomes available again when you turn multiselect off.

Select connected town or city hexes to **Join town** or **Join city**. Villages always occupy one hex each.

**Reset selected**, next to Undo, restores the selected hexes to their generated defaults after confirmation. It clears their edits, visited status and dressing locks. Undo restores the reset hexes.

**Regenerate map**, next to Wind on mobile and above it on desktop in palette and settings, changes the map's cosmetic dressing while keeping its geography and locations. Create a different world through **New campaign** in the main menu. Hexes with locked dressing keep their appearance through map-wide regeneration.

New campaigns include subtle roads connecting settlements, crossings and selected points of interest. Roads favour open terrain, avoid mountains and use existing bridges and ferries. Regenerate changes their shape while keeping their routes. The Hex Inspector lists road exits clockwise as N, NE, SE, S, SW and NW. In **Edit hex**, use the **Road exits** checkboxes to connect neighbouring hexes; unavailable exits explain their terrain restriction. Ordinary terrain with three or more exits is labelled “with crossroads”. Manual roads can extend beyond the generated road budget. Adding a settlement or POI leaves roads unchanged; removing a destination removes its generated links without rerouting other roads. Existing campaigns keep their original maps.

### Fog of War

Turn **Fog of war ON** in the map header (top-right of the map on mobile) to show a player-facing view of your campaign. Visited hexes stay coloured, visible but unvisited hexes turn grayscale, and undiscovered hexes become blank tiles. Hidden hexes show only their coordinates and “Undiscovered hex”. Visited hexes reveal a one-hex radius, increasing to two at elevation 3 and three on mountains/elevation 4. Towns/cities and watchtowers/lighthouses/strongholds each add one, stacking to five for a mountain town with a watchtower. High terrain blocks sight, while open water reveals the first far shore.

Move the party or mark hexes visited to uncover the map. You can also mark visited hexes as unvisited, including in multi-edit; this can hide areas again. Fog remembers its setting per campaign. Turn it off to edit terrain, features or dressing. Undo remains available for visits and party moves.

Fog is for presenting the current screen. Seed links from the campaign list recreate the full map; campaign exports remain complete GM backups, including edits and visited flags.

### Saving and sharing

Short tooltips clarify ambiguous controls and unavailable actions on hover, keyboard focus or tap. On mobile, brief messages on the map confirm actions and report errors.

Use the back arrow beside the map title to return to your campaigns. Seeds, seed copying and map sharing are available in the campaign list.

Campaigns save automatically **in your current browser**. There are no accounts or cloud sync. Export campaign JSON to back up your work or move it between computers; clearing browser storage can remove local campaigns.

- **Share map** in the campaign list copies a link with the seed, world preferences, generator version, dressing variant and palette. It recreates the generated map, but does **not** include your hex edits or visited status.
- **Export campaign** downloads the complete campaign replay record, including edits and dressing locks. Import it on another device to continue working.

If saving fails, a persistent warning offers **Retry saving** and **Download unsaved data**; the map also offers **Download campaign**. Changes from another browser tab can require downloading your work before reloading. Saved data this version cannot read is preserved; **Download recovery file** backs up stored data. Keep recovery files for troubleshooting or a compatible app version; they are separate from individual campaign exports. The app requests persistent browser storage where supported, but regular exports remain your backup.

Exports are named `wilderness-almanac-[campaignname]-[YYYY-MM-DD].json`. Replay files depend on their generator version; unsupported versions are rejected rather than silently producing a different map.

Self-hosted deployments can enable **Account & sync** to sign in with an emailed code and save or load account copies. Work still saves in this browser, including offline. Conflicting edits are kept for you to resolve; **Import as copy** preserves both versions. JSON export/import remains available. See the [self-hosting guide](docs/SELF_HOSTING.md) to enable this option.

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
