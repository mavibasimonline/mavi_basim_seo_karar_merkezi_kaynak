"""Restore the professional shell over stored independent evidence; preserve all collectors."""
import json,os,re,secrets,subprocess,time,urllib.request,urllib.error
from datetime import datetime,timezone
from zoneinfo import ZoneInfo
from cloudflare_diagnostics import Cloudflare
from quota_observer_release import api,free_plan
from release_readiness import get_json,REPOSITORY
from independent_seo_release import APP,ARCHIVE,ROOT,snapshot,app_config,deploy,rollback,verify_active_source,url_json,http,need,git
from login_access_release import live_acceptance
BASE='9288b5a9e3b21640f9267d8085cdc8449957407e'
APP_SOURCE='35121b40966707e107bde67dd2bcd8766ccb67d9'
TITLE='release: verified GSC history bootstrap 20261104'
EXPECTED={'scripts/seo-answer-probe.ts','scripts/seo_answer_release.py','package.json','public/index.html','public/app.js','public/app.css','public/unified-seo.js','src/browser/unified-seo-panel.js','src/index.ts','src/drive-independent.ts','src/independent-gsc-report.ts'}
PROTECTED=('src/independent-session.ts','src/security.ts','src/independent-gsc-analysis.ts','src/independent-product-answer.ts','src/independent-seo-model.ts','src/drive-broker.ts','src/independent-gsc.ts','src/independent-gsc-bridge.ts','src/independent-gsc-bootstrap.ts','src/independent-ga4.ts','src/independent-context.ts','src/independent-context-bridge.ts','src/d1-read-budget.ts','public/ui.js','public/chart.js','public/period.js','public/independent-seo.js','public/independent-seo.html','deploy/wrangler.monthly-app.jsonc','deploy/wrangler.drive-archive.jsonc')

def browser_acceptance(key):
 # One mandatory live UI acceptance, outside the test suite. No source rows/logs.
 code=r'''
import {chromium} from '@playwright/test';
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
let stage='open',legacy=0,errors=0;
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'tr-TR',extraHTTPHeaders:{Authorization:'Bearer '+process.env.SEO_PREVIEW_KEY}});
 const page=await context.newPage();page.on('pageerror',()=>errors++);
 page.on('request',r=>{const p=new URL(r.url()).pathname;if(p.startsWith('/api/')&&p!=='/api/session'&&!p.startsWith('/api/independent/'))legacy++;});
 await page.goto('http://127.0.0.1:8806/',{waitUntil:'networkidle',timeout:60000});
 await page.locator('#app').waitFor({state:'visible'});
 await page.waitForFunction(()=>!document.body.classList.contains('is-loading')&&document.querySelector('#performanceChart svg'));
 for(const name of ['overview','products','queries','radar','changes','health','questions']){
  stage=name;await page.locator('#navigation [data-view='+name+']').click();
  await page.locator('#view-'+name).waitFor({state:'visible'});
 }
 stage='answer';await page.locator('#questionText').fill('Broşür neden düşüyor?');await page.locator('#question button[type=submit]').click();
 await page.waitForFunction(()=>document.querySelector('#answer').textContent.includes('İnceleme önceliği yüksek'));
 if(!(await page.locator('#answer').innerText()).includes('içerik veya yönlendirme değişikliği önerilmez'))throw Error();
 stage='organic';await page.locator('[data-view=overview]').click();
 for(const kind of ['cities','devices','pages']){await page.locator('#organicFacet').selectOption(kind);if(await page.locator('#organicTable tbody tr td').count()<5)throw Error();}
 stage='mobile';await page.setViewportSize({width:390,height:844});
 await page.waitForTimeout(200);
 if(!await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))throw Error();
 await page.locator('#sidebarToggle').click();await page.locator('[data-view=products]').click();
 if(!await page.locator('#view-products').isVisible())throw Error();
 if(legacy||errors)throw Error();
 console.log(JSON.stringify({passed:true,views:7,ga4_views:3,mobile:true,legacy_data_requests:legacy,page_errors:errors,brochure_priority:'Öncelikli incele',content_change_recommended:false}));
}catch{console.log(JSON.stringify({passed:false,stage,legacy_data_requests:legacy,page_errors:errors}));process.exitCode=1;}
finally{await browser.close();}
'''
 result=subprocess.run(['node','--input-type=module','-e',code],cwd=ROOT,env={**os.environ,'SEO_PREVIEW_KEY':key},capture_output=True,text=True,timeout=150)
 try:proof=json.loads(result.stdout.strip().splitlines()[-1])
 except (ValueError,IndexError):raise ValueError('SEO_ANSWER_BROWSER_UNAVAILABLE') from None
 if result.returncode or proof.get('passed') is not True:print(json.dumps({'browser_acceptance_failed':proof}),flush=True)
 need(result.returncode==0 and proof.get('passed') is True,'SEO_ANSWER_BROWSER_ACCEPTANCE_FAILED');return proof

def run():
 sha=os.environ.get('GITHUB_SHA','')
 need(os.environ.get('GITHUB_REF')=='refs/heads/main' and os.environ.get('GITHUB_REPOSITORY')==REPOSITORY,'SEO_ANSWER_MAIN_REQUIRED')
 need(re.fullmatch('[a-f0-9]{40}',sha) and git('rev-parse','HEAD')==sha and git('log','-1','--format=%s')==TITLE,'SEO_ANSWER_SOURCE_REQUIRED')
 need(git('rev-parse','HEAD^')==BASE and set(git('diff','--name-only','HEAD^','HEAD').splitlines())==EXPECTED,'SEO_ANSWER_REVIEWED_SCOPE_REQUIRED')
 for path in PROTECTED:need(subprocess.check_output(['git','show',BASE+':'+path],cwd=ROOT)==(ROOT/path).read_bytes(),'SEO_ANSWER_PROTECTED_SOURCE_CHANGED')
 old_index=subprocess.check_output(['git','show',BASE+':src/index.ts'],cwd=ROOT).decode()
 need(old_index.split('  async scheduled(',1)[1]==(ROOT/'src/index.ts').read_text().split('  async scheduled(',1)[1],'SEO_ANSWER_CRON_SOURCE_CHANGED')
 old_router=subprocess.check_output(['git','show',BASE+':src/drive-independent.ts'],cwd=ROOT).decode()
 new_router=(ROOT/'src/drive-independent.ts').read_text()
 old_return="return json(path.endsWith('gsc-analysis')?{...analyzeVerifiedGsc(gsc,mappings),mapping_evidence:context?{source_hash:context.source_hash,captured_at:context.captured_at,coverage:context.coverage}:null}:gsc);"
 new_return="return json(path.endsWith('gsc-analysis')?{...analyzeVerifiedGsc(gsc,mappings),mapping_evidence:context?{source_hash:context.source_hash,captured_at:context.captured_at,coverage:context.coverage}:null}:{...gsc,mappings:context?.products||[],mapping_evidence:context?{source_hash:context.source_hash,captured_at:context.captured_at,coverage:context.coverage}:null});"
 need(old_return in old_router and old_router.replace(old_return,new_return)==new_router,'SEO_ANSWER_COLLECTOR_SOURCE_CHANGED')
 need(get_json('https://api.github.com/repos/'+REPOSITORY+'/branches/main',os.environ.get('GITHUB_TOKEN')).get('commit',{}).get('sha')==sha,'SEO_ANSWER_MAIN_SUPERSEDED')
 runs=get_json('https://api.github.com/repos/'+REPOSITORY+'/actions/workflows/ci.yml/runs?head_sha='+sha+'&per_page=20',os.environ.get('GITHUB_TOKEN')).get('workflow_runs',[])
 need(any(r.get('head_sha')==sha and r.get('head_branch')=='main' and r.get('event')=='push' and r.get('conclusion')=='success' for r in runs),'SEO_ANSWER_GREEN_CI_REQUIRED')
 client=Cloudflare(os.environ.get('CLOUDFLARE_API_TOKEN'),os.environ.get('CLOUDFLARE_ACCOUNT_ID'));free_plan(api(client,'GET','/subscriptions'))
 before={w:snapshot(client,w) for w in (APP,ARCHIVE)}
 main_config=app_config(before[APP]['bindings'])
 need(before[APP]['crons']==['*/15 * * * *'] and url_json('https://mavi-basim-seo-prod.mavibasimonline.workers.dev/api/health').get('deployment',{}).get('commit')==APP_SOURCE,'SEO_ANSWER_APP_DRIFT')
 folder=ROOT/'.local/seo-answer';folder.mkdir(parents=True,exist_ok=True);folder.chmod(0o700)
 key=secrets.token_hex(32);secret=folder/'.dev.vars';secret.write_text('PROBE_KEY='+key+'\n');secret.chmod(0o600)
 cfg=folder/'wrangler.jsonc';cfg.write_text(json.dumps({'name':APP,'main':str(ROOT/'scripts/seo-answer-probe.ts'),'compatibility_date':'2026-10-01','workers_dev':False,'preview_urls':False,'unsafe':{'bindings':[{'name':'ADMIN_TOKEN','type':'inherit'}]},'services':[{'binding':'LIVE_APP','service':APP,'environment':'production'}]}));cfg.chmod(0o600)
 preview=None;deployed=[]
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
   deployed.append(ARCHIVE);deploy('deploy/wrangler.drive-archive.jsonc',sha)
   after=snapshot(client,ARCHIVE);verify_active_source(client,ARCHIVE,after['version'],sha)
   need(after['bindings']==before[ARCHIVE]['bindings'] and after['crons']==before[ARCHIVE]['crons'] and snapshot(client,APP)==before[APP],'SEO_ANSWER_CONFIGURATION_CHANGED')
   deployed.append(APP);deploy(main_config,sha)
   app_after=snapshot(client,APP);verify_active_source(client,APP,app_after['version'],sha)
   need(app_after['bindings']==before[APP]['bindings'] and app_after['crons']==before[APP]['crons'],'SEO_ANSWER_CONFIGURATION_CHANGED')
   for attempt in range(10):
    try:
     proof=exchange('/accept');break
    except ValueError as error:
     # The control plane can switch before service-bound requests reach the new
     # runtime. Retry only the missing new rule marker, never a semantic failure.
     if str(error)!='SEO_ANSWER_RUNTIME_PENDING' or attempt==9:raise
     time.sleep(3)
   need(proof.get('verified') is True,'SEO_ANSWER_ACCEPTANCE_FAILED')
   health=url_json('https://mavi-basim-seo-prod.mavibasimonline.workers.dev/api/health')
   need(health.get('deployment',{}).get('commit')==sha and health['deployment'].get('version_id')==app_after['version'],'SEO_ANSWER_HTTP_SOURCE_MISMATCH')
   for path in ('index.html','app.js','app.css','unified-seo.js'):
    status,body=http('https://mavi-basim-seo-prod.mavibasimonline.workers.dev/'+path+'?release='+sha)
    need(status==200 and body==(ROOT/'public'/path).read_bytes(),'SEO_ANSWER_ASSET_MISMATCH')
   status,body=http('https://mavi-basim-seo-prod.mavibasimonline.workers.dev/independent-seo.html')
   need(status==200 and body==(ROOT/'public/index.html').read_bytes(),'SEO_ANSWER_SECOND_PANEL_VISIBLE')
   for path in ('gsc-month?month=2026-10','ga4-report?month=2026-10','change-history?month=2026-10'):
    status,_=http('https://mavi-basim-seo-prod.mavibasimonline.workers.dev/api/independent/'+path)
    need(status==401,'SEO_ANSWER_PUBLIC_DATA_EXPOSED')
   login=live_acceptance();browser=browser_acceptance(key)
   need(snapshot(client,APP)==app_after and snapshot(client,ARCHIVE)==after,'SEO_ANSWER_PRODUCTION_DRIFT')
   print(json.dumps({'seo_answer_release':{'deployed':True,'source':sha,'archive_version':after['version'],'app_version':app_after['version'],'unified_panel':True,'cron_unchanged':True,'source_datasets_unchanged':True,'proof':proof,'login':login,'browser':browser,'d1_requests':0,'new_billed_resources':False,'site_changed':False}}),flush=True)
 except Exception:
  for worker,config in ((APP,main_config),(ARCHIVE,'deploy/wrangler.drive-archive.jsonc')):
   if worker in deployed:rollback(config,before[worker]['version']);need(snapshot(client,worker)==before[worker],'SEO_ANSWER_ROLLBACK_FAILED')
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
