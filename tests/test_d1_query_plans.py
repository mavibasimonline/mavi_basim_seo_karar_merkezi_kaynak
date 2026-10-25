"""Offline query-plan and migration proof. All GSC rows here are synthetic."""
import json,sqlite3,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class QueryPlanTests(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:')
  for p in sorted((ROOT/'migrations').glob('*.sql')):
   if p.name!='0005_d1_read_guard.sql':self.db.executescript(p.read_text())
  self.db.execute("INSERT INTO product_groups VALUES('test','TEST fixtures')")
  self.db.executemany('INSERT INTO products(id,group_id,name,source_folder,canonical_url) VALUES(?,?,?,?,?)',[(f'p{i}','test',f'TEST product {i}',f'test/{i}',f'https://mavibasim.com/p{i}') for i in range(29)])
  for day in range(1,31):
   date=f'2026-09-{day:02d}'
   self.db.executemany('INSERT INTO gsc_daily_by_page VALUES(?,?,?,?,?,?,?,?,?)',[(f'test-generation-{generation}-{day}',date,f'https://mavibasim.com/p{row}','tur','MOBILE',1,10,0.1,3) for generation in range(30) for row in range(10)])
   self.db.execute('INSERT INTO dataset_coverage VALUES(?,?,?,?,?,?,?,?,?)',('gsc',date,'page',f'test-generation-29-{day}',1,0,10,'2026-10-25','SYNTHETIC migration/query-plan test'))
 def migrated(self):self.db.executescript((ROOT/'migrations/0005_d1_read_guard.sql').read_text())
 def plan(self,sql):return ' | '.join(r[3] for r in self.db.execute('EXPLAIN QUERY PLAN '+sql))
 def steps(self,sql):
  steps=[0];self.db.set_progress_handler(lambda:steps.__setitem__(0,steps[0]+100) or 0,100)
  try:result=self.db.execute(sql).fetchall()
  finally:self.db.set_progress_handler(None,0)
  return result,steps[0]
 def test_new_migration_preserves_every_source_and_gsc_row(self):
  before=self.db.execute('SELECT count(*),sum(clicks),sum(impressions) FROM gsc_daily_by_page').fetchone();self.migrated();self.assertEqual(self.db.execute('SELECT count(*),sum(clicks),sum(impressions) FROM gsc_daily_by_page').fetchone(),before);self.assertEqual(self.db.execute('PRAGMA integrity_check').fetchone()[0],'ok');self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])
 def test_csv_source_count_already_has_a_primary_key_index(self):
  plan=self.plan('SELECT s.id,(SELECT count(*) FROM keyword_metric_observations o WHERE o.source_id=s.id) FROM keyword_sources s');self.assertIn('source_id=?',plan);self.assertNotIn('SCAN o',plan)
 def test_active_generation_scan_has_a_covering_metadata_search_and_bounded_data_lookup(self):
  self.migrated();sql="SELECT d.* FROM dataset_coverage c INDEXED BY coverage_active CROSS JOIN gsc_daily_by_page d WHERE c.provider='gsc' AND c.scope='page' AND c.complete=1 AND c.day BETWEEN '2026-09-01' AND '2026-09-30' AND d.dataset_id=c.dataset_id AND d.date=c.day ORDER BY d.date,d.page LIMIT 50001"
  plan=self.plan(sql);self.assertIn('COVERING INDEX coverage_active',plan);self.assertIn('SEARCH d',plan);self.assertNotIn('SCAN d',plan);rows=self.db.execute(sql).fetchall();self.assertEqual(len(rows),300);self.assertTrue(all(r[0].startswith('test-generation-29-') for r in rows))
 def test_product_canonical_already_has_a_unique_index_not_a_missing_index(self):
  plan=self.plan("SELECT p.id FROM products p WHERE p.canonical_url='https://mavibasim.com/p1'");self.assertIn('canonical_url=?',plan);self.assertNotIn('SCAN p',plan);self.migrated();indexes=self.db.execute('PRAGMA index_list(products)').fetchall();self.assertNotIn('product_canonical',[r[1] for r in indexes])
 def test_report_cache_index_covers_month_engine_device_and_time(self):
  self.migrated();plan=self.plan("SELECT result_json FROM analysis_runs WHERE month='2026-09' AND engine_version='1.2.2' AND json_extract(filters_json,'$.device') IS NULL ORDER BY created_at DESC LIMIT 1");self.assertIn('report_cache_lookup',plan);self.assertNotIn('TEMP B-TREE',plan)
 def test_costs_and_reservations_have_point_lookup_primary_keys(self):
  self.migrated()
  for table,where in [('d1_quota_state',"day='2026-10-26'"),('d1_quota_ledger',"day='2026-10-26'"),('d1_query_costs',"day='2026-10-26' AND fingerprint='test'")]:self.assertIn('SEARCH ',self.plan(f'SELECT * FROM {table} WHERE {where}'))
