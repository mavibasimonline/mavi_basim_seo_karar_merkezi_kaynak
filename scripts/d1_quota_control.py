"""D1 incident containment and Analytics-only evidence; never queries application rows."""
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from cloudflare_diagnostics import Cloudflare

WORKER='mavi-basim-seo-prod'
DATABASE='18f8c90d-4af1-430c-ac86-ddf184c75a0b'


def graphql(client, query, variables):
 import urllib.request
 request=urllib.request.Request('https://api.cloudflare.com/client/v4/graphql',data=json.dumps({'query':query,'variables':variables}).encode(),method='POST',headers={'Authorization':'Bearer '+client.token,'Content-Type':'application/json'})
 try:
  with client.opener.open(request,timeout=45) as response:raw=response.read(2_000_001)
  if len(raw)>2_000_000:return {'ok':False,'code':'ANALYTICS_RESPONSE_LIMIT'}
  result=json.loads(raw)
  if result.get('errors'):return {'ok':False,'code':'ANALYTICS_UNAVAILABLE'}
  return {'ok':True,'accounts':result['data']['viewer']['accounts']}
 except Exception:return {'ok':False,'code':'ANALYTICS_UNAVAILABLE'}


def family(sql):
 text=' '.join(sql.lower().split())
 for needle,name in [
  ('select max(stamp)','report-cache-invalidation'),
  ('from analysis_runs','report-cache'),
  ('select distinct page from gsc_daily_by_page','crawl-discovery'),
  ('actual_rows','dataset-integrity'),
  ('sum(d.position*d.impressions)','metric-validation'),
  ('sum(d.position * d.impressions)','metric-validation'),
  ('from gsc_daily_by_query_device','query-performance'),
  ('from gsc_daily_by_page','page-performance'),
  ('update sync_jobs','sync-queue'),
  ('from keyword_metric_observations','keyword-archive'),
  ('from dataset_coverage','coverage'),
  ('health_checks','health-budget'),
  ('sync_runs','sync-history'),
 ]:
  if needle in text:return name
 return 'other'


def shape(sql):
 # Bound values are absent in D1 insights. Remove all remaining SQL literals and
 # comments as well; never serialize raw query text, credentials or Google rows.
 sql=re.sub(r"/\*.*?\*/|--[^\n]*",' ',sql,flags=re.S)
 sql=re.sub(r"'(?:''|[^'])*'",'?',sql)
 sql=re.sub(r'"(?:""|[^"])*"','?',sql)
 return ' '.join(sql.split())[:6000]


def inspect(client):
 now=datetime.now(timezone.utc);start=now.replace(hour=0,minute=0,second=0,microsecond=0).isoformat()
 query='''query D1ReadIncident($accountTag: string, $filter: ZoneWorkersRequestsFilter_InputObject) {
 viewer { accounts(filter:{accountTag:$accountTag}) { d1QueriesAdaptiveGroups(limit:30,filter:$filter,orderBy:[sum_rowsRead_DESC]) {
 count sum { rowsRead rowsWritten } avg { rowsRead } dimensions { query } } } } }'''
 data=graphql(client,query,{'accountTag':client.account,'filter':{'AND':[{'datetimeHour_geq':start,'datetimeHour_leq':now.isoformat(),'databaseId':DATABASE}]}})
 result={'observed_at':now.isoformat(),'analytics_only':True,'application_sql_executed':False,'daily_usage':client.daily_usage(),'query_insights':{'ok':data['ok']}}
 if data['ok']:
  result['query_insights']['queries']=[{'fingerprint':hashlib.sha256(r.get('dimensions',{}).get('query','').encode()).hexdigest()[:16],'family':family(r.get('dimensions',{}).get('query','')),'shape':shape(r.get('dimensions',{}).get('query','')),'executions':r.get('count'),'rows_read':r.get('sum',{}).get('rowsRead'),'rows_written':r.get('sum',{}).get('rowsWritten'),'average_rows_read':r.get('avg',{}).get('rowsRead')} for a in data['accounts'] for r in a.get('d1QueriesAdaptiveGroups',[])]
 else:result['query_insights']['code']=data['code']
 return result


def contain(client):
 path=f'/accounts/{client.account}/workers/scripts/{WORKER}/schedules'
 before=client.request('GET',path)
 if not before['ok']:raise ValueError('SCHEDULE_READ_FAILED')
 rows=before['result'].get('schedules',[]) if isinstance(before['result'],dict) else before['result']
 crons=[r['cron'] for r in rows]
 if crons not in (['* * * * *'],['*/15 * * * *']):raise ValueError('UNEXPECTED_CURRENT_CRON')
 if crons!=['*/15 * * * *']:
  changed=client.request('PUT',path,[{'cron':'*/15 * * * *'}])
  if not changed['ok']:raise ValueError('SCHEDULE_CONTAINMENT_FAILED')
 after=client.request('GET',path)
 if not after['ok']:raise ValueError('SCHEDULE_VERIFICATION_FAILED')
 rows=after['result'].get('schedules',[]) if isinstance(after['result'],dict) else after['result']
 actual=[r['cron'] for r in rows]
 if actual!=['*/15 * * * *']:raise ValueError('SCHEDULE_VERIFICATION_FAILED')
 return {'before':crons,'after':actual,'database_queries':0,'database_or_oauth_changed':False,'note':'Emergency frequency reduction only; SQL/read-budget fixes still required.'}


if __name__=='__main__':
 client=Cloudflare(os.environ.get('CLOUDFLARE_API_TOKEN'),os.environ.get('CLOUDFLARE_ACCOUNT_ID'))
 mode=os.environ.get('QUOTA_OPERATION','quota-inspect')
 result=inspect(client)
 if mode=='quota-contain':result['containment']=contain(client)
 elif mode!='quota-inspect':raise SystemExit('UNEXPECTED_OPERATION')
 output=Path('.local/d1-quota-incident.json');output.parent.mkdir(exist_ok=True);output.write_text(json.dumps(result,indent=2))
 print(json.dumps(result,indent=2))
