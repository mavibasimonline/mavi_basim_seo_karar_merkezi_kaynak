"""Bounded, read-only GSC continuity and September arithmetic evidence. No sync or API report calls."""
import json,math,os,re
from collections import Counter,defaultdict
from datetime import datetime,timedelta,timezone
from pathlib import Path
from cloudflare_diagnostics import Cloudflare
from d1_quota_checkpoint import observation
from d1_quota_control import DATABASE

MAX_READS=100_000
MAX_SCOPE_ROWS=20_000
MONTHS={'2026-07':31,'2026-08':31,'2026-09':30}
FLAGS=('AUTOMATION_ENABLED','CRAWL_ENABLED','D1_READ_GUARD_ENABLED','SYNC_MAX_PAGES_PER_TICK','SYNC_DAILY_WRITE_LIMIT','GSC_PROPERTY','CATCHUP_ENABLED')
SQL={
 'quota':'SELECT day,observed_at,data_through,valid_until,account_reads,account_writes,mode FROM d1_quota_state WHERE day=?',
 'ledger':'SELECT day,reads,writes,updated_at FROM d1_quota_ledger WHERE day=?',
 'matrix':"""WITH RECURSIVE days(day) AS (SELECT '2026-07-01' UNION ALL SELECT date(day,'+1 day') FROM days WHERE day<'2026-09-30'),scopes(scope) AS (VALUES('page'),('query'))
 SELECT d.day,s.scope,c.complete,c.dataset_id,c.row_count,c.query_partial,c.fetched_at,j.status job_status,j.cursor,j.attempts,j.error_code,j.next_attempt_at,j.updated_at
 FROM days d CROSS JOIN scopes s LEFT JOIN dataset_coverage c ON c.provider='gsc' AND c.day=d.day AND c.scope=s.scope LEFT JOIN sync_jobs j ON j.provider='gsc' AND j.day=d.day AND j.scope=s.scope ORDER BY d.day,s.scope""",
 'health':"SELECT provider,day,checked_at,status,code FROM health_checks WHERE provider IN ('gsc','scheduler','planner','sync-budget') AND day=? ORDER BY provider",
 'recent':"SELECT j.day,j.scope,r.started_at,r.finished_at,r.status,r.rows_received,r.trigger_source FROM sync_runs r JOIN sync_jobs j ON j.id=r.job_id WHERE r.started_at>='2026-10-26T18:01:00Z' AND j.provider='gsc' AND r.trigger_source='cron' ORDER BY r.started_at DESC LIMIT 12",
 'revision':"""SELECT (SELECT max(fetched_at) FROM dataset_coverage) coverage,(SELECT max(updated_at) FROM oauth_credentials) oauth,(SELECT max(checked_at) FROM health_checks WHERE provider IN ('gsc','ga4')) health,(SELECT max(url_verified_at) FROM products) mapping,(SELECT max(imported_at) FROM keyword_sources) archive""",
 'cache':"""SELECT id,created_at,engine_version,json_extract(result_json,'$.period.start') period_start,json_extract(result_json,'$.period.end') period_end,json_extract(result_json,'$.previous_period.start') previous_start,json_extract(result_json,'$.previous_period.end') previous_end,json_array_length(result_json,'$.missing') missing_count,json_array_length(result_json,'$.products') product_count,(SELECT count(*) FROM json_each(result_json,'$.products') p WHERE json_extract(p.value,'$.decision')='Veri bekle') waiting_products,(SELECT count(*) FROM json_each(result_json,'$.products') p WHERE json_extract(p.value,'$.decision') IN ('Koru','İncele','İyileştir')) active_decisions FROM analysis_runs WHERE month='2026-09' AND engine_version='1.2.2' AND json_extract(filters_json,'$.device') IS NULL ORDER BY created_at DESC LIMIT 1""",
}
ORIGINS=('https://mavibasim.com','https://www.mavibasim.com','http://mavibasim.com','http://www.mavibasim.com')
OWNED="((lower(d.page) IN ("+','.join("'"+o+"'" for o in ORIGINS)+") OR "+' OR '.join("lower(d.page) LIKE '"+o+"/%'" for o in ORIGINS)+") AND instr(d.page,char(0))=0 AND instr(d.page,'\\')=0 AND d.page NOT GLOB ('*['||char(1)||'-'||char(32)||char(127)||']*'))"
for scope,table in [('page','gsc_daily_by_page'),('query','gsc_daily_by_query_device')]:
 bad="d.clicks<0 OR d.impressions<d.clicks OR d.clicks<>CAST(d.clicks AS INTEGER) OR d.impressions<>CAST(d.impressions AS INTEGER) OR d.position<0 OR d.position>1.7976931348623157e308 OR d.device NOT IN ('MOBILE','DESKTOP','TABLET') OR length(d.country)<>3 OR d.country GLOB '*[^A-Za-z]*' OR NOT "+OWNED+" OR (d.impressions=0 AND d.ctr<>0) OR (d.impressions>0 AND abs(d.ctr-d.clicks*1.0/d.impressions)>0.000001)"
 if scope=='query':bad+=" OR trim(d.query)='' OR length(d.query)>2000 OR d.is_brand NOT IN (0,1)"
 SQL[scope]=f"""SELECT c.day,c.dataset_id,c.row_count,d.device,count(d.dataset_id) actual_rows,sum(d.clicks) clicks,sum(d.impressions) impressions,sum(d.position*d.impressions) weighted_position,sum(CASE WHEN d.dataset_id IS NOT NULL AND ({bad}) THEN 1 ELSE 0 END) bad_rows
 FROM dataset_coverage c INDEXED BY coverage_active LEFT JOIN {table} d ON d.dataset_id=c.dataset_id AND d.date=c.day WHERE c.provider='gsc' AND c.scope='{scope}' AND c.complete=1 AND c.day BETWEEN '2026-09-01' AND '2026-09-30' GROUP BY c.day,c.dataset_id,c.row_count,d.device ORDER BY c.day,d.device"""
 SQL['plan_'+scope]='EXPLAIN QUERY PLAN '+SQL[scope]
SQL['plan_cache']='EXPLAIN QUERY PLAN '+SQL['cache']

def integer(value):return type(value) is int and value>=0

def instant(value):
 try:
  result=datetime.fromisoformat(value.replace('Z','+00:00'))
  return result if result.tzinfo else None
 except (AttributeError,ValueError,TypeError):return None

def safe_code(value):return value if isinstance(value,str) and re.fullmatch('[A-Z0-9_]{1,120}',value) else None if value is None else 'UNRECOGNIZED_ERROR_CATEGORY'

def summarize_matrix(rows):
 expected={(f'{month}-{day:02}',scope) for month,days in MONTHS.items() for day in range(1,days+1) for scope in ('page','query')}
 if len(rows)!=184 or {(r.get('day'),r.get('scope')) for r in rows}!=expected:raise ValueError('COVERAGE_MATRIX_INVALID')
 months={};complete_total=0
 for month,days in MONTHS.items():
  own=[r for r in rows if r['day'].startswith(month)];complete=sum(r['complete']==1 for r in own);complete_total+=complete
  missing=[{'day':r['day'],'scope':r['scope'],'job_status':r['job_status'],'cursor':r['cursor'],'attempts':r['attempts'],'error_code':safe_code(r['error_code'])} for r in own if r['complete']!=1]
  months[month]={'completed':complete,'expected':days*2,'missing_units':missing,'complete_by_scope':{s:sum(r['complete']==1 for r in own if r['scope']==s) for s in ('page','query')},'jobs_by_status':dict(Counter(r['job_status'] or 'missing_job' for r in own)),'blocked_jobs':[{'day':r['day'],'scope':r['scope'],'error_code':safe_code(r['error_code']),'attempts':r['attempts']} for r in own if r['job_status']=='blocked']}
 return {'completed':complete_total,'expected':184,'remaining':184-complete_total,'months':months,'unit':'day × scope; visible query subset is not all Google queries'}

def metrics(rows):
 if not rows or not sum(r['actual_rows'] for r in rows):return None
 clicks=sum(r['clicks'] or 0 for r in rows);impressions=sum(r['impressions'] or 0 for r in rows);weighted=sum(r['weighted_position'] or 0 for r in rows)
 return {'clicks':clicks,'impressions':impressions,'ctr':clicks/impressions if impressions else None,'position':weighted/impressions if impressions else None,'weighted_position_numerator':weighted}

def validate_facts(rows,coverage,scope):
 expected={r['day']:r for r in coverage if r['scope']==scope and r['day'].startswith('2026-09') and r['complete']==1}
 errors=[];grouped=defaultdict(list);seen=set()
 for row in rows:
  key=(row.get('day'),row.get('device'))
  if key in seen:errors.append('DUPLICATE_AGGREGATE_GROUP')
  seen.add(key);source=expected.get(row.get('day'))
  if not source or row.get('dataset_id')!=source['dataset_id'] or row.get('row_count')!=source['row_count']:errors.append('SOURCE_DATASET_MISMATCH')
  if not integer(row.get('actual_rows')) or not integer(row.get('bad_rows')):raise ValueError('METRIC_COUNT_INVALID')
  if row['bad_rows']:errors.append('INVALID_SOURCE_FIELDS')
  if row['actual_rows']:
   if row['device'] not in ('MOBILE','DESKTOP','TABLET'):errors.append('INVALID_DEVICE')
   values=[row.get(k) for k in ('clicks','impressions','weighted_position')]
   if any(type(v) not in (int,float) or not math.isfinite(v) or v<0 for v in values):raise ValueError('METRIC_VALUE_INVALID')
   if any(not float(row[k]).is_integer() for k in ('clicks','impressions')) or row['clicks']>row['impressions']:errors.append('INVALID_AGGREGATE_COUNTS')
  elif any(row.get(k) is not None for k in ('clicks','impressions','weighted_position')):errors.append('EMPTY_SOURCE_MUST_STAY_NULL')
  grouped[row['day']].append(row)
 for day,source in expected.items():
  if not integer(source['row_count']) or sum(r['actual_rows'] for r in grouped[day])!=source['row_count']:errors.append('DATASET_ROW_COUNT_MISMATCH')
  if not grouped[day]:errors.append('ACTIVE_DAY_MISSING')
 devices={device:metrics([r for r in rows if r['device']==device]) for device in ('MOBILE','DESKTOP','TABLET')}
 daily={day:metrics(values) for day,values in sorted(grouped.items())}
 return {'verified':not errors and len(expected)==30,'errors':sorted(set(errors)),'verified_coverage_days':len(expected),'actual_source_rows':sum(r['actual_rows'] for r in rows),'totals':metrics(rows),'devices':devices,'daily':daily,'formulas':{'ctr':'sum(clicks)/sum(impressions)','position':'sum(position*impressions)/sum(impressions)'},'source_scope':scope}

def cache_status(rows,revisions,now,comparison_complete):
 if not rows:return {'present':False,'panel_report_verified':False,'status':'NOT_PRESENT_NOT_CREATED'}
 row=rows[0];created=instant(row.get('created_at'));stamps=[instant(v) for v in revisions.values() if v]
 fresh=bool(created and timedelta(0)<=now-created<timedelta(minutes=15) and all(t and t<=created for t in stamps))
 period=row.get('period_start')=='2026-09-01' and row.get('period_end')=='2026-09-30' and row.get('previous_start')=='2026-08-01' and row.get('previous_end')=='2026-08-31'
 gate_ok=comparison_complete or (row.get('active_decisions')==0 and row.get('waiting_products')==row.get('product_count') and type(row.get('missing_count')) is int and row['missing_count']>0)
 return {'present':True,'created_at':row.get('created_at'),'engine_version':row.get('engine_version'),'fresh_against_sources':fresh,'period_valid':period,'comparison_gate_valid':gate_ok,'active_decisions':row.get('active_decisions'),'waiting_products':row.get('waiting_products'),'panel_report_verified':False,'status':'STALE_NOT_TREATED_AS_CURRENT' if not fresh else 'METADATA_ONLY_NO_PANEL_METRIC_COMPARISON','note':'Existing metadata only; no report API called or report created.'}

def collect(client,now=None):
 now=now or datetime.now(timezone.utc);day=now.date().isoformat()
 out={'observed_at':now.isoformat(),'read_only':True,'production_worker_modified':False,'google_sync_triggered':False,'site_crawl_triggered':False,'rows_read':0,'rows_written':0,'database_queries':0,'query_costs':{},'status':'blocked'}
 try:
  usage=observation(client,now);out['account_usage']=usage
  through=instant(usage.get('data_through'));observed=instant(usage.get('observed_at'))
  if usage.get('ok') is not True or usage.get('mode')!='open' or usage.get('day')!=day or not through or not observed or not timedelta(0)<=now-through<=timedelta(minutes=75) or not timedelta(0)<=now-observed<=timedelta(minutes=75) or not integer(usage.get('account_reads')) or not integer(usage.get('account_writes')) or usage['account_reads']>=3_400_000 or usage['account_writes']>=84_000:raise ValueError('FRESH_ACCOUNT_HEADROOM_REQUIRED')
  def query(name,params=()):
   sql=SQL[name]
   if not sql.startswith(('SELECT','WITH RECURSIVE','EXPLAIN QUERY PLAN')):raise ValueError('READ_ONLY_SQL_REQUIRED')
   reply=client.request('POST',f'/accounts/{client.account}/d1/database/{DATABASE}/query',{'sql':sql,'params':list(params)})
   out['database_queries']+=1
   if not reply.get('ok') or not isinstance(reply.get('result'),list):raise ValueError('AUDIT_QUERY_FAILED')
   statements=reply['result'];reads=writes=0
   for statement in statements:
    meta=statement.get('meta',{})
    if not integer(meta.get('rows_read')) or not integer(meta.get('rows_written')):raise ValueError('REAL_QUERY_COST_REQUIRED')
    reads+=meta['rows_read'];writes+=meta['rows_written']
   out['rows_read']+=reads;out['rows_written']+=writes;out['query_costs'][name]={'rows_read':reads,'rows_written':writes}
   if writes:raise ValueError('READ_ONLY_COST_VIOLATION')
   if out['rows_read']>MAX_READS:raise ValueError('AUDIT_READ_CAP')
   return [row for statement in statements for row in statement.get('results',[])]
  quota=query('quota',[day]);ledger=query('ledger',[day]);out['quota']=quota;out['ledger']=ledger
  state=quota[0] if len(quota)==1 else {};local=ledger[0] if len(ledger)==1 else {};until=instant(state.get('valid_until'));stamp=instant(state.get('observed_at'));data=instant(state.get('data_through'))
  # This external SELECT-only audit has its own fresh account + local headroom
  # gate. Observe an expired production lease without renewing it, resetting a
  # budget or invoking the Worker. The production collection guard stays intact.
  out['production_lease_valid']=bool(state.get('day')==day and state.get('mode')=='open' and until and until>now and stamp and timedelta(0)<=now-stamp<=timedelta(minutes=75) and data and timedelta(0)<=now-data<=timedelta(hours=2))
  if not out['production_lease_valid']:out['collection_blocker']='PRODUCTION_QUOTA_LEASE_NOT_CURRENT'
  if not integer(local.get('reads')) or not integer(local.get('writes')) or local.get('day')!=day or local['reads']>=1_900_000 or local['writes']>=64_000:raise ValueError('LOCAL_HEADROOM_REQUIRED')
  if usage['account_reads']+local['reads']+MAX_READS>=3_400_000 or usage['account_writes']+local['writes']>=84_000:raise ValueError('CONSERVATIVE_ACCOUNT_HEADROOM_REQUIRED')
  matrix=query('matrix');out['coverage']=summarize_matrix(matrix)
  out['health']=query('health',[day]);out['recent_cron_runs']=query('recent')
  base=f'/accounts/{client.account}/workers/scripts/mavi-basim-seo-prod'
  settings=client.request('GET',base+'/settings');schedules=client.request('GET',base+'/schedules')
  if settings.get('ok') and isinstance(settings.get('result'),dict):out['runtime_flags']={b['name']:b.get('text') for b in settings['result'].get('bindings',[]) if b.get('name') in FLAGS and b.get('type')=='plain_text'}
  if schedules.get('ok'):
   value=schedules.get('result');entries=value.get('schedules',[]) if isinstance(value,dict) else value
   out['crons']=[r.get('cron') for r in entries or []]
  september=[r for r in matrix if r['day'].startswith('2026-09')];estimate={scope:sum(r['row_count'] for r in september if r['scope']==scope and r['complete']==1 and integer(r['row_count'])) for scope in ('page','query')}
  for scope in ('page','query'):
   if any(not integer(r['row_count']) for r in september if r['scope']==scope and r['complete']==1) or estimate[scope]>MAX_SCOPE_ROWS:raise ValueError('SEPTEMBER_INPUT_SCOPE_CAP')
  out['september_input_rows']=estimate;audits={}
  for scope in ('page','query'):
   plans=query('plan_'+scope);detail=' '.join(str(r.get('detail','')) for r in plans)
   if 'SEARCH c USING COVERING INDEX coverage_active' not in detail or f'SEARCH d USING INDEX gsc_{scope}_dates' not in detail:raise ValueError('INDEXED_ACTIVE_PLAN_REQUIRED')
   if out['rows_read']+estimate[scope]*2+1000>MAX_READS:raise ValueError('METRIC_READ_HEADROOM_REQUIRED')
   audits[scope]=validate_facts(query(scope),matrix,scope)
  out['september_metrics']=audits
  cache_plan=' '.join(str(r.get('detail','')) for r in query('plan_cache'))
  if 'SEARCH analysis_runs USING INDEX report_cache_lookup' not in cache_plan:raise ValueError('INDEXED_CACHE_PLAN_REQUIRED')
  revisions=query('revision');comparison_complete=out['coverage']['months']['2026-08']['completed']==62
  out['september_cache']=cache_status(query('cache'),revisions[0] if revisions else {},now,comparison_complete)
  out['september_acceptance']={'raw_metrics_verified':all(a['verified'] for a in audits.values()),'previous_august_complete':comparison_complete,'monthly_comparison_accepted':comparison_complete and all(a['verified'] for a in audits.values()),'seo_decisions_accepted':False,'note':'Page performance and visible query subset stay separate; query totals need not equal page totals. Incomplete August blocks monthly comparisons/SEO changes. No panel response generated or modified.'}
  out['status']='observed';return out
 except Exception as error:
  out['reason']=str(error) if isinstance(error,ValueError) and re.fullmatch('[A-Z_]+',str(error)) else type(error).__name__
  return out

if __name__=='__main__':
 try:result=collect(Cloudflare(os.environ.get('CLOUDFLARE_API_TOKEN'),os.environ.get('CLOUDFLARE_ACCOUNT_ID')))
 except Exception:result={'status':'blocked','reason':'CLOUDFLARE_BINDINGS_UNAVAILABLE','rows_written':0}
 path=Path('.local/gsc-continuity-audit.json');path.parent.mkdir(exist_ok=True);path.write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False,indent=2))
 if result['status']!='observed':raise SystemExit('READ_ONLY_CONTINUITY_AUDIT_INCOMPLETE')
