import copy
import contextlib
import io
import sys
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import gsc_pipeline_acceptance as pipeline

class PipelineAcceptanceTests(unittest.TestCase):
 def status(self,n=0):
  rows=[dict(day=f'2026-10-{31-i//2:02}',scope='page' if i%2==0 else 'query',rows=3,captured_at='2026-11-04T07:15:00Z',query_partial=bool(i%2)) for i in range(n)]
  return dict(connected=True,reauthorization_required=False,coverage=rows,covered_scopes=n,expected_scopes=14,last_attempt=None,pending=None,d1_requests=0)
 def reply(self,mode,n=0,**meta):return dict(ok=True,mode=mode,observed_at='2026-11-04T07:16:00Z',status=self.status(n),d1_requests=0,**meta)
 def collect(self,n=0,status='complete',ticks=4):return self.reply('collect',n,manual_ticks=ticks,attempts=[dict(status=status,d1_requests=0) for _ in range(ticks)])
 def recover(self,n=0):return self.reply('recover',n,recovery_candidates=0,released_scopes=0,recoveries=[])
 def diagnostic(self,ok=True):return self.reply('diagnostic',diagnostic=dict(at='2026-11-04T07:16:00Z',revision='daily-proof-v2',status='complete' if ok else 'held',ok=ok,day='2026-11-01',scope='page',rows=80 if ok else 0,d1_requests=0,**({} if ok else {'code':'GSC_TOKEN_STORAGE_UNREADABLE'})))
 def readback(self,n=14):return self.reply('readback',n,readbacks=[dict(available=True,verified=True,day=r['day'],scope=r['scope'],rows=r['rows'],pages=1,d1_requests=0) for r in self.status(n)['coverage']],content_verified_scopes=n,nonempty_content_scopes=n)
 def accept(self,exchange,max_ticks=32):
  with contextlib.redirect_stdout(io.StringIO()):return pipeline.acceptance(exchange,max_ticks)

 def test_old_collector_response_cannot_start_runtime_mutations(self):
  self.assertFalse(pipeline.collector_ready({'status':{'connected':True,'coverage':[]}}))
  self.assertFalse(pipeline.collector_ready({'status':{'held':[],'tick_count':'old','backfill_index':0,'storage_budget':{}}}))
  self.assertTrue(pipeline.collector_ready({'status':{'held':[],'tick_count':0,'backfill_index':0,'storage_budget':{}}}))

 def test_requires_all14_real_content_proofs_and_nonempty_page_and_query(self):
  calls=[]
  def exchange(mode,ticks):
   calls.append((mode,ticks))
   if mode=='status':return self.reply(mode)
   if mode=='diagnostic':return self.diagnostic()
   if mode=='recover':return self.recover()
   if mode=='collect':return self.collect(14)
   return self.readback()
  result=self.accept(exchange)
  self.assertTrue(result['passed']);self.assertEqual(result['manual_ticks'],4)
  self.assertEqual(calls,[('status',0),('diagnostic',0),('recover',0),('collect',4),('readback',0)])
  self.assertFalse(result['missing_days_are_zero'])

 def test_stops_on_held_without_inventing_missing_data(self):
  calls=[]
  def exchange(mode,ticks):
   calls.append(mode)
   return self.reply(mode) if mode=='status' else self.diagnostic() if mode=='diagnostic' else self.recover() if mode=='recover' else self.collect(1,'held',1)
  result=self.accept(exchange)
  self.assertFalse(result['passed']);self.assertEqual(result['manual_ticks'],1);self.assertEqual(result['after']['covered_scopes'],1)
  self.assertNotIn('readback',calls)

 def test_total_collection_never_exceeds32ticks(self):
  calls=[]
  def exchange(mode,ticks):
   calls.append((mode,ticks))
   return self.reply(mode) if mode=='status' else self.diagnostic() if mode=='diagnostic' else self.recover() if mode=='recover' else self.collect(0,'partial',ticks)
  result=self.accept(exchange)
  self.assertFalse(result['passed']);self.assertEqual(result['manual_ticks'],32)
  self.assertEqual(sum(ticks for mode,ticks in calls),32)
  for value in (True,-1,33,'32'):
   with self.assertRaises(ValueError):self.accept(exchange,value)

 def test_token_and_provider_bodies_never_pass_sanitization(self):
  for location in ('root','status','attempt','recovery','readback'):
   response=self.reply('status')
   if location=='root':response['access_token']='private'
   if location=='status':response['status']['raw']='private'
   if location=='attempt':response=self.collect();response['attempts'][0]['body']='private'
   if location=='recovery':response=self.recover();response['recoveries']=[dict(day='2026-10-31',scope='page',code='GSC_HTTP_400',until='2026-11-04T23:00:00Z',released=True,body='private')];response['recovery_candidates']=response['released_scopes']=1
   if location=='readback':response=self.readback();response['readbacks'][0]['rows_data']=['private']
   with self.subTest(location=location),self.assertRaises(ValueError):pipeline.sanitize_response(response,response['mode'])

 def test_no_rate_limit_or_oauth_hold_can_be_recovered(self):
  for code in ('GSC_HTTP_429','GSC_HTTP_503','GSC_OAUTH_RECONNECT_REQUIRED'):
   response=self.recover();response['recoveries']=[dict(day='2026-10-31',scope='page',code=code,until='2026-11-04T23:00:00Z',released=True)];response['recovery_candidates']=response['released_scopes']=1
   with self.assertRaises(ValueError):pipeline.sanitize_response(response,'recover')

 def test_missing_readback_or_fabricated_count_cannot_pass(self):
  for mode in ('missing','duplicate','count'):
   response=self.readback()
   if mode=='missing':response['readbacks'][0]['verified']=False
   if mode=='duplicate':response['readbacks'][1]=copy.deepcopy(response['readbacks'][0])
   if mode=='count':response['content_verified_scopes']=15
   with self.assertRaises(ValueError):pipeline.sanitize_response(response,'readback')

 def test_requests_require_private_auth_and_exact_bounded_mode(self):
  req=pipeline.request('fixture-key','collect',4)
  self.assertEqual(req.get_header('Authorization'),'Bearer fixture-key')
  self.assertEqual(req.method,'POST');self.assertEqual(req.data,b'{"ticks": 4}')
  for mode,ticks in [('delete',0),('collect',0),('collect',5),('collect',True),('status',1)]:
   with self.assertRaises(ValueError):pipeline.request('fixture',mode,ticks)

 def test_real_diagnostic_failure_is_logged_without_releasing_holds_or_collecting(self):
  calls=[]
  def exchange(mode,ticks):
   calls.append(mode);return self.reply(mode) if mode=='status' else self.diagnostic(False)
  result=self.accept(exchange)
  self.assertFalse(result['passed']);self.assertEqual(result['reason'],'GSC_PIPELINE_DIAGNOSTIC_FAILED')
  self.assertEqual(result['diagnostic']['diagnostic']['code'],'GSC_TOKEN_STORAGE_UNREADABLE')
  self.assertEqual(calls,['status','diagnostic']);self.assertIsNone(result['recovery'])

 def test_diagnostic_cannot_leak_tokens_or_claim_an_unknown_runtime_revision(self):
  for field,value in [('revision','unknown'),('raw','private'),('ok','true')]:
   response=self.diagnostic();response['diagnostic'][field]=value
   with self.assertRaises(ValueError):pipeline.sanitize_response(response,'diagnostic')

if __name__=='__main__':unittest.main()
