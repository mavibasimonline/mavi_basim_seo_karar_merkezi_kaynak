-- Read-only: D-3 UTC is the first expected final GSC date. Do not print credential values.
WITH target AS (SELECT date('now','-3 days') AS day)
SELECT c.provider,c.day,c.scope,c.complete,c.query_partial,c.row_count,c.fetched_at,
  CASE c.scope
    WHEN 'page' THEN (SELECT count(*) FROM gsc_daily_by_page d WHERE d.dataset_id=c.dataset_id AND d.date=c.day)
    WHEN 'query' THEN (SELECT count(*) FROM gsc_daily_by_query_device d WHERE d.dataset_id=c.dataset_id AND d.date=c.day)
  END AS stored_rows
FROM dataset_coverage c,target WHERE c.provider='gsc' AND c.day=target.day ORDER BY c.scope;

SELECT provider,day,status,checked_at,code FROM health_checks ORDER BY checked_at DESC LIMIT 10;
SELECT provider,day,scope,status,cursor,attempts,error_code FROM sync_jobs
WHERE provider='gsc' AND day=date('now','-3 days') ORDER BY scope;

SELECT d.date,d.page,d.country,d.device,sum(d.clicks) AS clicks,sum(d.impressions) AS impressions,
  sum(d.clicks)*1.0/nullif(sum(d.impressions),0) AS ctr,
  sum(d.position*d.impressions)*1.0/nullif(sum(d.impressions),0) AS weighted_position
FROM gsc_daily_by_page d JOIN dataset_coverage c ON c.dataset_id=d.dataset_id AND c.day=d.date
  AND c.provider='gsc' AND c.scope='page' AND c.complete=1
WHERE d.date=date('now','-3 days') AND d.page IN ('https://mavibasim.com/brosur','https://mavibasim.com/el-ilani')
GROUP BY d.date,d.page,d.country,d.device;

SELECT r.started_at,r.finished_at,r.status,e.code,e.retry_at
FROM sync_errors e JOIN sync_runs r ON r.id=e.run_id ORDER BY e.created_at DESC LIMIT 10;
