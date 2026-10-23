import { beforeEach,describe,it,expect } from 'vitest';
import { env,init,configured,fetcher } from './helpers';
import { encrypt,decrypt,authenticated,login,equalSecret } from '../src/security';
import { oauthStart,oauthCallback,READ_SCOPES } from '../src/google';

beforeEach(init);
describe('owner authentication and token encryption',()=>{
  it('encrypts with randomized AES-GCM and rejects tampering',async()=>{
    const key=env.TOKEN_ENCRYPTION_KEY!;
    const a=await encrypt({refresh:'sensitive'},key),b=await encrypt({refresh:'sensitive'},key);
    expect(a).not.toBe(b);expect(a).not.toContain('sensitive');
    expect(await decrypt(a,key)).toEqual({refresh:'sensitive'});
    await expect(decrypt(a.slice(0,-5)+'abcde',key)).rejects.toThrow();
    expect(await equalSecret('abc','abd')).toBe(false);
  });
  it('blocks unauthorized access and authenticates signed owner session',async()=>{
    expect(await authenticated(new Request('https://app.example/api/report'),env)).toBe(false);
    const request=new Request('https://app.example/api/session',{method:'POST',headers:{Origin:'https://app.example'},body:JSON.stringify({token:env.ADMIN_TOKEN})});
    const response=await login(request,env);
    expect(response.status).toBe(200);const cookie=response.headers.get('Set-Cookie')!;
    expect(cookie).toContain('HttpOnly');expect(cookie).toContain('SameSite=Strict');
    expect(await authenticated(new Request('https://app.example/api/report',{headers:{Cookie:cookie}}),env)).toBe(true);
    expect(await authenticated(new Request('https://app.example/api/report',{headers:{Cookie:cookie.replace('mavi_session=','mavi_session=0')}}),env)).toBe(false);
  });
  it('rejects cross-site login and rate-limits failed attempts',async()=>{
    const req=(origin:string)=>new Request('https://app.example/api/session',{method:'POST',headers:{Origin:origin},body:JSON.stringify({token:'incorrect'})});
    expect((await login(req('https://evil.example'),env)).status).toBe(403);
    for(let i=0;i<5;i++)expect((await login(req('https://app.example'),env)).status).toBe(401);
    expect((await login(req('https://app.example'),env)).status).toBe(429);
  });
  it('uses one-time state and requests least required read scopes',async()=>{
    const cfg=configured();const response=await oauthStart(cfg);
    const data=await response.json() as {authorization_url:string};const url=new URL(data.authorization_url);
    expect(url.searchParams.get('scope')).toBe(READ_SCOPES.join(' '));
    const state=url.searchParams.get('state')!;
    const request=()=>new Request(`https://app.example/api/oauth/google/callback?state=${state}&code=fixture`,{headers:{Cookie:response.headers.get('Set-Cookie')!}});
    const mock=fetcher(async()=>Response.json({access_token:'access',refresh_token:'refresh',expires_in:3600,scope:READ_SCOPES.join(' ')}));
    expect((await oauthCallback(request(),cfg,mock)).status).toBe(303);
    const stored=await env.DB.prepare("SELECT encrypted_tokens FROM oauth_credentials WHERE provider='google'").first<{encrypted_tokens:string}>();
    expect(stored?.encrypted_tokens).not.toContain('refresh');
    expect((await oauthCallback(request(),cfg,mock)).status).toBe(400);
  });
  it('rejects missing OAuth consent and incomplete scopes',async()=>{
    const cfg=configured(),start=await oauthStart(cfg);const body=await start.json() as {authorization_url:string};
    const state=new URL(body.authorization_url).searchParams.get('state');
    const request=new Request(`https://app.example/api/oauth/google/callback?state=${state}&code=fixture`,{headers:{Cookie:start.headers.get('Set-Cookie')!}});
    const reply=await oauthCallback(request,cfg,fetcher(async()=>Response.json({access_token:'access',refresh_token:'refresh',expires_in:3600,scope:'openid'})));
    expect(reply.status).toBe(400);expect(await env.DB.prepare('SELECT * FROM oauth_credentials').first()).toBeNull();
  });
});
