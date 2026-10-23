-- Last complete UTC calendar month and its preceding month; no invented missing dates.
WITH RECURSIVE span AS (
  SELECT date('now','start of month','-2 months') AS first_day,date('now','start of month','-1 day') AS last_day
), days(day) AS (
  SELECT first_day FROM span UNION ALL SELECT date(day,'+1 day') FROM days,span WHERE day<span.last_day
), scopes(scope) AS (VALUES('page'),('query'))
SELECT days.day,scopes.scope AS missing_scope FROM days CROSS JOIN scopes
LEFT JOIN dataset_coverage c ON c.provider='gsc' AND c.day=days.day AND c.scope=scopes.scope AND c.complete=1
WHERE c.dataset_id IS NULL ORDER BY days.day,scopes.scope;

SELECT d.page,d.device,substr(d.date,1,7) AS month,
  sum(d.clicks) AS clicks,sum(d.impressions) AS impressions,
  sum(d.clicks)*1.0/nullif(sum(d.impressions),0) AS ctr,
  sum(d.position*d.impressions)*1.0/nullif(sum(d.impressions),0) AS weighted_position
FROM gsc_daily_by_page d JOIN dataset_coverage c ON c.dataset_id=d.dataset_id AND c.day=d.date
  AND c.provider='gsc' AND c.scope='page' AND c.complete=1
WHERE d.date BETWEEN date('now','start of month','-2 months') AND date('now','start of month','-1 day')
  AND d.page IN ('https://mavibasim.com/brosur','https://mavibasim.com/el-ilani')
GROUP BY d.page,d.device,substr(d.date,1,7) ORDER BY d.page,month,d.device;

SELECT id,month,engine_version,created_at FROM analysis_runs ORDER BY created_at DESC LIMIT 3;
SELECT r.product_id,r.decision,r.confidence,json_array_length(r.evidence_ids_json) AS evidence_count,
  r.analysis_run_id FROM recommendations r
WHERE r.analysis_run_id=(SELECT id FROM analysis_runs ORDER BY created_at DESC LIMIT 1);
