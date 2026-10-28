import io,sys,unittest,urllib.error
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import release_readiness as r
class Opener:
 def __init__(self,items):self.items=list(items);self.calls=0
 def open(self,request,timeout):
  self.calls+=1;x=self.items.pop(0)
  if isinstance(x,Exception):raise x
  return io.BytesIO(x)
class AccessTests(unittest.TestCase):
 def test_transient_failure_requires_real_success_on_second_read(self):
  c=Opener([TimeoutError(),b'{"ok":true}'])
  with patch.object(r.time,'sleep'):self.assertEqual(r.get_json(r.APP+'/api/health?read-guard=readiness',opener=c),{'ok':True})
  self.assertEqual(c.calls,2)
 def test_repeated_timeout_identifies_target_without_credentials(self):
  c=Opener([TimeoutError('PRIVATE'),TimeoutError('PRIVATE')])
  with patch.object(r.time,'sleep'),self.assertRaisesRegex(ValueError,'WORKER_HEALTH_TIMEOUT'):r.get_json(r.APP+'/api/health?read-guard=readiness',opener=c)
  self.assertEqual(c.calls,2)
 def test_auth_denial_and_redirect_are_never_retried(self):
  for status in (301,302,401,403):
   c=Opener([urllib.error.HTTPError('private',status,'private',{},None)])
   with self.assertRaisesRegex(ValueError,'GITHUB_MAIN_REF_HTTP_'+str(status)):r.get_json('https://api.github.com/repos/x/y/branches/main','PRIVATE',c)
   self.assertEqual(c.calls,1)
 def test_invalid_or_oversized_response_is_not_observation(self):
  for data in (b'not json',b'x'*2000001):
   with self.assertRaisesRegex(ValueError,'INVALID_JSON_OR_RESPONSE_LIMIT'):r.get_json('https://api.github.com/repos/x/y/actions/workflows/ci.yml/runs',opener=Opener([data]))
