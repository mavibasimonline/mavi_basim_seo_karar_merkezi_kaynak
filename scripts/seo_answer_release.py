"""Publish only read-only SEO answer logic; never collect or modify source datasets."""
import json,os,re,secrets,subprocess,time,urllib.request,urllib.error
from datetime import datetime,timezone
from zoneinfo import ZoneInfo
from cloudflare_diagnostics import Cloudflare
from quota_observer_release import api,free_plan
from release_readiness import get_json,REPOSITORY
from independent_seo_release import APP,ARCHIVE,ROOT,snapshot,deploy,rollback,verify_active_source,url_json,need,git
BASE='c421e2dd2e582950e48730a119eaf540d94dbbde'
APP_SOURCE='35121b40966707e107bde67dd2bcd8766ccb67d9'
TITLE='release: verified GSC history bootstrap 20261104'
EXPECTED={'.github/workflows/independent-seo-release.yml','src/independent-gsc-analysis.ts','src/independent-seo-model.ts','src/independent-product-answer.ts','src/drive-independent.ts','scripts/seo-answer-probe.ts','scripts/seo_answer_release.py'}
PROTECTED=('src/index.ts','src/independent-session.ts','src/security.ts','src/drive-broker.ts','src/independent-gsc.ts','src/independent-gsc-bridge.ts','src/independent-gsc-bootstrap.ts','src/independent-gsc-report.ts','src/independent-ga4.ts','src/independent-context.ts','src/independent-context-bridge.ts','src/d1-read-budget.ts','public/app.js','public/independent-seo.js','deploy/wrangler.monthly-app.jsonc','deploy/wrangler.drive-archive.jsonc')

def run():
 sha=os.environ.get('GITHUB_SHA','')
 need(os.environ.get('GITHUB_REF')=='refs/heads/main' and os.environ.get('GITHUB_REPOSITORY')==REPOSITORY,'SEO_ANSWER_MAIN_REQUIRED')
 need(re.fullmatch('[a-f0-9]{40}',sha) and git('rev-parse','HEAD')==sha and git('log','-1','--format=%s')==TITLE,'SEO_ANSWER_SOURCE_REQUIRED')
 need(git('rev-parse','HEAD^')==BASE and set(git('diff','--name-only','HEAD^','HEAD').splitlines())==EXPECTED,'SEO_ANSWER_REVIEWED_SCOPE_REQUIRED')
 for path in PROTECTED:need(subprocess.check_output(['git','show',BASE+':'+path],cwd=ROOT)==(ROOT/path).read_bytes(),'SEO_ANSWER_PROTECTED_SOURCE_CHANGED')
 old_router=subprocess.check_output(['git','show',BASE+':src/drive-independent.ts'],cwd=ROOT).decode()
 new_router=(ROOT/'src/drive-independent.ts').read_text()
 imports="import {questionProduct,answerProductEvidence,answerGa4Product} from './independent-product-answer';\nimport {variantFamily} from './urls';\n"
 trimmed=new_router.replace(imports,'')
 marker='   let questionBody:';end='   const snapshot=await this.independentSnapshot();'
 need(old_router.split(marker,1)[0]==trimmed.split(marker,1)[0] and old_router.split(marker,1)[1].split(end,1)[1]==trimmed.split(marker,1)[1].split(end,1)[1],'SEO_ANSWER_COLLECTOR_ROUTER_CHANGED')
 need(get_json('https://api.github.com/repos/'+REPOSITORY+'/branches/main',os.environ.get('GITHUB_TOKEN')).get('commit',{}).get('sha')==sha,'SEO_ANSWER_MAIN_SUPERSEDED')
 runs=get_json('https://api.github.com/repos/'+REPOSITORY+'/actions/workflows/ci.yml/runs?head_sha='+sha+'&per_page=20',os.environ.get('GITHUB_TOKEN')).get('workflow_runs',[])
 need(any(r.get('head_sha')==sha and r.get('head_branch')=='main' and r.get('event')=='push' and r.get('conclusion')=='success' for r in runs),'SEO_ANSWER_GREEN_CI_REQUIRED')
 client=Cloudflare(os.environ.get('CLOUDFLARE_API_TOKEN'),os.environ.get('CLOUDFLARE_ACCOUNT_ID'));free_plan(api(client,'GET','/subscriptions'))
 before={w:snapshot(client,w) for w in (APP,ARCHIVE)}
 need(before[APP]['crons']==['*/15 * * * *'] and url_json('https://mavi-basim-seo-prod.mavibasimonline.workers.dev/api/health').get('deployment',{}).get('commit')==APP_SOURCE,'SEO_ANSWER_APP_DRIFT')
 folder=ROOT/'.local/seo-answer';folder.mkdir(parents=True,exist_ok=True);folder.chmod(0o700)
 key=secrets.token_hex(32);secret=folder/'.dev.vars';secret.write_text('PROBE_KEY='+key+'\n');secret.chmod(0o600)
 cfg=folder/'wrangler.jsonc';cfg.write_text(json.dumps({'name':APP,'main':str(ROOT/'scripts/seo-answer-probe.ts'),'compatibility_date':'2026-10-01','workers_dev':False,'preview_urls':False,'unsafe':{'bindings':[{'name':'ADMIN_TOKEN','type':'inherit'}]},'services':[{'binding':'LIVE_APP','service':APP,'environment':'production'}]}));cfg.chmod(0o600)
 preview=None;deployed=False
 try:
  with (folder/'runtime.log').open('w') as logs:
   preview=subprocess.Popen(['node','scripts/run.mjs','wrangler','dev','--remote','--config',str(cfg),'--ip','127.0.0.1','--port','8806','--log-level','error'],cwd=ROOT,stdout=logs,stderr=logs)
   def exchange(path,method='POST'):
    req=urllib.request.Request('http://127.0.0.1:8806'+path,method=method,data=b'{}' if method=='POST' else None,headers={'Authorization':'Bearer '+key,'User-Agent':'MaviBasimReleaseCheck/1.0','Accept':'application/json','Content-Type':'application/json'})
    try:
     with urllib.request.urlopen(req,timeout=45) as response:
      value=json.loads(response.read(16384));need(isinstance(value,dict),'SEO_ANSWER_RESPONSE_INVALID');return value
    except urllib.error.HTTPError as error:
     try:code=json.loads(error.read(8192)).get('code')
     except (ValueError,AttributeError):code=None
     raise ValueError(code if isinstance(code,str) and re.fullmatch('SEO_ANSWER_[A-Z0-9_]+',code) else 'SEO_ANSWER_PREVIEW_FAILED') from None
   for _ in range(40):
    need(preview.poll() is None,'SEO_ANSWER_PREVIEW_CRASHED')
    try:
     if exchange('/health','GET').get('admin_configured'):break
    except (OSError,ValueError):pass
    time.sleep(1)
   else:raise ValueError('SEO_ANSWER_PREVIEW_NOT_READY')
   original=exchange('/before');print(json.dumps({'seo_answer_before':original}),flush=True)
   deployed=True;deploy('deploy/wrangler.drive-archive.jsonc',sha)
   after=snapshot(client,ARCHIVE);verify_active_source(client,ARCHIVE,after['version'],sha)
   need(after['bindings']==before[ARCHIVE]['bindings'] and after['crons']==before[ARCHIVE]['crons'] and snapshot(client,APP)==before[APP],'SEO_ANSWER_CONFIGURATION_CHANGED')
   proof=exchange('/accept');need(proof.get('verified') is True,'SEO_ANSWER_ACCEPTANCE_FAILED')
   need(snapshot(client,APP)==before[APP] and snapshot(client,ARCHIVE)==after,'SEO_ANSWER_PRODUCTION_DRIFT')
   print(json.dumps({'seo_answer_release':{'deployed':True,'source':sha,'archive_version':after['version'],'app_unchanged':True,'cron_unchanged':True,'source_datasets_unchanged':True,'proof':proof,'d1_requests':0,'new_billed_resources':False,'site_changed':False}}),flush=True)
 except Exception:
  if deployed:rollback('deploy/wrangler.drive-archive.jsonc',before[ARCHIVE]['version']);need(snapshot(client,ARCHIVE)==before[ARCHIVE],'SEO_ANSWER_ROLLBACK_FAILED')
  raise
 finally:
  if preview is not None:
   preview.terminate()
   try:preview.wait(timeout=6)
   except subprocess.TimeoutExpired:preview.kill()
  cfg.unlink(missing_ok=True);secret.unlink(missing_ok=True)
if __name__=='__main__':
 try:run()
 except Exception as error:
  code=str(error);print('SEO_ANSWER_STOPPED:'+(code if re.fullmatch('[A-Z0-9_]{1,100}',code) else 'SEO_ANSWER_UNAVAILABLE'),flush=True);raise SystemExit(1)
