import json,os
from datetime import datetime,timezone
from cloudflare_diagnostics import Cloudflare
from quota_observer_release import api
c=Cloudflare(os.environ['CLOUDFLARE_API_TOKEN'],os.environ['CLOUDFLARE_ACCOUNT_ID']);day=datetime.now(timezone.utc).date().isoformat()
queries={
 'lease':('SELECT day,account_reads,account_writes,mode,observed_at,valid_until FROM d1_quota_state WHERE day=?',[day]),
 'ledger':('SELECT day,reads,writes FROM d1_quota_ledger WHERE day=?',[day]),
 'report_costs':("SELECT day,fingerprint,executions,rows_read,rows_written,max_rows_read FROM d1_query_costs WHERE day>=date('now','-1 day') ORDER BY rows_read DESC LIMIT 12",[]),
 'stored_months':("SELECT month,count(*) versions,max(created_at) latest,max(json_array_length(json_extract(result_json,'$.missing'))) missing FROM analysis_runs WHERE month IN ('2026-07','2026-08','2026-09') GROUP BY month",[])
}
for name,(sql,params) in queries.items():
 r=api(c,'POST','/d1/database/18f8c90d-4af1-430c-ac86-ddf184c75a0b/query',{'sql':sql,'params':params})
 assert sum(x['meta']['rows_read'] for x in r)<5000
 print(json.dumps({name:[v for x in r for v in x.get('results',[])],'diagnostic_rows_read':sum(x['meta']['rows_read'] for x in r)},ensure_ascii=False),flush=True)
