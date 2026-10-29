"""Run exact observer read paths on a temporary Cloudflare edge preview; no deploy/Cron/write."""
import json,os,re,secrets,subprocess,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parents[1]
folder=root/'.local/observer-runtime-probe';folder.mkdir(parents=True,exist_ok=True)
token=os.environ.get('CF_QUOTA_ANALYTICS_TOKEN');account=os.environ.get('CLOUDFLARE_ACCOUNT_ID')
if not token or not account:raise SystemExit('PROBE_BINDINGS_REQUIRED')
key=secrets.token_hex(32)
secret=folder/'.dev.vars';secret.write_text('PROBE_KEY='+key+'\nCF_QUOTA_ANALYTICS_TOKEN='+token+'\n');secret.chmod(0o600)
config={'name':'mavi-basim-observer-readonly-probe','main':'../../scripts/observer-runtime-probe.ts',
 'compatibility_date':'2026-10-01','workers_dev':False,'preview_urls':False,
 'vars':{'CLOUDFLARE_ACCOUNT_ID':account,'QUOTA_OBSERVER_ENABLED':'true'},
 'd1_databases':[{'binding':'DB','database_name':'mavi-basim-seo','database_id':'18f8c90d-4af1-430c-ac86-ddf184c75a0b'}]}
(folder/'wrangler.jsonc').write_text(json.dumps(config));p=None;statuses=set()
try:
 with (folder/'runtime.log').open('w') as log:
  p=subprocess.Popen(['node','scripts/run.mjs','wrangler','dev','--remote','--config',str(folder/'wrangler.jsonc'),'--ip','127.0.0.1','--port','8796','--log-level','error'],cwd=root,stdout=log,stderr=log)
  for attempt in range(60):
   if p.poll() is not None:raise ValueError('EDGE_PREVIEW_NOT_AVAILABLE')
   try:
    with urllib.request.urlopen('http://127.0.0.1:8796/',timeout=2) as response:statuses.add(response.status)
   except urllib.error.HTTPError as error:
    statuses.add(error.code)
    if error.code==404:break
   except OSError:pass
   time.sleep(1)
  else:raise ValueError('EDGE_PREVIEW_START_TIMEOUT')
  req=urllib.request.Request('http://127.0.0.1:8796/',headers={'Authorization':'Bearer '+key})
  with urllib.request.urlopen(req,timeout=40) as response:result=json.loads(response.read(20000))
  print(json.dumps(result),flush=True)
except Exception:
 text=(folder/'runtime.log').read_text(errors='replace') if (folder/'runtime.log').exists() else ''
 print(json.dumps({'edge_start_http_statuses':sorted(statuses),'runtime_numeric_codes':sorted(set(re.findall(r'\b(?:code[:= ]+)([0-9]{3,6})\b',text))),
  'runtime_flags':{word:word.lower() in text.lower() for word in ('authentication','subdomain','preview','websocket','timed out','Unknown argument','D1','error','ready')}}),flush=True)
 raise
finally:
 if p is not None:
  p.terminate()
  try:p.wait(timeout=10)
  except subprocess.TimeoutExpired:p.kill();p.wait()
 secret.unlink(missing_ok=True)
