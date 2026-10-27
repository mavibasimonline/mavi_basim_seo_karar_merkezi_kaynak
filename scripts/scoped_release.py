"""Narrow PR28 source selection; keep existing main CI/runtime/rollback gates.

This does not deploy. It proves that the selected source is the live commit plus
only the reviewed crawler change, with exactly the same static UI and bindings.
"""
import hashlib,json,os,re,subprocess,urllib.parse,urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
ALLOWED={'src/crawler.ts','tests/crawl-mapping-cache.test.ts','docs/CRAWL_MAPPING_CACHE_FIX.md'}
PR30_SOURCE='f888618954a49f0117ac1dfbd1d43ea80393a03b'
PR30_BASE='20da9ba512b29b2844559f070d0db4c1b1c62f6c'
PR30_REVIEW='93afeb06706351150b87b0138a0418ecfbb1839b'
PR30_ALLOWED={'src/d1-read-budget.ts','src/index.ts','tests/d1-read-budget.test.ts','docs/D1_INTERACTIVE_AVAILABILITY.md'}
PARITY=('package.json','package-lock.json','deploy/wrangler.production.jsonc')
APP='https://mavi-basim-seo-prod.mavibasimonline.workers.dev'

def git(root,*args):return subprocess.check_output(['git',*args],cwd=root,stderr=subprocess.DEVNULL)
def require(value,code):
 if not value:raise ValueError(code)

def validate_tree(root,source,main,live):
 for sha in (source,main,live):require(bool(re.fullmatch('[a-f0-9]{40}',sha or '')),'SCOPED_INVALID_COMMIT')
 parents=git(root,'rev-list','--parents','-n','1',source).decode().split()[1:]
 require(len(parents)==1,'SCOPED_SINGLE_PARENT_REQUIRED');base=parents[0]
 require(live in (base,source),'SCOPED_LIVE_BASE_CHANGED')
 changed=set(git(root,'diff','--name-only',base,source).decode().splitlines())
 if source==PR30_SOURCE:
  require(base==PR30_BASE,'SCOPED_PR30_BASE_MISMATCH')
  require(changed==PR30_ALLOWED,'SCOPED_UNREVIEWED_SOURCE_DIFF')
  for path in sorted(PR30_ALLOWED):
   require(git(root,'show',main+':'+path)==git(root,'show',PR30_REVIEW+':'+path),'SCOPED_APPROVED_FILE_MISMATCH')
  for path in PR30_ALLOWED-{'src/index.ts'}:
   require(git(root,'show',source+':'+path)==git(root,'show',PR30_REVIEW+':'+path),'SCOPED_APPROVED_FILE_MISMATCH')
 else:require(changed==ALLOWED,'SCOPED_UNREVIEWED_SOURCE_DIFF')
 for path in sorted(ALLOWED if source!=PR30_SOURCE else []):require(git(root,'show',source+':'+path)==git(root,'show',main+':'+path),'SCOPED_APPROVED_FILE_MISMATCH')
 for path in PARITY:require(git(root,'show',source+':'+path)==git(root,'show',main+':'+path),'SCOPED_CONFIG_OR_DEPENDENCY_DRIFT')
 return {'source_commit':source,'main_commit':main,'base_commit':base,'changed_files':sorted(changed),'ui_preserved_by_source_tree':True}

def plan(root,source,main,live,github):
 result=validate_tree(root,source,main,live['commit'])
 runs=github('/actions/workflows/ci.yml/runs?event=workflow_dispatch&head_sha='+source+'&per_page=20').get('workflow_runs',[])
 require(any(r.get('head_sha')==source and r.get('head_branch')==('release/pr30-interactive-only' if source==PR30_SOURCE else 'release/pr28-cache-stability') and r.get('event')=='workflow_dispatch' and r.get('status')=='completed' and r.get('conclusion')=='success' for r in runs),'SUCCESSFUL_EXACT_SCOPED_CI_REQUIRED')
 return result

def assets(root,source,opener=None):
 require(bool(re.fullmatch('[a-f0-9]{40}',source or '')),'SCOPED_INVALID_COMMIT')
 paths=git(root,'ls-tree','-r','--name-only',source,'public').decode().splitlines()
 require(0<len(paths)<=50,'SCOPED_ASSET_MANIFEST_REQUIRED')
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*args,**kwargs):return None
 opener=opener or urllib.request.build_opener(NoRedirect)
 for path in paths:
  require(path.startswith('public/') and '..' not in path,'SCOPED_ASSET_PATH')
  target='/' if path=='public/index.html' else '/'+urllib.parse.quote(path.removeprefix('public/'),safe='/')
  request=urllib.request.Request(APP+target+'?source-parity='+source,headers={'User-Agent':'MaviBasimScopedRelease/1.0','Accept-Encoding':'identity'})
  with opener.open(request,timeout=20) as response:data=response.read(1_500_001)
  require(len(data)<=1_500_000 and data==git(root,'show',source+':'+path),'SCOPED_LIVE_ASSET_MISMATCH')
 return {'verified':True,'files':len(paths),'database_queries':0}

def stage(root,source,main):
 require(bool(re.fullmatch('[a-f0-9]{40}',source or '')),'SCOPED_INVALID_COMMIT')
 if source==main:return str(Path(root).resolve())
 validate_tree(root,source,main,git(root,'rev-parse',source+'^').decode().strip())
 folder=Path(root)/'.local/release-source'
 require(not folder.exists(),'SCOPED_STAGE_ALREADY_EXISTS')
 subprocess.run(['git','worktree','add','--detach',str(folder),source],cwd=root,check=True,capture_output=True)
 (folder/'node_modules').symlink_to(Path(root)/'node_modules',target_is_directory=True)
 return str(folder.resolve())

if __name__=='__main__':
 import sys
 try:
  mode=sys.argv[1];source=os.environ.get('RELEASE_SOURCE_COMMIT');main=os.environ.get('GITHUB_SHA')
  if mode=='stage':
   directory=stage(ROOT,source,main)
   with open(os.environ['GITHUB_ENV'],'a') as out:out.write('RELEASE_SOURCE_DIR='+directory+'\n')
  elif mode=='assets':print(json.dumps(assets(ROOT,source)))
  else:raise ValueError('SCOPED_INVALID_MODE')
 except Exception as error:
  code=str(error) if isinstance(error,ValueError) and re.fullmatch('[A-Z_]+',str(error)) else type(error).__name__
  raise SystemExit('SCOPED_RELEASE_FAILED:'+code)
