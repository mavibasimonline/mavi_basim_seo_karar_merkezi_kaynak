import copy,json,sqlite3,sys,unittest
from datetime import datetime,timedelta,timezone
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import gsc_continuity_audit as audit

NOW=datetime(2026,10,26,21,55,tzinfo=timezone.utc)
def matrix():
 return [dict(day=f'{month}-{day:02}',scope=scope,complete=int(month=='2026-09'),dataset_id=f'{scope}:{month}-{day:02}',row_count=2 if month=='2026-09' else None,query_partial=int(scope=='query'),fetched_at=NOW.isoformat(),job_status='done' if month=='2026-09' else 'pending',cursor=0,attempts=0,error_code=None,next_attempt_at=NOW.isoformat(),updated_at=NOW.isoformat()) for month,days in audit.MONTHS.items() for day in range(1,days+1) for scope in ('page','query')]
def groups(scope):
 return [dict(day=f'2026-09-{day:02}',dataset_id=f'{scope}:2026-09-{day:02}',row_count=2,device=device,actual_rows=1,clicks=clicks,impressions=impressions,weighted_position=weighted,bad_rows=0) for day in range(1,31) for device,clicks,impressions,weighted in [('MOBILE',20,1000,12000),('DESKTOP',10,100,200)]]
def usage():
 return dict(ok=True,mode='open',day=NOW.date().isoformat(),observed_at=NOW.isoformat(),data_through=(NOW-timedelta(minutes=30)).isoformat(),account_reads=700000,account_writes=25000)
class Fake:
 account='a'*32
 def __init__(self):
  self.calls=[];self.metadata={'rows_read':2,'rows_written':0};self.data={name:[] for name in audit.SQL}
  self.data.update(quota=[dict(day=NOW.date().isoformat(),observed_at=NOW.isoformat(),data_through=(NOW-timedelta(minutes=30)).isoformat(),valid_until=(NOW+timedelta(minutes=60)).isoformat(),mode='open')],ledger=[dict(day=NOW.date().isoformat(),reads=400000,writes=12000)],matrix=matrix(),page=groups('page'),query=groups('query'),revision=[{}])
  for name in ('page','query'):self.data['plan_'+name]=[{'detail':'SEARCH c USING COVERING INDEX coverage_active'},{'detail':f'SEARCH d USING INDEX gsc_{name}_dates'}]
  self.data['plan_cache']=[{'detail':'SEARCH analysis_runs USING INDEX report_cache_lookup'}]
 def request(self,method,path,body=None):
  self.calls.append((method,path,body))
  if method=='GET':return {'ok':True,'result':{'schedules':[{'cron':'*/15 * * * *'}]} if path.endswith('schedules') else {'bindings':[]}}
  self.assert_read(body['sql']);name=next(k for k,v in audit.SQL.items() if v==body['sql'])
  return {'ok':True,'result':[{'results':self.data[name],'meta':self.metadata.copy()}]}
 @staticmethod
 def assert_read(sql):
  if not sql.startswith(('SELECT','WITH RECURSIVE','EXPLAIN QUERY PLAN')):raise AssertionError('MUTATING_SQL')
def collect(client,obs=None):
 with patch.object(audit,'observation',return_value=usage() if obs is None else obs):return audit.collect(client,NOW)

class ContinuityTests(unittest.TestCase):
 def test_complete_readonly_path_separates_sources_and_does_not_create_report(self):
  c=Fake();r=collect(c)
  self.assertEqual(r['status'],'observed');self.assertEqual(r['rows_written'],0)
  self.assertEqual(r['coverage']['completed'],60);self.assertEqual(r['coverage']['remaining'],124)
  self.assertTrue(r['september_acceptance']['raw_metrics_verified'])
  self.assertFalse(r['september_acceptance']['monthly_comparison_accepted'])
  self.assertFalse(r['september_cache']['panel_report_verified'])
  self.assertEqual(r['september_cache']['status'],'NOT_PRESENT_NOT_CREATED')
  self.assertTrue(all(m in ('GET','POST') and (m=='GET' or '/d1/database/' in p) for m,p,b in c.calls))
  self.assertFalse(r['google_sync_triggered']);self.assertFalse(r['production_worker_modified'])
 def test_fresh_account_failure_prevents_any_d1_or_worker_api_call(self):
  for change in ({'ok':False},{'mode':'blocked'},{'mode':'slow'},{'account_reads':3400000},{'account_writes':84000},{'account_reads':True},{'data_through':(NOW-timedelta(hours=3)).isoformat()},{'day':'2026-10-25'}):
   obs=usage();obs.update(change);c=Fake();r=collect(c,obs)
   self.assertEqual(r['status'],'blocked');self.assertEqual(c.calls,[])
 def test_expired_lease_is_observed_without_renewal_or_bypassing_collection(self):
  c=Fake();c.data['quota'][0]['valid_until']=(NOW-timedelta(hours=2)).isoformat()
  r=collect(c);self.assertEqual(r['status'],'observed');self.assertFalse(r['production_lease_valid'])
  self.assertEqual(r['collection_blocker'],'PRODUCTION_QUOTA_LEASE_NOT_CURRENT');self.assertEqual(r['rows_written'],0)
  self.assertFalse(any('UPDATE' in (b or {}).get('sql','') or 'INSERT' in (b or {}).get('sql','') for m,p,b in c.calls))
 def test_local_exhaustion_stops_before_matrix_or_metric_queries(self):
  for field,value in [('reads',1900000),('writes',64000)]:
   c=Fake();c.data['ledger'][0][field]=value;r=collect(c)
   self.assertEqual(r['reason'],'LOCAL_HEADROOM_REQUIRED');self.assertNotIn('coverage',r)
 def test_conservative_headroom_keeps_room_for_whole_audit(self):
  c=Fake();obs=usage();obs['account_reads']=3000000
  self.assertEqual(collect(c,obs)['reason'],'CONSERVATIVE_ACCOUNT_HEADROOM_REQUIRED')
 def test_cost_metadata_is_required_and_nonzero_writes_are_never_accepted(self):
  for meta,reason in [({'rows_read':2},'REAL_QUERY_COST_REQUIRED'),({'rows_read':True,'rows_written':0},'REAL_QUERY_COST_REQUIRED'),({'rows_read':2,'rows_written':1},'READ_ONLY_COST_VIOLATION'),({'rows_read':100001,'rows_written':0},'AUDIT_READ_CAP')]:
   c=Fake();c.metadata=meta;r=collect(c);self.assertEqual(r['reason'],reason);self.assertEqual(r['status'],'blocked')
 def test_input_row_cap_stops_before_fact_table_reads(self):
  c=Fake();c.data['matrix'][0]['row_count']=None
  for row in c.data['matrix']:
   if row['day'].startswith('2026-09') and row['scope']=='query':row['row_count']=1000
  r=collect(c);self.assertEqual(r['reason'],'SEPTEMBER_INPUT_SCOPE_CAP')
  self.assertFalse(any(b and b['sql']==audit.SQL['query'] for m,p,b in c.calls))
 def test_full_scan_plan_blocks_before_reading_fact_rows(self):
  c=Fake();c.data['plan_page']=[{'detail':'SCAN d'}]
  self.assertEqual(collect(c)['reason'],'INDEXED_ACTIVE_PLAN_REQUIRED')
 def test_matrix_rejects_missing_or_duplicate_day_scope_cells(self):
  for rows in (matrix()[:-1],matrix()[:-1]+[matrix()[0]]):
   with self.assertRaisesRegex(ValueError,'MATRIX_INVALID'):audit.summarize_matrix(rows)
 def test_blocked_and_pending_jobs_are_reported_by_month_without_reset(self):
  rows=matrix();rows[0].update(job_status='blocked',error_code='INVALID_GSC_ROW_PAGE_ORIGIN',attempts=2)
  r=audit.summarize_matrix(rows)['months']['2026-07']
  self.assertEqual(r['jobs_by_status']['blocked'],1);self.assertEqual(r['jobs_by_status']['pending'],61)
  self.assertEqual(r['blocked_jobs'][0]['error_code'],'INVALID_GSC_ROW_PAGE_ORIGIN')
 def test_weighted_position_and_total_ctr_are_not_averages_of_device_averages(self):
  r=audit.validate_facts(groups('page'),matrix(),'page')
  self.assertTrue(r['verified']);self.assertEqual(r['actual_source_rows'],60)
  self.assertAlmostEqual(r['totals']['ctr'],30/1100);self.assertAlmostEqual(r['totals']['position'],12200/1100)
  self.assertNotAlmostEqual(r['totals']['position'],7)
 def test_missing_day_wrong_count_invalid_source_or_duplicate_group_never_verify(self):
  cases=[]
  rows=groups('page');cases.append(rows[2:])
  rows=groups('page');rows[0]['actual_rows']=2;cases.append(rows)
  rows=groups('page');rows[0]['bad_rows']=1;cases.append(rows)
  rows=groups('page');rows[0]['dataset_id']='wrong';cases.append(rows)
  rows=groups('page');cases.append(rows+[rows[0]])
  for rows in cases:self.assertFalse(audit.validate_facts(rows,matrix(),'page')['verified'])
 def test_empty_complete_datasets_are_null_and_missing_rows_are_not_fake_zero(self):
  cover=matrix();rows=[]
  for r in cover:
   if r['scope']=='page' and r['day'].startswith('2026-09'):
    r['row_count']=0;rows.append(dict(day=r['day'],dataset_id=r['dataset_id'],row_count=0,device=None,actual_rows=0,clicks=None,impressions=None,weighted_position=None,bad_rows=0))
  result=audit.validate_facts(rows,cover,'page')
  self.assertTrue(result['verified']);self.assertIsNone(result['totals']);self.assertTrue(all(v is None for v in result['devices'].values()))
 def test_cache_staleness_does_not_become_a_metric_bug_or_current_report(self):
  row=dict(created_at=(NOW-timedelta(hours=3)).isoformat(),engine_version='1.2.2',period_start='2026-09-01',period_end='2026-09-30',previous_start='2026-08-01',previous_end='2026-08-31',missing_count=1,product_count=29,waiting_products=29,active_decisions=0)
  r=audit.cache_status([row],{},NOW,False)
  self.assertEqual(r['status'],'STALE_NOT_TREATED_AS_CURRENT');self.assertTrue(r['comparison_gate_valid']);self.assertFalse(r['panel_report_verified'])
  row.update(created_at=NOW.isoformat(),active_decisions=1,waiting_products=28)
  self.assertFalse(audit.cache_status([row],{},NOW,False)['comparison_gate_valid'])
 def test_page_and_query_totals_are_not_required_to_equal(self):
  c=Fake()
  for r in c.data['query']:r['clicks']=0;r['impressions']=1;r['weighted_position']=2
  r=collect(c);self.assertTrue(r['september_acceptance']['raw_metrics_verified'])
  self.assertNotEqual(r['september_metrics']['page']['totals'],r['september_metrics']['query']['totals'])

class RealSqlTests(unittest.TestCase):
 def test_sql_plans_and_counts_use_active_generations_without_mutating_existing_rows(self):
  db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row
  for path in sorted((ROOT/'migrations').glob('*.sql')):db.executescript(path.read_text())
  for day in range(1,31):
   date=f'2026-09-{day:02}'
   for scope in ('page','query'):
    dataset=f'{scope}:{date}'
    db.execute('INSERT INTO dataset_coverage VALUES(?,?,?,?,?,?,?,?,?)',('gsc',date,scope,dataset,1,int(scope=='query'),2,NOW.isoformat(),'TEST'))
    for device,clicks,impressions,position in [('MOBILE',20,1000,12),('DESKTOP',10,100,2)]:
     row=[dataset,date,'https://www.mavibasim.com/brosur']+(['TEST query'] if scope=='query' else [])+['tur',device]+([0] if scope=='query' else [])+[clicks,impressions,clicks/impressions,position]
     table='gsc_daily_by_page' if scope=='page' else 'gsc_daily_by_query_device'
     db.execute('INSERT INTO '+table+' VALUES('+','.join('?' for _ in row)+')',row)
  db.execute("INSERT INTO gsc_daily_by_page VALUES('TEST inactive','2026-09-01','https://mavibasim.com/brosur','tur','MOBILE',999,999,1,1)")
  db.commit();before=db.total_changes
  coverage=[dict(r) for r in db.execute(audit.SQL['matrix'])]
  self.assertEqual(audit.summarize_matrix(coverage)['completed'],60)
  for scope in ('page','query'):
   plan=' '.join(r['detail'] for r in db.execute(audit.SQL['plan_'+scope]))
   self.assertIn('SEARCH c USING COVERING INDEX coverage_active',plan)
   self.assertIn(f'SEARCH d USING INDEX gsc_{scope}_dates',plan)
   result=audit.validate_facts([dict(r) for r in db.execute(audit.SQL[scope])],coverage,scope)
   self.assertTrue(result['verified']);self.assertEqual(result['totals']['clicks'],900)
  for name in ['cache','revision','plan_cache']:list(db.execute(audit.SQL[name]))
  self.assertEqual(db.total_changes,before)

if __name__=='__main__':unittest.main()
