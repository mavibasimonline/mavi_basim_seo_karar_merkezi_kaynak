"""Publish answer wording only; preserve the live interface and all source systems."""
import json,os,re,secrets,subprocess,time,urllib.request,urllib.error
from datetime import datetime,timezone
from zoneinfo import ZoneInfo
from cloudflare_diagnostics import Cloudflare
from quota_observer_release import api,free_plan
from release_readiness import get_json,REPOSITORY
from independent_seo_release import APP,ARCHIVE,ROOT,snapshot,app_config,deploy,rollback,verify_active_source,url_json,http,need,git
from login_access_release import live_acceptance
BASE='1fd7c759987c3b5bd4904db340ac17248d64cff6'
APP_SOURCE=BASE
TITLE='release: verified GSC history bootstrap 20261104'
EXPECTED={'scripts/seo_answer_release.py','scripts/seo-answer-probe.ts','src/independent-gsc-analysis.ts','src/independent-product-answer.ts','public/unified-seo.js'}
PROTECTED=('src/index.ts','src/drive-independent.ts','src/independent-gsc-report.ts','src/browser/unified-seo-panel.js','public/index.html','public/app.js','public/app.css','src/independent-session.ts','src/security.ts','src/independent-seo-model.ts','src/drive-broker.ts','src/independent-gsc.ts','src/independent-gsc-bridge.ts','src/independent-gsc-bootstrap.ts','src/independent-ga4.ts','src/independent-context.ts','src/independent-context-bridge.ts','src/d1-read-budget.ts','public/ui.js','public/chart.js','public/period.js','public/independent-seo.js','public/independent-seo.html','deploy/wrangler.monthly-app.jsonc','deploy/wrangler.drive-archive.jsonc')

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
 stage='september';await page.locator('#monthGrid [data-month="2026-09"]').click();
 await page.waitForFunction(()=>document.querySelector('#month').value==='2026-09'&&!document.body.classList.contains('is-loading'));
 stage='mobile-filter';await page.locator('#device').selectOption('MOBILE');
 await page.waitForFunction(()=>!document.body.classList.contains('is-loading'));
 stage='answer';await page.locator('#navigation [data-view=questions]').click();
 await page.locator('#questionText').fill('Broşür mobilde neden düştü?');await page.locator('#question button[type=submit]').click();
 await page.waitForFunction(()=>document.querySelector('#answer').textContent.includes('Bu dönemde düşüş yok, yükseliş var.'));
 const answer=await page.locator('#answer').innerText(),lower=answer.toLocaleLowerCase('tr-TR');
 if(!answer.includes('1 → 19 tıklama')||!answer.includes('GSC kapsamı: MOBILE')||!lower.includes('ağustos 2026 → eylül 2026')||answer.includes('Eylül–Ekim')||answer.includes('düşüşün nedeni kesinleştirilemedi'))throw Error();
 if(legacy||errors)throw Error();
 console.log(JSON.stringify({passed:true,september_mobile_growth_verified:true,dynamic_comparison_period_verified:true,legacy_data_requests:legacy,page_errors:errors,content_change_recommended:false}));
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
   need(health.get('deployment',{}).get('commit')==APP_SOURCE and health['deployment'].get('version_id')==before[APP]['version'],'SEO_ANSWER_HTTP_SOURCE_MISMATCH')
   for path in ('gsc-month?month=2026-10','ga4-report?month=2026-10','change-history?month=2026-10'):
    status,_=http('https://mavi-basim-seo-prod.mavibasimonline.workers.dev/api/independent/'+path)
    need(status==401,'SEO_ANSWER_PUBLIC_DATA_EXPOSED')
   browser=browser_acceptance(key)
   need(snapshot(client,APP)==before[APP] and snapshot(client,ARCHIVE)==after,'SEO_ANSWER_PRODUCTION_DRIFT')
   print(json.dumps({'seo_answer_release':{'deployed':True,'source':sha,'archive_version':after['version'],'app_unchanged':True,'unified_panel':True,'cron_unchanged':True,'source_datasets_unchanged':True,'proof':proof,'browser':browser,'d1_requests':0,'new_billed_resources':False,'site_changed':False}}),flush=True)
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
