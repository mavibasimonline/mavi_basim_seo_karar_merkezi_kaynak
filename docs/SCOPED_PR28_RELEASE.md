# PR28 source selection in the existing guarded production workflow

The normal main release behavior remains the default. For this crawler hotfix,
an optional pinned source commit can preserve the currently deployed UI while
unreleased main UI work stays intact on main.

The additional gate requires a single-child source of the actual live commit,
exactly the three reviewed PR28 files, the same approved files as successful
main, identical dependency/configuration files, and a separate successful CI run
on the exact source commit. Static UI bodies must match before and after release.
Unknown source files, altered assets, changed live base or failed CI stop release.

Existing exact-main CI, single 100% live version, D1 quota/runtime/auth binding
checks, read-only schema verification, quota checkpoint, smoke and rollback gates
stay in place. Deployment guards run from main; only the verified application
source is staged separately. The actual source SHA is used in Worker version
metadata and smoke verification, so it is never misreported as a full-main build.

No report or KPI endpoint, migration, Google sync or live-site edit is part of
this source selection. The release branch is not merged over main and does not
remove the unreleased main feature.
