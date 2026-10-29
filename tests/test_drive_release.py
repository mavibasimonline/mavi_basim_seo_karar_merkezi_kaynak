import io,json,sys,unittest,urllib.error
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from drive_release import verify_owner_boundary

class DriveOwnerBoundaryTests(unittest.TestCase):
 def test_real_release_headers_require_both_anonymous_endpoints_to_return_the_owner_login_json(self):
  seen=[]
  class Opener:
   def open(self,request,timeout):
    seen.append(request)
    if request.get_header('User-agent')!='MaviBasimReleaseCheck/1.0':raise urllib.error.HTTPError(request.full_url,403,'Forbidden',{},io.BytesIO(b'network denial'))
    raise urllib.error.HTTPError(request.full_url,401,'Unauthorized',{},io.BytesIO(json.dumps({'error':'Giriş yapmanız gerekiyor.'}).encode()))
  self.assertTrue(verify_owner_boundary(Opener()))
  self.assertEqual([r.get_method() for r in seen],['GET','POST'])
  self.assertTrue(all(not r.has_header('Authorization') and not r.has_header('Cookie') for r in seen))
 def test_public_success_proxy_denial_redirect_and_fake_unauthorized_are_all_rejected(self):
  for status,body in [(200,{}),(403,{}),(307,{}),(401,{'error':'proxy denial'}),(401,{}),(401,None)]:
   class Opener:
    def open(self,request,timeout):
     raw=b'not JSON' if body is None else json.dumps(body).encode()
     if status==200:return io.BytesIO(raw)
     raise urllib.error.HTTPError(request.full_url,status,'fixture',{},io.BytesIO(raw))
   with self.subTest(status=status,body=body),self.assertRaises(ValueError):verify_owner_boundary(Opener())

if __name__=='__main__':unittest.main()
