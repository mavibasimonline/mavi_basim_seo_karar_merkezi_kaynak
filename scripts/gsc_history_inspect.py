"""Bounded read-only evidence for the existing July–September GSC queue."""
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from cloudflare_diagnostics import Cloudflare
from d1_quota_checkpoint import observation
from d1_quota_control import DATABASE
from release_readiness import get_json, APP

QUERIES = {
    'gaps': ("""WITH RECURSIVE days(day) AS (
      SELECT '2026-07-01' UNION ALL SELECT date(day,'+1 day') FROM days WHERE day<'2026-09-30'
    ), scopes(scope) AS (VALUES('page'),('query'))
    SELECT d.day,s.scope,c.complete,c.row_count,c.fetched_at,
      j.id,j.status,j.cursor,j.attempts,j.error_code,j.next_attempt_at,j.lease_until,j.updated_at
    FROM days d CROSS JOIN scopes s
    LEFT JOIN dataset_coverage c ON c.provider='gsc' AND c.day=d.day AND c.scope=s.scope
    LEFT JOIN sync_jobs j ON j.id='gsc:'||d.day||':'||s.scope
    WHERE c.complete IS NULL OR c.complete<>1 ORDER BY d.day,s.scope""", []),
    'coverage': ("SELECT substr(day,1,7) month,scope,count(*) complete_days,sum(row_count) rows,min(fetched_at) oldest_verification,max(fetched_at) newest_verification FROM dataset_coverage WHERE provider='gsc' AND day BETWEEN '2026-07-01' AND '2026-09-30' AND complete=1 GROUP BY month,scope ORDER BY month,scope", []),
    'queue': ("SELECT provider,status,scope,count(*) jobs,min(day) first_day,max(day) last_day FROM sync_jobs GROUP BY provider,status,scope", []),
    'today': ("SELECT provider,checked_at,status,code FROM health_checks WHERE day=? AND provider IN ('scheduler','planner','sync-budget','gsc')", None),
    'ledger': ("SELECT * FROM d1_quota_ledger WHERE day=?", None),
    'allowance': ("SELECT day,observed_at,data_through,valid_until,account_reads,account_writes,mode FROM d1_quota_state WHERE day=?", None),
    'recent_failures': ("SELECT e.code,e.created_at,j.day,j.scope FROM sync_errors e JOIN sync_runs r ON r.id=e.run_id JOIN sync_jobs j ON j.id=r.job_id ORDER BY e.created_at DESC LIMIT 5", []),
}

def main():
    client = Cloudflare(os.environ.get('CLOUDFLARE_API_TOKEN'), os.environ.get('CLOUDFLARE_ACCOUNT_ID'))
    now = datetime.now(timezone.utc)
    usage = observation(client, now)
    if not usage.get('ok') or usage.get('mode') != 'open':
        raise ValueError('SAFE_ACCOUNT_ANALYTICS_REQUIRED')
    live = get_json(APP + '/api/health').get('deployment', {})
    if live.get('commit') != '8b56115f52ef2e7690927614365165ade4bfbdaa':
        raise ValueError('LIVE_SOURCE_CHANGED')
    out = {'read_only': True, 'rows_read': 0, 'rows_written': 0,
           'observed_at': now.isoformat(), 'live': live, 'account_usage': usage, 'queries': {}}
    for key, (sql, params) in QUERIES.items():
        result = client.request('POST', f'/accounts/{client.account}/d1/database/{DATABASE}/query',
                                {'sql': sql, 'params': [now.date().isoformat()] if params is None else params})
        if not result.get('ok'):
            raise ValueError('READ_ONLY_QUERY_FAILED')
        rows = []
        for statement in result['result']:
            meta = statement.get('meta', {})
            if any(type(meta.get(k)) is not int or meta[k] < 0 for k in ('rows_read', 'rows_written')):
                raise ValueError('REAL_COST_REQUIRED')
            out['rows_read'] += meta['rows_read']
            out['rows_written'] += meta['rows_written']
            rows.extend(statement.get('results', []))
        if out['rows_written'] != 0 or out['rows_read'] > 5000:
            raise ValueError('READ_ONLY_COST_CAP')
        out['queries'][key] = rows
    base = f'/accounts/{client.account}/workers/scripts/mavi-basim-seo-prod'
    settings = client.request('GET', base + '/settings')
    schedules = client.request('GET', base + '/schedules')
    if not settings.get('ok') or not schedules.get('ok'):
        raise ValueError('RUNTIME_READ_REQUIRED')
    selected = {'AUTOMATION_ENABLED', 'CATCHUP_ENABLED', 'SYNC_DAILY_WRITE_LIMIT',
                'SYNC_MAX_PAGES_PER_TICK', 'D1_READ_GUARD_ENABLED'}
    out['runtime'] = {b['name']: b.get('text') for b in settings['result'].get('bindings', [])
                      if b.get('name') in selected and b.get('type') == 'plain_text'}
    raw = schedules['result']
    out['crons'] = [s.get('cron') for s in (raw.get('schedules', []) if isinstance(raw, dict) else raw)]
    destination = Path('.local/production-diagnostics.json')
    destination.parent.mkdir(exist_ok=True)
    destination.write_text(json.dumps(out, ensure_ascii=False))
    destination.chmod(0o600)
    print(json.dumps(out, ensure_ascii=False))

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, ValueError) and str(error).replace('_', '').isupper() else type(error).__name__
        raise SystemExit('GSC_HISTORY_INSPECTION_STOPPED:' + code)
