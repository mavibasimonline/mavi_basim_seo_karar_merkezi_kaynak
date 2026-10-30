// D1-free sign-in: rate limits are persisted in the existing private Drive Durable Object.
// Never sends the administrator secret or its submitted candidate across service bindings.
import {Env,json,hash} from './types';
import {equalSecret,safeOrigin} from './security';
export async function independentSession(request:Request,env:Env){
 const service=(env as Env&{DRIVE_ARCHIVE_SERVICE?:Fetcher}).DRIVE_ARCHIVE_SERVICE;
 if(!service||!env.ADMIN_TOKEN)return json({error:'Güvenli giriş yapılandırılmamış.'},503);
 if(!safeOrigin(request))return json({error:'Geçersiz istek kaynağı.'},403);
 const body=await request.json() as {token?:unknown};
 const candidate=body.token;
 const valid=typeof candidate==='string'&&candidate.length<=512&&await equalSecret(candidate,env.ADMIN_TOKEN);
 const client=await hash((request.headers.get('CF-Connecting-IP')||'local')+env.ADMIN_TOKEN);
 const response=await service.fetch('https://drive-archive.internal/api/independent/auth-limit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client,valid})});
 if(!response.ok)return json({error:'Güvenli giriş koruması geçici olarak kullanılamıyor.'},503);
 const verdict=await response.json() as {allowed:boolean;locked:boolean};
 if(!verdict.allowed)return json({error:verdict.locked?'Çok fazla deneme. 15 dakika sonra tekrar deneyin.':'Erişim anahtarı geçersiz.'},verdict.locked?429:401);
 if(!valid)return json({error:'Erişim anahtarı geçersiz.'},401);
 const payload=`${Date.now()+12*60*60_000}.${crypto.randomUUID()}`;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.ADMIN_TOKEN),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const mac=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload)))));
 return new Response(JSON.stringify({ok:true}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store','Set-Cookie':`mavi_session=${payload}.${mac}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`}});
}
