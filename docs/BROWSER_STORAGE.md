# Browser storage

`src/persistence/browser-store.js` owns asynchronous browser persistence. It accepts browser APIs as dependencies and exposes validated replay records, status/subscriptions, `save`, `recovery` and `close`. It owns no DOM, renderer or generated-world state. `campaign-session.js` keeps live changes and bounded Undo history when saves fail. The menu and palette manager await commit results before reporting success.

## Schema and bounds

IndexedDB database **`wilderness-almanac:campaigns`**, schema version **1**, contains:

| Store       | Key                | Purpose                                                                                                                                  |
| ----------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `campaigns` | Campaign ID        | One current replay record/revision, including sparse edits, dressing/locks, visits, party, fog, palette and world identity               |
| `palettes`  | Custom palette ID  | Current custom palette/revision                                                                                                          |
| `settings`  | Setting ID         | Campaign ordering/active selection, palette ordering/default, revision clock, migration marker and optional account sync acknowledgments |
| `recovery`  | Recovery ID        | At most two immutable original legacy source strings and one deleted campaign; an empty deletion retains only its revision               |
| `journal`   | `[campaignId, id]` | Reserved for individually addressable future entries, indexed by campaign; currently empty                                               |

Saving replaces current records. There are no per-action campaign snapshots on disk. Deletion Undo retains at most one campaign. The existing 20-entry edit Undo stays in memory, shares unchanged data and resets on campaign entry. Queued saves retain at most one in-flight and one pending set of snapshots; rapid inputs coalesce to the latest pending state. All coalesced callers settle after commit or failure.

`wilderness-almanac:ui-v1` in localStorage allows only motion, settings disclosure, panel order and collapse preferences. Campaigns, replay identity, party, visits, palettes and default selection never go there. Failure to save these noncritical preferences does not claim campaign data was lost. The optional bounded thumbnail database remains independent and disposable.

Future journal features should use separate rows and indexed queries rather than an ever-growing array in campaign records. Campaign deletion already deletes associated journal rows in its transaction; future journal recovery/Undo semantics need an explicit design before using that store. No Sandbox Tools are implemented here.

Optional account sync stores `account-sync:[accountId,campaignId]` settings rows with an acknowledged server revision and SHA-256 hash of the exact validated campaign sent/loaded. These have their own local metadata revisions, checked transactionally to reject competing-tab acknowledgments. They hold no cookies, OTPs, account credentials or duplicate campaign snapshots. They remain after local deletion so Undo/restoring the same local identity cannot accidentally create an unconditional account overwrite. Account and local deletion are separate explicit actions. IndexedDB schema version and campaign export formats remain unchanged. See [SELF_HOSTING.md](SELF_HOSTING.md) for transfer/conflict behavior.

## Transactions and conflicts

`save({ campaigns, deletedCampaign, palettes, activeCampaignId })` validates and captures data before queueing. Supply related campaign/palette changes together. Active campaign identity stays in IndexedDB so imported copies with identical replay settings reopen correctly. Each campaign row includes party placement and its visited destination, or a complete multi-hex edit. Campaign deletion/restoration, ordering and deletion recovery share a transaction. Palette deletion and fallback default selection also commit together.

Only changed campaign rows are written. Revisions are checked **inside** the read/write transaction. Stale writes, deletion of a concurrently edited campaign, and stale palette-library or campaign-membership changes abort the entire transaction. Different existing campaigns can save from separate tabs without replacing each other's data. A monotonic revision clock prevents delete/restore from reusing an old campaign revision. Unchanged records in stale library snapshots are never rewritten.

Conflicts block further writes from that store instance. Download changed campaigns or **Download unsaved data**, then reload and reconcile through imports. Imports create independent campaigns. There is no automatic merge, forced overwrite, tab refresh or automatic account synchronization. Optional account transfers are explicit. Conflict detection occurs on saving.

Only transaction completion means success. A quota error, thrown write, abort or closed database leaves previous committed records intact. Live changes remain exportable. **Retry saving** submits the latest library and palettes. The menu forwards an active campaign ID only while it belongs to the live library, so a retained map session cannot invalidate retries after deletion. Warnings persist through action notices and unrelated successful saves. Pending/unsaved critical writes trigger the browser's ordinary leave-page warning where supported; abrupt process termination can still lose uncommitted changes.

## Migration and recovery

Legacy sources are `wilderness-almanac:campaigns-v1` and `hex-sandbox:map-v1` in localStorage. Migration:

1. Reads sources without treating blocked reads as an empty library. Validates supported campaigns/deletion state and decodes preferences. A pre-library single map becomes a version-6 campaign with stable migration identity. Custom palette IDs/default selection are persisted.
2. Copies usable records, ordering/defaults, deletion state, both original source strings and an unverified marker in one transaction. Unknown local fields remain outside rendering. Unsupported/invalid/duplicate records remain verbatim in the recovery source.
3. Reads back committed data separately and validates campaign/deletion replay data, membership, palettes/default and original strings before marking migration verified.
4. Removes understood legacy keys only if their text still matches the copied source. Malformed/unknown envelopes, unreadable deletion state and partially readable libraries and unreadable palette/settings records stay at their original key as well as in recovery. Original backups never rotate during normal saves.

Retries reuse the marker, never clear/reimport a database and never duplicate campaigns. Interrupted cleanup retries on boot without restoring old values over newer edits. Concurrent migration uses the winning transaction's single-map creation date and palette IDs. Changed legacy sources from an older app/tab block writes; download recovery before reconciling. Failed first migrations retain originals and usable session records; reload to retry. Verified IndexedDB saves stay usable if localStorage later becomes unavailable.

Malformed legacy envelopes/deletion data are read-only. Individually unreadable primary campaign rows remain intact and downloadable while other readable campaigns stay editable. Malformed primary metadata/palettes block writes. Failed reads never permit blind overwrites.

Campaign JSON export/import and the 4 MB validation limit remain unchanged, including generator versions 6/7/8, world preferences, dressing snapshots and locks. **Download recovery file** contains raw committed rows and original legacy sources. **Download unsaved data** additionally includes the live campaign library, deletion state and palettes. These troubleshooting envelopes remain separate from single-campaign imports; automatic recovery-file import is not implemented.

## Browser durability and checks

The adapter checks `navigator.storage.persisted()` and requests `persist()` where available without delaying startup. Denial, unavailable APIs and permission errors leave IndexedDB saving enabled. The menu notes when browser data may be cleared. Permission cannot replace exports or survive explicit site-data clearing. Blocked opens produce a recoverable session and close late connections; version-change events close the connection and ask for downloads/reload. There is no localStorage fallback for critical writes.

Run `npm run test:storage` after installing Playwright Chromium. Its dedicated configuration serves source modules with Vite, testing real IndexedDB without a build or the full renderer suite. It covers migration, unreadable preservation, concurrent startup, read-back validation, interrupted cleanup, rollback/retry, competing tabs, bounded/coalesced writes, deletion Undo, permission refusal and app reload/export/failure recovery.

Related Node checks: `node --test tests/campaign-store.test.js tests/campaigns.test.js tests/campaign-session.test.js tests/save-status.test.js tests/ui-preferences.test.js`. Legacy codec fixtures retain compatibility exports under `ui/`; live application writes use the IndexedDB adapter and UI allowlist. Chromium checks do not establish Safari/Firefox, private browsing, physical disk exhaustion or power-loss behavior.
