import io,json,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import production_guard as g
OLD='11111111-1111-1111-1111-111111111111'
NEW='22222222-2222-2222-2222-222222222222'
COMMIT='c'*40
class Client:
 account='a'*32
 def __init__(self,active=NEW,tag=COMMIT):self.active=active;self.tag=tag;self.calls=[]
 def request(self,method,path):
  assert method=='GET';self.calls.append(path)
  if path.endswith('/deployments'):return {'ok':True,'result':{'deployments':[{'versions':[{'version_id':self.active,'percentage':100}]}]}}
  return {'ok':True,'result':{'annotations':{'workers/tag':self.tag}}}
class Opener:
 def __init__(self,ids):self.ids=list(ids);self.calls=0
 def open(self,req,timeout):
  self.calls+=1;ident=self.ids.pop(0) if len(self.ids)>1 else self.ids[0]
  return io.BytesIO(json.dumps({'deployment':{'version_id':ident,'commit':COMMIT if ident==NEW else 'b'*40,'runtime_revision':'gsc-catchup-v1','read_guard_revision':'d1-account-reads-v1'}}).encode())
class Tests(unittest.TestCase):
 def test_old_edge_then_exact_active_version_passes_only_after_match(self):
  waits=[];op=Opener([OLD,NEW]);r=g.converged_smoke(Client(),COMMIT,OLD,op,waits.append)
  self.assertEqual(r['version_id'],NEW);self.assertEqual(waits,[5]);self.assertEqual(op.calls,2)
 def test_permanent_old_edge_stops_after_six_checks(self):
  waits=[];op=Opener([OLD])
  with self.assertRaisesRegex(ValueError,'CONVERGENCE_TIMEOUT'):g.converged_smoke(Client(),COMMIT,OLD,op,waits.append)
  self.assertEqual(op.calls,6);self.assertEqual(waits,[5]*5)
 def test_wrong_control_plane_source_is_immediate_failure(self):
  op=Opener([NEW])
  with self.assertRaisesRegex(ValueError,'ACTIVE_SOURCE_COMMIT_MISMATCH'):g.converged_smoke(Client(tag='d'*40),COMMIT,OLD,op,lambda _:self.fail('NO_WAIT'))
  self.assertEqual(op.calls,0)
 def test_unrelated_http_version_is_immediate_failure(self):
  with self.assertRaisesRegex(ValueError,'DEPLOYED_VERSION_MISMATCH'):g.converged_smoke(Client(),COMMIT,OLD,Opener(['33333333-3333-3333-3333-333333333333']),lambda _:self.fail('NO_WAIT'))
 def test_control_plane_can_converge_from_known_previous_only(self):
  client=Client(OLD,'b'*40);op=Opener([OLD,NEW]);waits=[]
  def wait(seconds):waits.append(seconds);client.active=NEW;client.tag=COMMIT
  self.assertEqual(g.converged_smoke(client,COMMIT,OLD,op,wait)['version_id'],NEW);self.assertEqual(waits,[5])
