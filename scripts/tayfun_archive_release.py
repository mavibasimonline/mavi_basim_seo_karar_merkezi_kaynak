"""Controlled Tayfun archive Worker upgrade. No live site writes, D1, DO migrations or secret rotations."""
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from cloudflare_diagnostics import Cloudflare
from quota_observer_release import api, active_version, cron_rows, free_plan

ROOT=Path(__file__).resolve().parents[1]
CONFIG=ROOT/'deploy/wrangler.drive-archive.jsonc'
STATE=ROOT/'.local/tayfun-archive-previous.json'
ARCHIVE='mavi-basim-drive-archive'
APP='mavi-basim-seo-prod'
ALLOWED_BINDINGS={'ARCHIVE_ENCRYPTION_KEY','ARCHIVE_ENABLED','DRIVE_ARCHIVE_STORE','OAUTH_BROKER','CF_VERSION_METADATA'}

def need(value,code):
 if not value:raise ValueError(code)

def base(worker):
 return '/workers/scripts/'+worker

def inspect(client,worker):
 path=base(worker)
 settings=api(client,'GET',path+'/settings')
 bindings=settings.get('bindings',[])
 need(isinstance(bindings,list),'ARCHIVE_BINDINGS_UNAVAILABLE')
 return {'version':active_version(api(client,'GET',path+'/deployments')),
  'bindings':sorted(bindings,key=lambda b:b.get('name','')),
  'crons':cron_rows(api(client,'GET',path+'/schedules'))}

def fingerprint(bindings):
 # Cloudflare returns only binding names and non-secret metadata, never secret values.
 return hashlib.sha256(json.dumps(bindings,sort_keys=True).encode()).hexdigest()

def preflight():
 client=Cloudflare(os.environ.get('CLOUDFLARE_API_TOKEN'),os.environ.get('CLOUDFLARE_ACCOUNT_ID'))
 free_plan(api(client,'GET','/subscriptions'))
 cfg=json.loads(CONFIG.read_text())
 need(cfg.get('name')==ARCHIVE and cfg.get('main')=='../src/drive-independent.ts'
  and cfg.get('workers_dev') is False and cfg.get('preview_urls') is False,'ARCHIVE_CONFIG_REJECTED')
 need(cfg.get('vars')=={'ARCHIVE_ENABLED':'true'},'ARCHIVE_CONFIG_REJECTED')
 need(cfg.get('services')==[{'binding':'OAUTH_BROKER','service':APP,'entrypoint':'DriveGoogleBroker'}],'ARCHIVE_CONFIG_REJECTED')
 need(cfg.get('migrations')==[{'tag':'drive-independent-v1','new_sqlite_classes':['IndependentDriveStore']}],'ARCHIVE_SQLITE_MIGRATION_CHANGE_FORBIDDEN')
 need(cfg.get('durable_objects')=={'bindings':[{'name':'DRIVE_ARCHIVE_STORE','class_name':'IndependentDriveStore'}]},'ARCHIVE_STORAGE_BINDING_CHANGE_FORBIDDEN')
 archive=inspect(client,ARCHIVE);app=inspect(client,APP)
 names={b.get('name') for b in archive['bindings']}
 need(names==ALLOWED_BINDINGS,'ARCHIVE_BINDINGS_DRIFT')
 need(any(b.get('name')=='ARCHIVE_ENCRYPTION_KEY' and b.get('type')=='secret_text' for b in archive['bindings']),'ARCHIVE_ENCRYPTION_SECRET_MISSING')
 need(any(b.get('name')=='ARCHIVE_ENABLED' and b.get('text')=='true' for b in archive['bindings']),'ARCHIVE_DISABLED')
 need(any(b.get('name')=='DRIVE_ARCHIVE_STORE' and b.get('type')=='durable_object_namespace' for b in archive['bindings']),'ARCHIVE_SQLITE_BINDING_MISSING')
 need(archive['crons']==[] and app['crons']==['*/15 * * * *'],'ARCHIVE_OR_APP_CRON_DRIFT')
 flags=api(client,'GET',base(ARCHIVE)+'/subdomain')
 need(flags.get('enabled') is False and flags.get('previews_enabled') is False,'ARCHIVE_PUBLIC_ACCESS_FORBIDDEN')
 STATE.parent.mkdir(exist_ok=True)
 STATE.write_text(json.dumps({'archive':archive,'app':app,'subdomain':flags,'commit':os.environ.get('GITHUB_SHA')},sort_keys=True))
 print(json.dumps({'preflight':'passed','previous_archive_version':archive['version'],'archive_config_unchanged':True,'app_version':app['version'],'source_record_writes':0,'d1_requests':0}))

def postflight():
 need(STATE.exists(),'ARCHIVE_PREFLIGHT_REQUIRED')
 saved=json.loads(STATE.read_text())
 client=Cloudflare(os.environ.get('CLOUDFLARE_API_TOKEN'),os.environ.get('CLOUDFLARE_ACCOUNT_ID'))
 after=inspect(client,ARCHIVE);app=inspect(client,APP)
 need(app==saved['app'],'MAIN_WORKER_CHANGED_DURING_ARCHIVE_RELEASE')
 need(after['bindings']==saved['archive']['bindings'],'ARCHIVE_BINDINGS_CHANGED')
 need(after['crons']==saved['archive']['crons']==[],'ARCHIVE_CRON_CHANGED')
 flags=api(client,'GET',base(ARCHIVE)+'/subdomain')
 need(flags==saved['subdomain'],'ARCHIVE_SUBDOMAIN_CHANGED')
 need(after['version']!=saved['archive']['version'],'ARCHIVE_VERSION_NOT_UPDATED')
 version=api(client,'GET',base(ARCHIVE)+'/versions/'+after['version'])
 need(version.get('annotations',{}).get('workers/tag')==saved['commit'],'ARCHIVE_SOURCE_COMMIT_MISMATCH')
 print(json.dumps({'postflight':'passed','archive_version':after['version'],'previous_archive_version':saved['archive']['version'],
  'bindings_preserved':True,'main_worker_preserved':True,'secret_rotations':0,'d1_requests':0,'site_writes':0}))

if __name__=='__main__':
 try:
  if len(sys.argv)!=2 or sys.argv[1] not in ('preflight','postflight'):raise ValueError('ARCHIVE_MODE_INVALID')
  {'preflight':preflight,'postflight':postflight}[sys.argv[1]]()
 except Exception as error:
  message=str(error)
  code=message if isinstance(error,ValueError) and re.fullmatch('[A-Z0-9_]+',message) else type(error).__name__
  raise SystemExit('TAYFUN_ARCHIVE_RELEASE_FAILED:'+code)
