---
name: verify-twa
description: Verify Wilderness Almanac changes with focused tests and real browser paths. Use when editing or validating this repository; keep cosmetic edits quick and select checks by what could break.
---

# Verify Wilderness Almanac

Work from the repository root. Follow `AGENTS.md` for change scope and review
limits; consult `docs/DEVELOPMENT.md` for setup. Use the smallest recipe below
that exercises the changed behaviour, rather than running every recipe.

## Select the check

| Changed area                            | Starting point                                                                                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Spacing, colour, copy                   | Review the diff and inspect the affected UI where useful. Shared layout changes also need a narrow-screen inspection. No new tests, build, suite or independent review just for a cosmetic edit. |
| Journal commands or state               | `node --test tests/party-journal.test.js tests/campaign-session.test.js`; add the focused journal browser recipe below when the interaction changes.                                             |
| Campaign edits, validation or Undo      | Select from `tests/campaign-session.test.js` and `tests/campaigns.test.js`; browser proof should edit, check Undo/reapply where relevant, save, then reload.                                     |
| Generation or preferences               | Select from `tests/generation.test.js`, `tests/world.test.js`, `tests/world-preferences.test.js`. Preserve generator-10 hashes; never refresh fixtures just to hide a failure.                   |
| Meshes, materials or resource ownership | Start with `node --test tests/rendering.test.js`; inspect the changed visual behaviour when needed. Renderer fixtures alone do not establish WebGL lifecycle or visual correctness.              |
| Persistence or recovery                 | Select a scenario from `e2e/storage.spec.js`, e.g. `npm run test:storage -- --project=desktop --grep 'journal rows commit' --retries=0 --global-timeout=90000` for journal transactions.         |
| Account transfer                        | Start with `tests/campaign-sync.test.js`; `npm run test:account -- --grep 'email sign-in' --retries=0 --global-timeout=90000` mocks HTTP and does not prove a deployed backend.                  |
| Tooling or review configuration         | Run the changed command or validate the configuration; for ESLint boundaries use `node --test tests/architecture.test.js`. No app build for documentation/configuration alone.                   |

For changed JavaScript use `npx --no-install eslint PATHS --max-warnings=0`;
for formatting use `npx --no-install prettier --check PATHS`. Supply actual changed
paths, not the entire working tree by default. An explicit request such as
"push, no tests" overrides these defaults.

## Browser setup and health check

Prefer the existing source-served harness, which creates isolated Playwright
contexts and needs no production build. `playwright.workspace.config.js` serves
this checkout at `http://127.0.0.1:4180` and deliberately refuses to reuse another
server. It covers journal, panel and workspace-control specs only.

Before the first browser run, check local dependencies and the installed browser:

```sh
node --input-type=module -e 'import { existsSync } from "node:fs"; import { chromium } from "@playwright/test"; if (!existsSync(chromium.executablePath())) throw new Error("Chromium missing: run npx playwright install chromium"); console.log("Chromium available")'
```

If port 4180 is occupied, identify its owner and use an appropriate existing
instance for manual inspection, or report the collision. Do not kill an unrelated
server, change production settings, or repeatedly restart the harness.

## Focused journal proof

```sh
npm run test:workspace -- e2e/party-journal.spec.js --grep 'oracle entries show a single result badge' --project=desktop --retries=0 --global-timeout=90000
```

This real UI path opens the seven-hex `heliotest` world, selects the party,
submits oracle commands, checks results and copy/reroll actions, then reloads and
checks the saved results. The test controls randomness in its isolated page;
campaign saving still uses the real IndexedDB path. A passing component-only
`journal-pagination.spec.js` does not replace this persistence proof.

The test saves `oracle-results.png` under `test-results/workspace/`; failure traces
and screenshots use that directory too. Keep relevant artifacts and the actual
pass/fail output available for review. A screenshot alone does not prove reload
persistence; use the test assertions or directly repeat the save/reload path.

For a different workspace interaction, select one existing spec/test title with
`--grep` and the appropriate `--project`. Read that test before using it as proof.
Do not claim unrun scenarios were covered. Add a focused regression test only
when a meaningful changed behaviour has no existing coverage.

## Manual visual inspection

When a small visual edit needs inspection, start the following in a managed shell
session. Confirm startup in that session and check that `/src/main.js` responds.
Use a fresh browser context, not the user's saved campaign profile.

```sh
npm run dev -- --host 127.0.0.1 --port 4180 --strictPort
```

- Library: `/`.
- Small map: `/?seed=heliotest&generator=10`; wait for
  `#campaign-workspace[data-hex-count="7"]`.
- Party journal: activate `#hp-find-party`, enter text in `#hp-journal-input`,
  and submit with `#hp-journal-add`; results are in `#hp-journal-entries`.
- On mobile, panels start collapsed below the map. Expand the relevant tools
  before interacting; preserve the viewport-height map and check overflow.
- For shared layout changes, inspect the affected desktop view and a relevant
  narrow viewport such as 390 by 844. Emulation is not physical-phone evidence.

Check the requested visual result and affected focus/visibility states; capture
before/after screenshots when they help review. A production-only issue can use
one build and a selected `test:e2e` scenario, but ordinary spacing edits do not
need the production harness.

## Stop and report

Stop after the relevant checks pass. Do not escalate to full suites, audits or
independent reviews because a small check passed. A failure calls for diagnosis
and a targeted fix; retry only after addressing its cause. A timeout is incomplete
verification, not a reason for an automatic repeated attempt.

The Playwright harness owns and stops its server/contexts when the run ends.
For manual inspection, close your temporary context and stop only the managed
server session you started; preserve useful evidence. Never delete user campaigns
or kill processes by name to clean up.

Report the checks actually performed, their outcome, relevant evidence and any
unverified behaviour. For substantive changes follow the single-review rule in
`AGENTS.md`; adding this skill does not authorize an external review request.
Leave GitHub Actions pending after a push without polling.
