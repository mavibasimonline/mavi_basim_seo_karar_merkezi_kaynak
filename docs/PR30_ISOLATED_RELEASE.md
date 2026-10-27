# PR30 isolated release preparation

No production deployment is performed by this PR. The selected Worker source is
`f888618954a49f0117ac1dfbd1d43ea80393a03b`, the single child of live source
`20da9ba512b29b2844559f070d0db4c1b1c62f6c`. It applies exactly the reviewed diff
of merge `93afeb06706351150b87b0138a0418ecfbb1839b` against its first parent.
`src/index.ts` changes only the 429 `reason` field; main's GSC review import and
route are absent. Public assets, dependencies, production configuration, OAuth,
Cron, schema, GSC source data and all other runtime files equal the live source.
The selected branch is `release/pr30-interactive-only`; do not merge it over main.

## Gates

The existing controlled workflow gains one pinned PR30 source option. The pin,
single live parent, exact four changed paths, approved-main file parity, static
asset equality, exact selected-source CI, exact main CI, live 100% version lock,
auth/D1 binding checks, read-only schema check, quota observation and smoke gates
remain mandatory. Unknown sources continue through the existing PR28 validator
and fail if they are not that approved shape. Deployment uses trusted scripts
from main and stages only the selected source. This preparation PR changes no
Worker application payload; its scripts are deployment checks only.

Publication cannot happen before 2026-10-28 00:00 UTC, i.e. **28 October 03:00
Türkiye**. Afterwards the new read-only gate requires BOTH a quota observation
and an existing local ledger for the actual current UTC day. A missing row is
not assumed to mean zero. The observation must be open, nonfuture, within 75
minutes, with analytics no older than two hours and an unexpired lease. The new
day's ledger plus a 1,000,000 read / 5,000 write interactive allowance must fit
both unchanged local and account ceilings. Yesterday's exhausted ledger is
neither updated nor deleted. If normal scheduled work has not yet created the
new day ledger, publication waits. This is not a promise to publish at 03:00.

Before dispatch: merge/review this guard preparation with successful PR CI and
successful subsequent main CI, verify successful workflow_dispatch CI on the
exact isolated source, verify live source/version remains the pinned base,
refresh the ordinary quota checkpoint and check normal new-day evidence.
Dispatch production.yml on then-current main using `source_commit` set to the
full selected SHA and `previous_version` set to the newly verified live UUID.
Do not dispatch with an empty source, as that selects full main. Changed live
source, changed approved files, insufficient headroom or stale quota requires
stopping and reviewing again. No automatic future job is created here.

After successful publication, verify health identifies the actual isolated SHA,
then make bounded authenticated session/status/overview checks. A valid owner
session or production credential is required; none is created or exposed by
this preparation. Preserve HTTP 429 and record its `reason` if budgets reject.

The isolated source retains PR30's 47 D1 regression tests, including background
read/write stops followed by real login/report, authenticated status and failed
login attempt limits. It reserves headroom prospectively; it does not repair an
already exhausted previous day. Users can still exhaust their own shared pool.
Four new rollover gate tests and existing source-policy tests validate the
publication preparation offline. Full selected-source and guard-PR CI must pass.

PR29 stays pending. No limit increase, reset, migration, bulk import, OAuth,
Cron or UI changes are authorized by this preparation.

For the pinned PR30 source only, failed-smoke rollback restores the already
D1-guarded base without the older PR28 schedule-pause commands. Afterwards the
saved Cron schedule is checked through GET only; drift is reported and never
repaired by a schedule write. Other release paths retain their existing behavior.
