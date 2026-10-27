import copy,json,sqlite3,subprocess,sys,unittest
from datetime import datetime,timedelta,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import september_refresh as op

NOW=datetime(2026,10,27,10,0,tzinfo=timezone.utc)
def snapshot():
 return {'status':'observed','production_lease_valid':True,'rows_written':0,'september_acceptance':{'raw_metrics_verified':True},
 'quota':[{'valid_until':(NOW+timedelta(minutes=30)).isoformat()}],'ledger':[{'reads':20000,'writes':3000}],
 'account_usage':{'account_reads':100000,'account_writes':5000},'crons':['*/15 * * * *'],'runtime_flags':{'D1_READ_GUARD_ENABLED':'true'},
 'coverage':{'months':{'2026-08':{'completed':50}}},'september_metrics':{'page':{'totals':{'clicks':30,'impressions':1100,'ctr':30/1100,'position':12200/1100}}}}
def payload():
 return {'report_attempts':1,'kpi_attempts':1,'report':{'month':'2026-09','id':'TEST','created_at':NOW.isoformat(),
 'filters':{'device':None},'period':{'start':'2026-09-01','end':'2026-09-30'},'missing':['August incomplete'],'products':[{'id':str(i),'decision':'Veri bekle'} for i in range(29)]},
 'kpi':{'period':{'start':'2026-09-01','end':'2026-09-30'},'device':None,'range_months':1,'measured_at':NOW.isoformat(),
 'current':snapshot()['september_metrics']['page']['totals'],'archive':{'csv_files':521,'csv_rows':9075},'coverage':{'verified_days':30,'invalid_days':[]},'comparison_available':False}}

class RefreshTests(unittest.TestCase):
 def test_snapshot_requires_real_lease_and_enough_time_not_just_unused_account_quota(self):
  op.require_snapshot(snapshot(),NOW)
  for valid,minutes in [(False,30),(True,-1),(True,5)]:
   value=snapshot();value['production_lease_valid']=valid;value['quota'][0]['valid_until']=(NOW+timedelta(minutes=minutes)).isoformat()
   with self.assertRaises(ValueError):op.require_snapshot(value,NOW)
 def test_snapshot_preserves_account_local_and_cron_guards(self):
  for field in ['quota','local','cron','read_guard','raw']:
   value=snapshot()
   if field=='quota':value['account_usage']['account_reads']=1900000
   if field=='local':value['ledger'][0]['writes']=80000
   if field=='cron':value['crons']=['* * * * *']
   if field=='read_guard':value['runtime_flags']['D1_READ_GUARD_ENABLED']='false'
   if field=='raw':value['september_acceptance']['raw_metrics_verified']=False
   with self.assertRaises(ValueError):op.require_snapshot(value,NOW)
 def test_weighted_metrics_and_incomplete_august_are_independently_checked(self):
  self.assertTrue(op.verify_payload(payload(),snapshot())['raw_kpi_metrics_match'])
  for key,wrong in [('ctr',0.15),('position',7),('clicks',31),('impressions',1000)]:
   value=payload();value['kpi']['current'][key]=wrong
   with self.assertRaisesRegex(ValueError,'METRIC_MISMATCH'):op.verify_payload(value,snapshot())
 def test_incomplete_comparison_and_unsafe_seo_decisions_are_rejected(self):
  for change in ['comparison','decision','missing','attempt','month']:
   value=payload()
   if change=='comparison':value['kpi']['comparison_available']=True
   if change=='decision':value['report']['products'][0]['decision']='İncele'
   if change=='missing':value['report']['missing']=[]
   if change=='attempt':value['report_attempts']=2
   if change=='month':value['report']['month']='2026-10'
   with self.assertRaises(ValueError):op.verify_payload(value,snapshot())
 def test_narrow_saved_product_checks_preserve_unobserved_null_and_weighted_position(self):
  products=[{'product_id':str(i),'current_metrics':None} for i in range(29)]
  sources=[{'product_id':'0','clicks':30,'impressions':1100,'weighted':12200}]
  products[0]['current_metrics']=json.dumps(dict(clicks=30,impressions=1100,ctr=30/1100,position=12200/1100))
  self.assertTrue(op.verify_product_rows(products,sources))
  products[0]['current_metrics']=json.dumps(dict(clicks=30,impressions=1100,ctr=30/1100,position=7))
  with self.assertRaises(ValueError):op.verify_product_rows(products,sources)
  products[0]['current_metrics']=json.dumps(dict(clicks=30,impressions=1100,ctr=30/1100,position=12200/1100))
  products[1]['current_metrics']=json.dumps(dict(clicks=0,impressions=0,ctr=None,position=None))
  with self.assertRaises(ValueError):op.verify_product_rows(products,sources)
 def test_saved_verification_projects_fields_instead_of_reading_full_large_json(self):
  for sql in (op.SAVED_REPORT,op.SAVED_PRODUCTS,op.SAVED_KPI):
   self.assertNotIn('SELECT result_json',sql);self.assertIn('json_',sql)
 def test_json_size_diagnostic_counts_utf8_bytes_instead_of_turkish_characters(self):
  c=sqlite3.connect(':memory:');c.row_factory=sqlite3.Row
  for p in sorted((ROOT/'migrations').glob('*.sql')):c.executescript(p.read_text())
  value=json.dumps({'period':{},'filters':{'device':None},'missing':['Türkçe ölçüm']},ensure_ascii=False)
  c.execute('INSERT INTO analysis_runs VALUES(?,?,?,?,?,?)',('TEST','2026-09','1.2.2',NOW.isoformat(),'{"device":null}',value))
  result=dict(c.execute(op.SAVED_REPORT).fetchone())
  self.assertEqual(result['result_bytes'],len(value.encode('utf-8')))
  self.assertGreater(result['result_bytes'],len(value))
 def test_receipt_only_public_key_can_encrypt_but_wrong_private_key_and_tampering_fail(self):
  code="""import {generateKeyPairSync} from 'node:crypto';
import {seal,open} from './scripts/operator-receipt.mjs';
const a=generateKeyPairSync('rsa',{modulusLength:2048}),b=generateKeyPairSync('rsa',{modulusLength:2048});
const data=Buffer.from('PRIVATE TEST RECEIPT'),sealed=seal(data,a.publicKey);
if(sealed.includes(data.toString())||!open(sealed,a.privateKey).equals(data))process.exit(1);
for(const [value,key] of [[sealed,b.privateKey],[JSON.stringify({...JSON.parse(sealed),data:'bad'}),a.privateKey]]){
let rejected=false;try{open(value,key);}catch{rejected=true;}if(!rejected)process.exit(2);}
"""
  subprocess.run(['node','--input-type=module','-e',code],cwd=ROOT,check=True,capture_output=True)

if __name__=='__main__':unittest.main()
