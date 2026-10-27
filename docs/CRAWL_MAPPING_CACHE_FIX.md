# Stable URL-mapping verification evidence

Repeated successful crawls of an already verified, unchanged canonical URL advanced `products.url_verified_at`. Both the SEO report cache and the KPI evidence revision treated that timestamp as a changed input, even while the mapping and GSC metrics stayed identical. That caused avoidable cache misses and extra report writes inside the existing cache lifetimes.

The crawler now sets the mapping verification timestamp when the mapping is first established or an explicitly unverified mapping is reverified. It preserves that evidence when the same mapping is observed again. Existing `crawls` and immutable snapshots continue recording every crawl and content change, including the latest observation time.

This does not extend report/KPI cache lifetimes, ignore GSC data changes, relax canonical checks or change quota/OAuth/Cron configuration. A genuinely newly verified mapping still invalidates reports and KPIs. Server errors and alternate canonical URLs cannot create verification evidence.

Seven local D1 regression scenarios cover stable mapping and latest crawl history, report reuse, KPI reuse, first verification invalidation, content-change snapshots, canonical mismatch and server errors. Before the change four scenarios failed; afterwards all seven and the existing crawler/budget tests passed (50 tests combined).

Code is prepared for review; production deployment and live acceptance require separate approval. This document contains no private production measurements or operational audit details.
