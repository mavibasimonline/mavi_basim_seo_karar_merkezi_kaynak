import {beforeEach,describe,it,expect,vi} from 'vitest';
import {env,init,configured,fetcher,connected,enqueue} from './helpers';
import {archiveDriveDay,scheduledDriveArchive,ARCHIVE_SHEET} from '../src/drive-archive';
import {oauthStart,oauthCallback,DRIVE_SCOPE,saveTokens,accessToken,READ_SCOPES} from '../src/google';
import {decrypt} from '../src/security';
import app from '../src/index';

beforeEach(init);
const time=new Date('2026-10-30T10:15:00Z'),id='fixture_generated_file_01';
const content=new Uint8Array([0x50,0x4b,3,4,5,6,7,8]);
const sha=async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',content))].map(b=>b.toString(16).padStart(2,'0')).join('');
async function driveConnected(){const cfg=await connected();await saveTokens(cfg,{access_token:'drive-access',refresh_token:'drive-refresh',expires_at:Date.now()+3600_000,scope:DRIVE_SCOPE},'google-drive');return cfg;}
async function remote(options:{lostUpload?:boolean;wrongHash?:boolean;storage?:boolean;badSource?:boolean}={}){
 let file:any=null,uploads=0,downloads=0;
 const mock=fetcher(async(url,init)=>{
  if(url.includes('/files/generateIds?'))return Response.json({ids:[id]});
  if(url.includes('/about?'))return Response.json({storageQuota:{limit:options.storage?'8':'15000000000',usage:'5'}});
  if(url.startsWith('https://docs.google.com/')){expect(init?.headers).toBeUndefined();return new Response(options.badSource?'<html>Sign in</html>':content);}
  if(url.includes('/upload/drive/')){
   uploads++;expect(init?.headers).toMatchObject({Authorization:'Bearer drive-access'});
   const body=await (init?.body as Blob).text();expect(body).toContain('"id":"'+id+'"');expect(body).toContain(ARCHIVE_SHEET);
   file={id,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',size:String(content.length),appProperties:{source:ARCHIVE_SHEET,day:'2026-10-30',sha256:options.wrongHash?'0'.repeat(64):await sha()}};
   if(options.lostUpload)throw Error('fixture lost response');return Response.json({id});
  }
  if(url.includes('?alt=media')){downloads++;return new Response(content);}
  if(url.includes('/files/'+id+'?'))return file?Response.json(file):new Response(null,{status:404});
  throw Error('unexpected destination');
 });
 return {mock,counts:()=>({uploads,downloads})};
}
describe('least privilege Drive consent and daily private archive',()=>{
 it('keeps Drive status and consent behind the existing owner session and origin checks',async()=>{
  const cfg=configured();
  expect((await app.fetch(new Request('https://app.example/api/drive/status'),cfg)).status).toBe(401);
  expect((await app.fetch(new Request('https://app.example/api/oauth/google/start?purpose=drive',{method:'POST'}),cfg)).status).toBe(401);
  expect((await app.fetch(new Request('https://app.example/api/oauth/google/start?purpose=drive',{method:'POST',headers:{Authorization:'Bearer '+cfg.ADMIN_TOKEN,Origin:'https://wrong.example'}}),cfg)).status).toBe(403);
 });
 it('uses the existing callback with offline drive.file only; preserves GSC credentials and jobs',async()=>{
  const cfg=await connected();await enqueue();await env.DB.prepare("UPDATE sync_jobs SET status='blocked',error_code='GOOGLE_HTTP_403'").run();
  const previous=await env.DB.prepare("SELECT * FROM oauth_credentials WHERE provider='google'").first();
  const start=await oauthStart(cfg,'drive'),url=new URL((await start.json() as any).authorization_url);
  expect(url.searchParams.get('scope')).toBe(DRIVE_SCOPE);expect(url.searchParams.get('access_type')).toBe('offline');expect(url.searchParams.get('redirect_uri')).toBe(cfg.GOOGLE_REDIRECT_URI);
  expect(start.headers.get('Set-Cookie')).toContain('HttpOnly; Secure; SameSite=Lax');
  const request=()=>new Request(cfg.GOOGLE_REDIRECT_URI+'?code=fixture&state='+url.searchParams.get('state'),{headers:{Cookie:start.headers.get('Set-Cookie')!}});
  const mock=fetcher(async()=>Response.json({access_token:'drive-access',refresh_token:'drive-refresh',expires_in:3600,scope:DRIVE_SCOPE}));
  const callback=await oauthCallback(request(),cfg,mock);expect(callback.status).toBe(303);expect(callback.headers.get('Location')).toBe('/drive.html?connected=1');
  expect(await env.DB.prepare("SELECT * FROM oauth_credentials WHERE provider='google'").first()).toEqual(previous);
  expect((await env.DB.prepare('SELECT status FROM sync_jobs').first() as any).status).toBe('blocked');
  const stored=await env.DB.prepare("SELECT encrypted_tokens FROM oauth_credentials WHERE provider='google-drive'").first<{encrypted_tokens:string}>();
  expect(stored?.encrypted_tokens).not.toContain('drive-refresh');expect((await decrypt<any>(stored!.encrypted_tokens,cfg.TOKEN_ENCRYPTION_KEY!)).refresh_token).toBe('drive-refresh');
  expect((await oauthCallback(request(),cfg,mock)).status).toBe(400);
 });
 it('rejects missing Drive scope or offline grant without replacing the working connection',async()=>{
  const cfg=await connected();
  for(const invalid of [{scope:READ_SCOPES[0],refresh_token:'refresh'},{scope:DRIVE_SCOPE}]){
   const start=await oauthStart(cfg,'drive'),url=new URL((await start.json() as any).authorization_url);
   const callback=await oauthCallback(new Request(cfg.GOOGLE_REDIRECT_URI+'?code=x&state='+url.searchParams.get('state'),{headers:{Cookie:start.headers.get('Set-Cookie')!}}),cfg,fetcher(async()=>Response.json({access_token:'access',expires_in:3600,...invalid})));
   expect(callback.status).toBe(400);expect(await env.DB.prepare("SELECT 1 FROM oauth_credentials WHERE provider='google-drive'").first()).toBeNull();
  }
  expect(await accessToken(cfg)).toBe('test-access');
 });
 it('refreshes and encrypts Drive tokens without changing GSC tokens',async()=>{
  const cfg=await driveConnected();await saveTokens(cfg,{access_token:'expired',refresh_token:'drive-refresh',expires_at:0,scope:DRIVE_SCOPE},'google-drive');
  const mock=fetcher(async(url,init)=>{expect(url).toBe('https://oauth2.googleapis.com/token');expect((init?.body as URLSearchParams).get('refresh_token')).toBe('drive-refresh');return Response.json({access_token:'renewed-drive',expires_in:3600});});
  expect(await accessToken(cfg,mock,false,'google-drive')).toBe('renewed-drive');expect(await accessToken(cfg)).toBe('test-access');
 });
 it('uploads and reads back one private file, then skips the same UTC day',async()=>{
  const cfg=await driveConnected(),r=await remote();expect(await archiveDriveDay(cfg,r.mock,time)).toEqual({status:'archived',day:'2026-10-30'});
  expect(await archiveDriveDay(cfg,r.mock,time)).toEqual({status:'already_archived',day:'2026-10-30'});expect(r.counts()).toEqual({uploads:1,downloads:1});
  expect(await env.DB.prepare("SELECT code FROM health_checks WHERE provider='drive-archive'").first()).toEqual({code:'VERIFIED_READBACK'});
 });
 it('recovers a lost upload response with the original reserved ID and no duplicate upload',async()=>{
  const cfg=await driveConnected(),r=await remote({lostUpload:true});await expect(archiveDriveDay(cfg,r.mock,time)).rejects.toThrow('NETWORK_UNAVAILABLE');
  expect(await archiveDriveDay(cfg,r.mock,time)).toEqual({status:'archived',day:'2026-10-30'});expect(r.counts()).toEqual({uploads:1,downloads:1});
 });
 it('does not mark corrupt archives successful or replace existing files',async()=>{
  const cfg=await driveConnected(),r=await remote({wrongHash:true});await expect(archiveDriveDay(cfg,r.mock,time)).rejects.toThrow('DRIVE_ARCHIVE_CHECKSUM_MISMATCH');
  await expect(archiveDriveDay(cfg,r.mock,time)).rejects.toThrow('DRIVE_ARCHIVE_CHECKSUM_MISMATCH');expect(r.counts().uploads).toBe(1);expect(await env.DB.prepare("SELECT 1 FROM health_checks WHERE provider='drive-archive'").first()).toBeNull();
 });
 it('holds on insufficient existing Drive storage and never enables paid storage',async()=>{
  const cfg=await driveConnected(),r=await remote({storage:true});await expect(archiveDriveDay(cfg,r.mock,time)).rejects.toThrow('DRIVE_STORAGE_HEADROOM_REQUIRED');expect(r.counts().uploads).toBe(0);
 });
 it('refuses sign-in HTML instead of archiving it as data',async()=>{
  const cfg=await driveConnected(),r=await remote({badSource:true});await expect(archiveDriveDay(cfg,r.mock,time)).rejects.toThrow('ARCHIVE_SOURCE_NOT_XLSX');expect(r.counts().uploads).toBe(0);
 });
 it('performs no Google requests or data writes before consent or without a fresh D1 quota lease',async()=>{
  const mock=vi.fn();expect(await archiveDriveDay(configured(),mock as any,time)).toEqual({status:'consent_required'});
  const log=vi.spyOn(console,'log').mockImplementation(()=>{});
  const result=await scheduledDriveArchive(configured({D1_READ_GUARD_ENABLED:'true'}),time,mock as any);log.mockRestore();
  expect(result).toEqual({status:'held',code:'CHECKPOINT_MISSING'});expect(mock).not.toHaveBeenCalled();expect(await env.DB.prepare('SELECT 1 FROM health_checks').first()).toBeNull();
 });
 it('preserves the full old ledger and resumes automatically with a fresh next-day budget',async()=>{
  const cfg=await driveConnected(),r=await remote(),previous=new Date('2026-10-29T10:15:00Z');
  for(const day of ['2026-10-29','2026-10-30'])await env.DB.prepare("INSERT INTO d1_quota_state VALUES(?,?,?,?,1000,1000,'open','fixture')").bind(day,day+'T10:00:00Z',day+'T10:00:00Z',day+'T11:00:00Z').run();
  await env.DB.prepare("INSERT INTO d1_quota_ledger VALUES('2026-10-29',1000000,5000,?)").bind(previous.toISOString()).run();
  const log=vi.spyOn(console,'log').mockImplementation(()=>{});
  expect(await scheduledDriveArchive({...cfg,D1_READ_GUARD_ENABLED:'true'},previous,r.mock)).toEqual({status:'held',code:'BACKGROUND_READ_HEADROOM'});
  expect(r.counts().uploads).toBe(0);
  expect(await scheduledDriveArchive({...cfg,D1_READ_GUARD_ENABLED:'true'},time,r.mock)).toEqual({status:'archived',day:'2026-10-30'});log.mockRestore();
  expect(await env.DB.prepare("SELECT reads,writes FROM d1_quota_ledger WHERE day='2026-10-29'").first()).toEqual({reads:1000000,writes:5000});
  expect(r.counts()).toEqual({uploads:1,downloads:1});
 });
});
