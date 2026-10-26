import {beforeEach,it,expect} from 'vitest';
import {env,init,configured,fetcher} from './helpers';
import {oauthStart,oauthCallback,READ_SCOPES} from '../src/google';

let sequence=0;
beforeEach(async()=>{await init();sequence=0;});
const AUTH_ERRORS=['GOOGLE_HTTP_401','GOOGLE_HTTP_403','OAUTH_RECONNECT_REQUIRED','GOOGLE_NOT_CONNECTED','TOKEN_DECRYPTION_FAILED'];
const FAILURE_TIME='2026-10-25T12:00:00.000Z';
async function addJob(code:string|null,provider='gsc',status='blocked'){
 const n=++sequence,day=`2026-08-${String(n).padStart(2,'0')}`;
 const scope=provider==='ga4'?'organic':provider==='ads'?'brosur':'query';
 const id=`${provider}:${day}:${scope}`;
 await env.DB.prepare('INSERT INTO sync_jobs(id,provider,day,scope,status,generation,cursor,attempts,next_attempt_at,error_code,created_at,updated_at,quality_failed) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
  .bind(id,provider,day,scope,status,`TEST generation ${n}`,200,6,'2026-10-29T00:00:00.000Z',code,FAILURE_TIME,FAILURE_TIME,Number(!code||!AUTH_ERRORS.includes(code))).run();
 await env.DB.prepare("INSERT INTO sync_runs(id,job_id,started_at,finished_at,status,trigger_source) VALUES(?,?,?,?,'failed','cron')")
  .bind(`TEST failed ${n}`,id,FAILURE_TIME,FAILURE_TIME).run();
 await env.DB.prepare('INSERT INTO sync_errors(run_id,code,retry_at,created_at) VALUES(?,?,NULL,?)')
  .bind(`TEST failed ${n}`,code||'TEST legacy unknown error',FAILURE_TIME).run();
 return id;
}
const jobs=async()=>(await env.DB.prepare('SELECT * FROM sync_jobs ORDER BY id').all<Record<string,unknown>>()).results;
const errors=async()=>(await env.DB.prepare('SELECT * FROM sync_errors ORDER BY id').all()).results;
async function start(){
 const cfg=configured();
 const response=await oauthStart(cfg),body=await response.json() as {authorization_url:string};
 const state=new URL(body.authorization_url).searchParams.get('state')!;
 return {cfg,state,cookie:response.headers.get('Set-Cookie')!};
}
const tokenReply=()=>({access_token:'TEST authorized access',refresh_token:'TEST authorized refresh',expires_in:3600,scope:READ_SCOPES.join(' ')});

it('successful consent recovers only explicit Google authorization errors and preserves every other blocked record',async()=>{
 const recoverable:string[]=[];
 for(const provider of ['gsc','ga4','ads'])for(const code of AUTH_ERRORS)recoverable.push(await addJob(code,provider));
 for(const code of ['INVALID_GSC_ROW','INVALID_GSC_ROW_PAGE_WWW','INVALID_GSC_ROW_COUNTS','DUPLICATE_GSC_ROW','GOOGLE_HTTP_429','GOOGLE_HTTP_500','NETWORK_UNAVAILABLE','INVALID_TOKEN_RESPONSE','GSC_DAILY_ROW_LIMIT',null])await addJob(code);
 await addJob('GOOGLE_HTTP_401','unrecognized');
 await addJob('GOOGLE_HTTP_401','gsc','retry');
 await addJob('GOOGLE_HTTP_403','gsc','pending');
 const before=await jobs(),history=await errors(),{cfg,state,cookie}=await start();let calls=0;
 const response=await oauthCallback(new Request(`https://app.example/api/oauth/google/callback?state=${state}&code=TEST-code`,{headers:{Cookie:cookie}}),cfg,fetcher(async(url)=>{
  expect(url).toBe('https://oauth2.googleapis.com/token');calls++;return Response.json(tokenReply());
 }));
 expect(response.status).toBe(303);expect(calls).toBe(1);
 const after=await jobs();expect(after).toHaveLength(before.length);
 for(const old of before){
  const next=after.find(r=>r.id===old.id)!;
  if(recoverable.includes(String(old.id))){
   expect(next).toMatchObject({...old,status:'pending',attempts:0,error_code:null,next_attempt_at:expect.any(String)});
   expect(Date.parse(String(next.next_attempt_at))).toBeGreaterThan(Date.parse(FAILURE_TIME));
  }else expect(next).toEqual(old);
 }
 expect(await errors()).toEqual(history);
});

it.each(['missing-scope','missing-refresh','denied','bad-cookie','expired-state'])('invalid consent (%s) cannot reopen even authorization failures',async(kind)=>{
 await addJob('GOOGLE_HTTP_401');await addJob('INVALID_GSC_ROW_PAGE_WWW');await addJob('GOOGLE_HTTP_429');
 const before=await jobs(),history=await errors(),{cfg,state,cookie}=await start();let calls=0;
 if(kind==='expired-state')await env.DB.prepare("UPDATE oauth_states SET expires_at='2000-01-01T00:00:00.000Z'").run();
 const response=await oauthCallback(new Request(`https://app.example/api/oauth/google/callback?state=${state}&${kind==='denied'?'error=access_denied':'code=TEST-code'}`,
  {headers:{Cookie:kind==='bad-cookie'?'mavi_oauth=TEST-wrong-cookie':cookie}}),cfg,fetcher(async()=>{
   calls++;return Response.json({...tokenReply(),...(kind==='missing-scope'?{scope:'openid'}:{}),...(kind==='missing-refresh'?{refresh_token:undefined}:{})});
  }));
 expect(response.status).toBe(400);expect(calls).toBe(['missing-scope','missing-refresh'].includes(kind)?1:0);
 expect(await jobs()).toEqual(before);expect(await errors()).toEqual(history);
 expect(await env.DB.prepare("SELECT provider FROM oauth_credentials WHERE provider='google'").first()).toBeNull();
});

it('replaying a consumed OAuth state cannot reopen another job',async()=>{
 const {cfg,state,cookie}=await start();
 const request=()=>new Request(`https://app.example/api/oauth/google/callback?state=${state}&code=TEST-code`,{headers:{Cookie:cookie}});
 const mock=fetcher(async()=>Response.json(tokenReply()));
 expect((await oauthCallback(request(),cfg,mock)).status).toBe(303);
 await addJob('GOOGLE_HTTP_401');const before=await jobs(),history=await errors();
 expect((await oauthCallback(request(),cfg,mock)).status).toBe(400);
 expect(await jobs()).toEqual(before);expect(await errors()).toEqual(history);
});
