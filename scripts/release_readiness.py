"""Resolve the current production version without D1 queries; pin successful main CI."""
import json
import os
import re
import urllib.request
import urllib.error
import socket
import time
from datetime import datetime,timezone
from pathlib import Path
from cloudflare_diagnostics import Cloudflare
from d1_quota_checkpoint import NOT_BEFORE

REPOSITORY='mavibasimonline/mavi_basim_seo_karar_merkezi_kaynak'
APP='https://mavi-basim-seo-prod.mavibasimonline.workers.dev'
READ_GUARD_REVISION='d1-account-reads-v1'


def get_json(url,token=None,opener=None):
 # Fixed callers only; never follow a credential-bearing redirect to another host.
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*args,**kwargs):return None
 headers={'Accept':'application/json','User-Agent':'MaviBasimReleaseCheck/1.0'}
 if token:headers['Authorization']='Bearer '+token
 request=urllib.request.Request(url,headers=headers)
 destination='WORKER_HEALTH' if url.startswith(APP+'/api/health?') else 'GITHUB_MAIN_REF' if url.endswith('/branches/main') else 'GITHUB_CI'
 client=opener or urllib.request.build_opener(NoRedirect())
 for attempt in range(2):
  try:
   with client.open(request,timeout=30) as response:raw=response.read(2_000_001)
   if len(raw)>2_000_000:raise ValueError('RELEASE_RESPONSE_LIMIT')
   return json.loads(raw)
  except urllib.error.HTTPError as error:
   code='HTTP_'+str(error.code);transient=error.code in (429,500,502,503,504)
  except (TimeoutError,socket.timeout):code='TIMEOUT';transient=True
  except urllib.error.URLError:code='TRANSPORT';transient=True
  except ValueError:code='INVALID_JSON_OR_RESPONSE_LIMIT';transient=False
  except OSError:code='TRANSPORT';transient=True
  if not transient or attempt==1:raise ValueError('RELEASE_OBSERVATION_UNAVAILABLE_'+destination+'_'+code) from None
  time.sleep(1)



def live_guard_deployment(opener=None):
 payload=get_json(APP+'/api/health?read-guard=readiness',opener=opener)
 d=payload.get('deployment',{})
 return d if payload.get('ok') is True and d.get('read_guard_revision')==READ_GUARD_REVISION and re.fullmatch(r'[a-f0-9]{40}',d.get('commit') or '') and re.fullmatch(r'[a-f0-9-]{36}',d.get('version_id') or '') else None


def readiness(client,sha,event,previous=None,now=None,github=None,health=None):
 now=now or datetime.now(timezone.utc)
 if now<NOT_BEFORE:raise ValueError('D1_QUOTA_RESET_REQUIRED')
 if event=='schedule' and now.date()!=NOT_BEFORE.date():return {'needed':False,'reason':'ONE_TIME_RELEASE_DATE_EXPIRED','database_queries':0}
 if event not in ('schedule','workflow_dispatch') or not re.fullmatch(r'[a-f0-9]{40}',sha or ''):raise ValueError('INVALID_RELEASE_CONTEXT')
 if event=='workflow_dispatch' and not re.fullmatch(r'[a-f0-9-]{36}',previous or ''):raise ValueError('PREVIOUS_VERSION_REQUIRED')
 github=github or (lambda path:get_json('https://api.github.com/repos/'+REPOSITORY+path,os.environ.get('GITHUB_TOKEN')))
 if github('/branches/main').get('commit',{}).get('sha')!=sha:raise ValueError('RELEASE_COMMIT_SUPERSEDED')
 runs=github('/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha='+sha+'&per_page=20').get('workflow_runs',[])
 if not any(r.get('head_sha')==sha and r.get('head_branch')=='main' and r.get('event')=='push' and r.get('status')=='completed' and r.get('conclusion')=='success' for r in runs):raise ValueError('SUCCESSFUL_EXACT_MAIN_CI_REQUIRED')
 result=client.request('GET',f'/accounts/{client.account}/workers/scripts/mavi-basim-seo-prod/deployments')
 if not result.get('ok'):raise ValueError('LIVE_VERSION_READ_FAILED')
 records=result['result'].get('deployments',[]) if isinstance(result['result'],dict) else result['result']
 if not records:raise ValueError('LIVE_VERSION_READ_FAILED')
 versions=max(records,key=lambda r:r.get('created_on','')).get('versions',[])
 if len(versions)!=1 or versions[0].get('percentage')!=100 or not re.fullmatch(r'[a-f0-9-]{36}',versions[0].get('version_id','')):raise ValueError('SINGLE_PRODUCTION_VERSION_REQUIRED')
 version=versions[0]['version_id']
 if previous and previous!=version:raise ValueError('PRODUCTION_VERSION_CHANGED')
 live=(health or live_guard_deployment)()
 already=bool(live and live.get('version_id')==version and live.get('commit')==sha and live.get('read_guard_revision')==READ_GUARD_REVISION)
 return {'needed':not already,'reason':'ALREADY_PUBLISHED' if already else 'EXACT_MAIN_CI_VERIFIED','production_acceptance_pending':True,'previous_version':version,'commit':sha,'database_queries':0}


if __name__=='__main__':
 try:
  result=readiness(Cloudflare(os.environ.get('CLOUDFLARE_API_TOKEN'),os.environ.get('CLOUDFLARE_ACCOUNT_ID')),os.environ.get('GITHUB_SHA'),os.environ.get('GITHUB_EVENT_NAME'),os.environ.get('EXPECTED_PREVIOUS_VERSION') or None)
  source=os.environ.get('RELEASE_SOURCE_COMMIT')
  if source:
   from scoped_release import ROOT,plan,assets,PERFORMANCE_SOURCE
   live=live_guard_deployment()
   if not live:raise ValueError('LIVE_GUARD_REQUIRED')
   selected=plan(ROOT,source,os.environ.get('GITHUB_SHA'),live,lambda path:get_json('https://api.github.com/repos/'+REPOSITORY+path,os.environ.get('GITHUB_TOKEN')))
   result.update(source_commit=source,scoped_source=selected,source_assets=assets(ROOT,live['commit'] if source==PERFORMANCE_SOURCE else source),needed=live.get('commit')!=source)
  else:result['source_commit']=os.environ.get('GITHUB_SHA')
  folder=Path('.local');folder.mkdir(exist_ok=True);(folder/'release-readiness.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
  if os.environ.get('GITHUB_OUTPUT'):
   with open(os.environ['GITHUB_OUTPUT'],'a') as out:
    out.write('needed='+str(result['needed']).lower()+'\nprevious_version='+result.get('previous_version','')+'\nsource_commit='+result['source_commit']+'\n')
 except Exception as error:
  code=str(error) if isinstance(error,ValueError) and re.fullmatch(r'[A-Z0-9_]+',str(error)) else type(error).__name__
  raise SystemExit('RELEASE_READINESS_FAILED:'+code)
