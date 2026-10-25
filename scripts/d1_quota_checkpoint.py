"""Hourly account-wide D1 allowance. No application-data scans, no tokens in Worker."""
import json
import os
from datetime import datetime,timedelta,timezone
from pathlib import Path
from d1_quota_control import graphql,DATABASE
from cloudflare_diagnostics import Cloudflare

READ_STOP=3_500_000
WRITE_STOP=85_000
NOT_BEFORE=datetime(2026,10,26,tzinfo=timezone.utc)


def observation(client,now=None):
 now=now or datetime.now(timezone.utc);start=now.replace(hour=0,minute=0,second=0,microsecond=0)
 query='''query D1ReadBudget($accountTag: string, $filter: ZoneWorkersRequestsFilter_InputObject) {
 viewer { accounts(filter:{accountTag:$accountTag}) { d1AnalyticsAdaptiveGroups(limit:10000,filter:$filter) {
 sum { rowsRead rowsWritten } dimensions { datetimeHour } } } } }'''
 response=graphql(client,query,{'accountTag':client.account,'filter':{'AND':[{'datetimeHour_geq':start.isoformat(),'datetimeHour_leq':now.isoformat()}]}})
 if not response.get('ok'):return {'ok':False,'reason':'ANALYTICS_UNAVAILABLE'}
 try:
  if len(response['accounts'])!=1:raise ValueError()
  rows=response['accounts'][0]['d1AnalyticsAdaptiveGroups']
  if not rows or len(rows)>=10000:raise ValueError()
  if any((isinstance(r['sum'][field],bool) or not isinstance(r['sum'][field],(int,float))) or not 0<=r['sum'][field]<float('inf') for r in rows for field in ('rowsRead','rowsWritten')):raise ValueError()
  reads=sum(r['sum']['rowsRead'] for r in rows);writes=sum(r['sum']['rowsWritten'] for r in rows)
  latest=max(datetime.fromisoformat(r['dimensions']['datetimeHour'].replace('Z','+00:00')) for r in rows)
  if latest.tzinfo is None or latest<start or latest>now or (now-latest).total_seconds()>7200:raise ValueError()
  if not float(reads).is_integer() or not float(writes).is_integer():raise ValueError()
 except (KeyError,ValueError,TypeError,OverflowError):return {'ok':False,'reason':'ANALYTICS_EMPTY_DELAYED_OR_INVALID'}
 mode='blocked' if reads>=READ_STOP or writes>=WRITE_STOP else 'slow' if (now-latest).total_seconds()>4500 or reads>=2_000_000 else 'open'
 return {'ok':True,'day':start.date().isoformat(),'observed_at':now.isoformat(),'data_through':latest.isoformat(),'valid_until':min(now+timedelta(minutes=75),start+timedelta(days=1)).isoformat(),'account_reads':int(reads),'account_writes':int(writes),'mode':mode,'reason':'Hesap genelindeki gecikmeli analitik + yerel atomik rezervasyon; 1.500.000 okuma güvenlik payı korunur.' if mode!='blocked' else 'Günlük hesap güvenlik sınırına ulaşıldı.'}


def checkpoint(client,now=None):
 now=now or datetime.now(timezone.utc)
 if now<NOT_BEFORE:return {'updated':False,'reason':'WAIT_FOR_2026_10_26_UTC_RESET','database_queries':0}
 state=observation(client,now)
 # Never read/write D1 on missing analytics or exhausted reads. The last lease
 # expires; it is NOT extended on an exception or assumed to reset to zero.
 if not state['ok'] or state['mode']=='blocked':return {'updated':False,'observation':state,'database_queries':0}
 sql='''INSERT INTO d1_quota_state(day,observed_at,data_through,valid_until,account_reads,account_writes,mode,reason) VALUES(?,?,?,?,?,?,?,?)
 ON CONFLICT(day) DO UPDATE SET observed_at=excluded.observed_at,data_through=excluded.data_through,valid_until=excluded.valid_until,account_reads=max(d1_quota_state.account_reads,excluded.account_reads),account_writes=max(d1_quota_state.account_writes,excluded.account_writes),mode=excluded.mode,reason=excluded.reason
 WHERE excluded.observed_at>d1_quota_state.observed_at'''
 result=client.request('POST',f'/accounts/{client.account}/d1/database/{DATABASE}/query',{'sql':sql,'params':[state[k] for k in ('day','observed_at','data_through','valid_until','account_reads','account_writes','mode','reason')]})
 if not result.get('ok'):return {'updated':False,'reason':'D1_CHECKPOINT_UNAVAILABLE','database_queries':1}
 return {'updated':True,'observation':state,'database_queries':1,'local_reservations_reset':False}


def monitored_checkpoint(client,now=None,require_live_guard=False,probe=None):
 now=now or datetime.now(timezone.utc)
 if now<NOT_BEFORE:return {'updated':False,'reason':'WAIT_FOR_2026_10_26_UTC_RESET','database_queries':0}
 if require_live_guard:
  if probe is None:
   from release_readiness import live_guard_deployment
   probe=live_guard_deployment
  try:ready=bool(probe())
  except ValueError:ready=False
  if not ready:return {'updated':False,'reason':'LIVE_READ_GUARD_NOT_DEPLOYED','database_queries':0}
 return checkpoint(client,now)


if __name__=='__main__':
 import sys
 result=monitored_checkpoint(Cloudflare(os.environ.get('CLOUDFLARE_API_TOKEN'),os.environ.get('CLOUDFLARE_ACCOUNT_ID')),require_live_guard='--require-live-guard' in sys.argv)
 folder=Path('.local');folder.mkdir(exist_ok=True);(folder/'d1-quota-checkpoint.json').write_text(json.dumps(result,indent=2))
 print(json.dumps(result,indent=2))
 if os.environ.get('GITHUB_OUTPUT'):
  with open(os.environ['GITHUB_OUTPUT'],'a') as out:out.write('ready='+str(bool(result.get('updated'))).lower()+'\n')
 if not result.get('updated') and result.get('reason') not in ('LIVE_READ_GUARD_NOT_DEPLOYED','WAIT_FOR_2026_10_26_UTC_RESET'):raise SystemExit('D1_QUOTA_CHECKPOINT_NOT_EXTENDED')
