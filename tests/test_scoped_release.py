import io,subprocess,sys,tempfile,unittest
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import scoped_release as scoped

class ScopedReleaseTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
  self.git('init','-q');self.git('config','user.email','fixture@example.invalid');self.git('config','user.name','Fixture')
  for path,value in [('public/index.html','UI stable'),('public/app.js','JS stable'),('src/crawler.ts','old crawler'),('package.json','{}'),('package-lock.json','{}'),('deploy/wrangler.production.jsonc','{}')]:self.write(path,value)
  self.commit('base');self.base=self.sha();self.git('checkout','-qb','release/pr28-cache-stability')
  for path,value in [('src/crawler.ts','reviewed crawler'),('tests/crawl-mapping-cache.test.ts','reviewed test'),('docs/CRAWL_MAPPING_CACHE_FIX.md','reviewed notes')]:self.write(path,value)
  self.commit('approved fix');self.source=self.sha();self.git('checkout','-qb','main')
  self.write('public/index.html','UNRELEASED UI');self.commit('main UI remains outside scoped package');self.main=self.sha()
 def tearDown(self):self.temp.cleanup()
 def git(self,*args):return subprocess.check_output(['git',*args],cwd=self.root,stderr=subprocess.DEVNULL)
 def sha(self):return self.git('rev-parse','HEAD').decode().strip()
 def write(self,path,value):p=self.root/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(value)
 def commit(self,message):self.git('add','.');self.git('commit','-qm',message)
 def test_reviewed_crawler_source_preserves_live_ui_even_if_main_has_unreleased_ui(self):
  r=scoped.validate_tree(self.root,self.source,self.main,self.base)
  self.assertTrue(r['ui_preserved_by_source_tree']);self.assertEqual(r['changed_files'],sorted(scoped.ALLOWED))
 def test_unknown_live_base_and_noncommit_input_fail_closed(self):
  for live in ('f'*40,'--help'):
   with self.assertRaises(ValueError):scoped.validate_tree(self.root,self.source,self.main,live)
 def test_unapproved_ui_edits_cannot_be_selected(self):
  self.git('checkout','-q',self.source);self.write('public/app.js','UNAPPROVED UI');self.commit('bad package')
  with self.assertRaisesRegex(ValueError,'UNREVIEWED_SOURCE_DIFF'):scoped.validate_tree(self.root,self.sha(),self.main,self.source)
 def test_main_fix_or_dependency_drift_is_rejected(self):
  for path in ['src/crawler.ts','package-lock.json']:
   self.git('checkout','-q',self.main);self.write(path,'drift');self.commit('drift')
   with self.assertRaises(ValueError):scoped.validate_tree(self.root,self.source,self.sha(),self.base)
 def test_exact_scoped_dispatch_ci_is_required_in_addition_to_main_ci(self):
  run={'head_sha':self.source,'head_branch':'release/pr28-cache-stability','event':'workflow_dispatch','status':'completed','conclusion':'success'}
  def check(r):return scoped.plan(self.root,self.source,self.main,{'commit':self.base},lambda path:{'workflow_runs':[r]})
  self.assertEqual(check(run)['source_commit'],self.source)
  for key,value in [('head_sha',self.main),('head_branch','other'),('event','pull_request'),('status','in_progress'),('conclusion','failure')]:
   bad={**run,key:value}
   with self.assertRaisesRegex(ValueError,'EXACT_SCOPED_CI'):check(bad)
 def test_actual_static_asset_bodies_must_match_selected_source(self):
  root=self.root;source=self.source
  class Opener:
   def __init__(self,bad=False):self.bad=bad
   def open(self,request,timeout):
    path='public/app.js' if '/app.js?' in request.full_url else 'public/index.html'
    data=subprocess.check_output(['git','show',source+':'+path],cwd=root)
    return io.BytesIO(b'WRONG' if self.bad else data)
  self.assertEqual(scoped.assets(root,source,Opener())['files'],2)
  with self.assertRaisesRegex(ValueError,'LIVE_ASSET_MISMATCH'):scoped.assets(root,source,Opener(True))
 def test_deployment_keeps_main_schema_quota_and_runtime_guards(self):
  root=Path(__file__).resolve().parents[1];s=(root/'.github/workflows/production.yml').read_text()
  self.assertIn("github.ref_name == 'main'",s);self.assertIn('verify-schema',s)
  self.assertNotIn('migrations apply',s);self.assertIn('production_guard.py preflight',s)
  self.assertIn('d1_quota_checkpoint.py',s);self.assertIn('wrangler rollback',s)
  self.assertIn('--tag "$RELEASE_SOURCE_COMMIT"',s)
 def test_drive_html_uses_the_real_canonical_route_without_following_redirects(self):
  import urllib.parse,urllib.error
  self.write('public/drive.html','private Drive connection page');self.commit('new Drive page');source=self.sha();root=self.root;seen=[]
  class Opener:
   def open(self,request,timeout):
    path=urllib.parse.urlparse(request.full_url).path;seen.append(path)
    if path=='/drive.html':raise urllib.error.HTTPError(request.full_url,307,'Temporary Redirect',{},None)
    name='public/drive.html' if path=='/drive' else 'public/app.js' if path=='/app.js' else 'public/index.html'
    return io.BytesIO(subprocess.check_output(['git','show',source+':'+name],cwd=root))
  self.assertEqual(scoped.assets(root,source,Opener())['files'],3)
  self.assertIn('/drive',seen);self.assertNotIn('/drive.html',seen)
 def test_drive_release_excludes_other_main_ui_and_index_changes_and_rejects_unreviewed_files(self):
  self.git('checkout','-q',self.base);self.write('src/index.ts','existing\n');self.commit('performance base');base=self.sha()
  self.git('checkout','-qb','drive-review');self.write('public/index.html','unreleased main UI');self.write('src/index.ts','existing\nunreleased\n');self.commit('main review base');review=self.sha()
  self.git('checkout','-qb','release/drive-archive-only',base)
  for path in scoped.DRIVE_ALLOWED:self.write(path,'existing\ndrive\n' if path=='src/index.ts' else 'drive '+path)
  self.commit('isolated Drive source');source=self.sha()
  self.git('checkout','-q','drive-review')
  for path in scoped.DRIVE_ALLOWED:self.write(path,'existing\ndrive\nunreleased\n' if path=='src/index.ts' else 'drive '+path)
  self.commit('reviewed Drive changes');main=self.sha()
  with patch.object(scoped,'DRIVE_SOURCE',source),patch.object(scoped,'PERFORMANCE_SOURCE',base),patch.object(scoped,'DRIVE_REVIEW_BASE',review):
   result=scoped.validate_tree(self.root,source,main,base)
   self.assertTrue(result['ui_preserved_by_source_tree']);self.assertEqual(set(result['changed_files']),scoped.DRIVE_ALLOWED)
   run={'head_sha':source,'head_branch':'release/drive-archive-only','event':'workflow_dispatch','status':'completed','conclusion':'success'}
   self.assertEqual(scoped.plan(self.root,source,main,{'commit':base},lambda _: {'workflow_runs':[run]})['source_commit'],source)
   self.write('src/google.ts','unreviewed OAuth');self.commit('drift')
   with self.assertRaisesRegex(ValueError,'APPROVED_FILE_MISMATCH'):scoped.validate_tree(self.root,source,self.sha(),base)

if __name__=='__main__':unittest.main()
