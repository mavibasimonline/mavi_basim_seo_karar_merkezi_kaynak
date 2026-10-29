"""Read-only PR30 publication gate; never resets a ledger or grants quota."""
import json,os
from datetime import datetime,timezone
from cloudflare_diagnostics import Cloudflare
from d1_quota_control import DATABASE
NOT_BEFORE=datetime(2026,10,28,tzinfo=timezone.utc)

def verify(client,now=None,performance=False):
 now=now or datetime.now(timezone.utc)
 if now<NOT_BEFORE:raise ValueError('PR30_WAIT_FOR_NATURAL_UTC_ROLLOVER')
 day=now.date().isoformat()
 result=client.request('POST',f'/accounts/{client.account}/d1/database/{DATABASE}/query',{'sql':'SELECT s.day,s.observed_at,s.data_through,s.valid_until,s.mode,s.account_reads,s.account_writes,l.reads,l.writes FROM d1_quota_state s JOIN d1_quota_ledger l ON l.day=s.day WHERE s.day=?','params':[day]})
 if not result.get('ok'):raise ValueError('PR30_ROLLOVER_READ_FAILED')
 rows=[r for statement in result.get('result',[]) for r in statement.get('results',[])]
 if len(rows)!=1:raise ValueError('PR30_NEW_DAY_OBSERVATION_AND_LEDGER_REQUIRED')
 r=rows[0]
 try:
  observed,through,until=[datetime.fromisoformat(r[k].replace('Z','+00:00')) for k in ('observed_at','data_through','valid_until')]
  valid=r['day']==day and r['mode']=='open' and observed<=now<until and (now-observed).total_seconds()<=4500 and through<=now and (now-through).total_seconds()<=7200
  valid=valid and all(type(r[k]) is int and r[k]>=0 for k in ('account_reads','account_writes','reads','writes'))
  valid=valid and r['reads']+(20000 if performance else 1000000)<=min(2000000,3500000-r['account_reads']) and r['writes']+(1000 if performance else 5000)<=min(65000,85000-r['account_writes'])
 except (KeyError,ValueError,TypeError):valid=False
 if not valid:raise ValueError('PR30_FRESH_QUOTA_AND_INTERACTIVE_HEADROOM_REQUIRED')
 return {'passed':True,'utc_day':day,'natural_day_ledger_observed':True,'counter_reset':False,'database_queries':1}

def verify_rollback_cron(client,saved):
 # PR30 rolls back only to the pinned, already guarded live source. Preserve the
 # existing schedule; report drift without issuing a schedule mutation.
 result=client.request('GET',f'/accounts/{client.account}/workers/scripts/mavi-basim-seo-prod/schedules')
 if not result.get('ok'):raise ValueError('PR30_ROLLBACK_CRON_READ_FAILED')
 data=result.get('result',[]);rows=data.get('schedules',[]) if isinstance(data,dict) else data
 if [r.get('cron') for r in rows]!=saved.get('previous_crons'):raise ValueError('PR30_ROLLBACK_CRON_DRIFT')
 return {'cron_preserved':True,'schedule_writes':0}

if __name__=='__main__':
 import sys
 from pathlib import Path
 client=Cloudflare(os.environ.get('CLOUDFLARE_API_TOKEN'),os.environ.get('CLOUDFLARE_ACCOUNT_ID'))
 result=verify_rollback_cron(client,json.loads(Path('.local/production-before.json').read_text())) if sys.argv[1:]==['--verify-rollback-cron'] else verify(client,performance=sys.argv[1:]==['--performance'])
 print(json.dumps(result))
