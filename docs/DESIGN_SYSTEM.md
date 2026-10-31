# App design foundations

The Wilderness Almanac app consumes the portable CSS foundations established in the separate `wilderness-landing` repository. Its canonical sources are `src/styles/colors.css` and the general declarations in `src/styles/tokens.css` there. The app keeps local copies, with source comments, so builds require only this repository. Changes to shared foundations should be reconciled with the landing sources deliberately; there is no runtime or package dependency between the projects.

## Ownership and application

- `src/styles/colors.css` holds the shared OKLCH brand anchors, derived palette and light/dark semantic roles. Dialogs and the shared tooltip re-establish these roles even inside a campaign.
- `src/styles/tokens.css` contains portable spacing, type, font, radius, border, shadow, duration and stacking foundations. Website layouts, heading selectors and component defaults are excluded.
- `src/styles/app-tokens.css` holds the approved app adaptations. Use role tokens rather than adding component-specific font sizes or parallel scales.
- `src/styles.css` preserves the existing CUBE layer order and consumes these foundations for app structure and states. Semantic heading level does not determine interface title size.

The shared fluid spacing replaces the old fixed names: 4/8/12/16/24/32px correspond to `--space-3xs`, `--space-2xs`, `--space-xs`, `--space-s`, `--space-m` and `--space-l`. These are contextual mappings, not fixed pixel aliases. Use larger steps or pairs only where the layout calls for them. Icons, touch targets, panel bounds, resize interaction thresholds and stable map viewport rules retain independent dimensions. The app’s `--panel-margin` uses shared `--space-3xs-2xs` (4–8px), setting both desktop viewport margins and gaps between panels. Mobile edges remain flush.

Approved app type roles stay at 0.75/0.875/1/1.25/1.5rem (12/14/16/20/24px with a default root). Controls and compact headings use shared 1.25 leading; reading text uses the app's 1.5 leading. Geist Sans and Geist Pixel Square retain their existing local files and licenses. The wordmark retains its optical proportions, tracking and line spacing.

Controls, cards, panels and dialogs use the shared medium radius (2px), including controls that are square on the website. Deliberate round indicators, hex shapes and thumbnail corners retain their roles. Thin/thick borders, focus, shadows, disabled opacity and animation timing use shared tokens. Button pressing retains the app's 0.95 scale. Stacking tokens apply within existing isolated contexts; native dialogs and tooltip popovers keep their browser top-layer behaviour.

## UI schemes and map independence

Dark is the default, independent of system appearance. A small head script restores `wilderness-theme` before the stylesheet and application initialise. `src/ui/theme.js` synchronises the library toggle, global App theme radios in both Settings contexts, browser theme colour, storage events and restored pages. Storage restrictions leave manual switching usable in memory. The app-wide preference belongs to this origin; the landing page's identically named key is stored separately on its own origin.

Library, dialogs and tooltips use shared brand colours. The map's default palette no longer recolours the library. The workspace uses `campaignUITheme(seeds, scheme)` from `src/ui/campaign-theme.js`: dark retains the previous background/text/muted/border and panel-chroma calculations; light derives pale surfaces and dark text from the campaign seeds, using 24% of the ground seed’s chroma at 0.96 OKLCH lightness for a restrained but visible tint. Accent, focus and functional error colours retain the shared brand roles. The controller refreshes UI colour roles when the palette or UI scheme changes.

The renderer still consumes the unchanged `paletteTheme` material function. Light mode supplies an explicit pale scene backdrop; dark mode restores the renderer’s existing palette-derived backdrop. Time of day and material colours stay independent. The map’s ground-shadow catcher sits just below tile bases at y=0 to retain contact at low sun angles. The offscreen preview renderer hides this catcher while retaining shadows from props onto the tile, and uses alpha, so tile icons, party portraits and Find party miniatures inherit their themed CSS surface without rerendering on theme changes. Inspector previews and campaign thumbnails fit actual geometry, including tall props. Campaign images anchor their enlargement and cover cropping at the top, allowing the base to crop before the treetops. The baked fallback is regenerated from `tools/render-default-icon.mjs` with a transparent canvas. Thumbnail cache version 19 rejects old opaque or shadowed/cropped cached images, including stale-image reuse. No import/export, IndexedDB or account schema change is required.

## Campaign settings

The fixed appearance bar contains the palette picker, Time and a right-aligned Appearance action using the 16px swatches icon. Mobile and narrow map containers show its icon only. The map’s hex/party dropdown ends at the Time button’s right edge; the workspace controller follows map and Time-button resizing, including changing Time labels. Expanded mobile maps use the available width when the appearance bar is hidden. There is no expandable appearance layout or palette-naming prompt in the workspace.

`ui/settings.js` reuses one dialog for library defaults and campaign settings, with contextual labels. Both contexts put App theme first without helper copy, then a divider, map art style, animation, time of day, time increment, palette and top panel. A final divider separates the bottom action: Regenerate map in campaign mode or Import campaign in library mode. Ordinary choices are staged until Save. Cancel, Escape and backdrop dismissal discard the draft. Regeneration is an immediate separate action and remains disabled under fog. Both Settings and Palette manager live outside hidden menu/workspace ancestors so native modals work from either view.

Palette, time of day and art style are applied together through `campaign-session.appearance`, preserving geography, edits and Undo history. Motion, time increment and panel order are validated under `campaignSettings[id]` in the existing browser-local UI preferences. Unset campaign choices inherit library defaults. Resizing and panel order remain independent for other campaigns. The theme is global under `wilderness-theme`; legacy per-campaign theme entries are ignored. Theme-only saves create no campaign UI overrides, and changing UI choices alone does not write campaign content.

Built-in swatches are native colour inputs. A committed colour change creates a named custom copy while preserving the source; opening/cancelling creates none. Library mode retains custom-palette editing and default selection. Campaign mode uses **Use palette**, forks edits to existing presets, and permits rename/delete only for copies created in that manager session, keeping other library defaults intact. Palette edits save immediately; choosing a campaign palette is staged until the campaign Settings Save.

Pixelart’s resource warning uses the shared tooltip on the option in Settings and New campaign, with a visually hidden description retained for assistive technology.

The app and landing theme controls use the pinned Pixelarticons lightbulb for the light-mode action and moon for dark mode, at the 16px Settings icon size.

## Visual review and verification

The review gallery covers the library, campaign Appearance, palette manager, Inspector and Party Journal in light/dark at desktop/mobile widths, including long text and control states. It provides representative views for artistic feedback on the shared foundations and campaign controls.

Focused checks cover contrast for bundled and extreme custom palettes, preservation of dark UI colours, preference restoration and restricted storage, cross-tab controls, and campaign isolation, transparent previews, backdrop changes, staged cancellation and fog-safe regeneration. Browser inspection covers overflow, map clearance, panel scrolling and native layering. Emulated mobile checks do not establish physical-device touch behaviour.
