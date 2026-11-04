import contextlib,io,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import gsc_history_acceptance as history
class HistoryTests(unittest.TestCase):
 def status(self,mode='status',complete=False,tick=None):return dict(ok=True,mode=mode,months=['2026-10','2026-09'],completed_scopes=122 if complete else 1,total_scopes=122,plan_complete=complete,storage_reserved_bytes=1,storage_limit_bytes=16777216,tick=tick,d1_requests=0,manual_csv_required=False)
 def month(self,m,complete=True):
  days=31 if m=='2026-10' else 30
  return dict(ok=True,mode='month',month=m,available=complete,days_verified=days if complete else 1,expected_days=days,query_days_verified=days if complete else 0,evidence_refs=days*2 if complete else 1,content_rows=100,chunk_reads=2,budget_limited=False,query_partial=True,source='GSC Search Analytics API',d1_requests=0)
 def test_both_real_content_months_are_required(self):
  for complete in (True,False):
   calls=[]
   def exchange(mode,m):
    calls.append(mode)
    return self.month(m,complete) if mode=='month' else self.status(mode,True)
   with contextlib.redirect_stdout(io.StringIO()):r=history.acceptance(exchange)
   self.assertEqual(r['verified'],complete);self.assertEqual(calls,['status','month','month'])
 def test_stops_source_holds_without_inventing_zero_or_repeating(self):
  def exchange(mode,m):return self.month(m,False) if mode=='month' else self.status(mode,tick={'status':'held','code':'GSC_HTTP_429','d1_requests':0} if mode=='tick' else None)
  with contextlib.redirect_stdout(io.StringIO()):r=history.acceptance(exchange)
  self.assertFalse(r['verified']);self.assertEqual(r['manual_ticks'],1);self.assertFalse(r['missing_days_are_zero'])
 def test_bounded_resumability_and_private_fields(self):
  def exchange(mode,m):return self.month(m,False) if mode=='month' else self.status(mode,tick={'status':'partial','d1_requests':0} if mode=='tick' else None)
  with contextlib.redirect_stdout(io.StringIO()):r=history.acceptance(exchange,3)
  self.assertEqual(r['manual_ticks'],3)
  for value in (True,201,-1):
   with self.assertRaises(ValueError):history.acceptance(exchange,value)
  r=self.status();r['raw_queries']=['private']
  with self.assertRaises(ValueError):history.sanitize(r,'status')
  r=self.status('tick',tick={'status':'held','raw':'private','d1_requests':0})
  with self.assertRaises(ValueError):history.sanitize(r,'tick')
 def test_read_only_live_analysis_audit_never_calls_a_collection_tick(self):
  calls=[]
  q=dict(source='GSC Search Analytics API',decision='Veri bekle',evidence_refs=61,periods=['2026-09','2026-10'],requires_ga4=True)
  def exchange(mode,m):
   calls.append(mode)
   if mode=='status':return self.status(complete=True)
   if mode=='month':return self.month(m)
   return dict(ok=True,mode='analysis',month=m,available=True,facet_counts=dict(pages=1,queries=2,products=1),devices=1,countries=1,evidence_refs=62,mapping_available=True,questions={k:dict(q) for k in ('performance','city','changes')},d1_requests=0)
  with contextlib.redirect_stdout(io.StringIO()):r=history.acceptance(exchange,0,verify_analysis=True)
  self.assertTrue(r['verified']);self.assertEqual(r['manual_ticks'],0);self.assertEqual(calls,['status','month','month','analysis','analysis'])
  bad=exchange('analysis','2026-10');bad['questions']['performance']['answer']='private source text'
  with self.assertRaises(ValueError):history.sanitize(bad,'analysis')
if __name__=='__main__':unittest.main()
