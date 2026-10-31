# Browser storage

IndexedDB is the browser's working store. Local saving needs no account; optional
account copies use explicit save/load. See [self-hosting](SELF_HOSTING.md) for the
remote API and [user guide](USER_GUIDE.md) for backup controls.

## Schema and startup

The database is `wilderness-almanac:campaigns`, version 1, with five stores:

| Store       | Key                | Contents                                                                                     |
| ----------- | ------------------ | -------------------------------------------------------------------------------------------- |
| `campaigns` | Campaign ID        | Current replay record and revision                                                           |
| `journal`   | `[campaignId, id]` | Individual journal entries; indexed by campaign                                              |
| `palettes`  | Palette ID         | Custom palettes and revisions                                                                |
| `settings`  | Setting ID         | Library order, palette defaults, active campaign, revision clock and account acknowledgments |
| `recovery`  | Recovery ID        | Deleted campaign for Undo and any existing preserved raw records                             |

Creating a database initializes empty library/palette metadata in the schema-creation
transaction. Simultaneous starts share that initialization. Existing databases are
read and validated; missing or malformed primary metadata does not initialize over
existing data. Existing migration markers and archived source rows are left intact,
but startup no longer depends on them.

Historical localStorage campaigns and palette/settings payloads are neither read,
imported nor deleted. Current localStorage keys hold noncritical UI preferences
and theme only. Existing database namespace discovery remains: a unique previous
`:campaigns` database can be reused; ambiguous candidates block writes.

## Transactions and conflicts

Each campaign's party, visits, edits and journal changes commit together. Journal
bodies are stored separately from the replay row. Campaign/palette changes may
share one transaction; aborted writes leave the committed snapshot intact.
Unchanged records and journal entries are not rewritten. Saves coalesce into at
most one in-flight and one pending full snapshot.

Revisions are checked inside the write transaction. Stale changes fail instead of
overwriting another tab; independent campaigns can still save. Deleted-campaign
recovery retains a revision tombstone so a delete/restore cycle cannot bypass a
stale writer's check. Unknown local fields survive updates and deletion Undo.
The active campaign must belong to the live library.

The browser library retains one current state per campaign, plus one deleted
campaign for Undo. Existing recovery archives remain preserved. Browser quota is
independent of the 16 MB campaign transfer limit; there is no claimed fixed local
campaign capacity. Persistence permission is requested asynchronously where
supported, and refusal does not disable ordinary saves.

## Unsupported or damaged data

Only generator **10** campaigns are readable. Older and future generator records
remain in IndexedDB and library membership while supported campaigns remain usable.
Recovery downloads include the raw unsupported records. Missing or malformed
primary metadata blocks writes rather than treating the database as empty.

Quota, unavailable storage, transaction aborts and tab conflicts retain live edits.
Persistent warnings expose retry and download controls. A version-change event
closes the database and blocks subsequent writes until reload. Startup cannot
promise durable saving when IndexedDB is unavailable.

**Download recovery file** contains raw committed database rows.
**Download unsaved data** additionally includes the live campaigns, palettes and
deleted-campaign state. These troubleshooting envelopes are distinct from campaign
imports; automatic recovery-file import is not implemented. Ordinary recovery
access does not remove archived data.

## Transfers and account state

Campaign JSON uses the `wilderness-almanac-campaign` identifier. Supported older
export envelope identifiers/versions still pass the same campaign validation;
they do not enable older generator replay. Version-3 envelopes carry structured
journal entries; campaigns without entries can use version 2. Transfers are bounded
to 16 MB, and journals to 20,000 entries per campaign. Dressing locks, edit versions,
world preferences and art styles remain validated; imported triangle meshes are
not accepted.

Account acknowledgment rows are separate per account/campaign and contain server
revision plus campaign hash. Their own revision checks prevent stale responses
from replacing a newer acknowledgment. Account sessions are never stored here.

## Verification

`npm run test:storage` uses real browser IndexedDB through a source-served Vite
instance. It covers fresh/concurrent startup, reopening, unsupported preservation,
malformed metadata, journal atomicity, rollback/retry, competing tabs, coalescing,
deletion Undo, permission refusal, account acknowledgments, and app download/reload
flows. Install Playwright Chromium first. Emulation does not establish physical
storage durability; regular JSON exports remain the user backup.
