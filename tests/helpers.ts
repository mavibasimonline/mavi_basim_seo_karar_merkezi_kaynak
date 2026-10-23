import { env as bindings } from 'cloudflare:workers';
import { applyD1Migrations, reset } from 'cloudflare:test';
import type { D1Migration } from '@cloudflare/vitest-plugin';
import type { Env, Fetch } from '../src/types';
import { saveTokens, READ_SCOPES } from '../src/google';

export const env=bindings as Env&{TEST_MIGRATIONS:D1Migration[]};
export async function init(){
  await reset();
  await applyD1Migrations(env.DB,env.TEST_MIGRATIONS);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO product_groups VALUES('print','Broşürler & El İlanları')"),
    env.DB.prepare("INSERT INTO products(id,group_id,name,source_folder,canonical_url) VALUES('brosur','print','Broşür','group/brosur','https://mavibasim.com/brosur'),('el-ilani','print','El İlanı','group/el-ilani','https://mavibasim.com/el-ilani')"),
  ]);
}
export const fetcher=(fn:(url:string,init?:RequestInit)=>Promise<Response>)=>((input:RequestInfo|URL,init?:RequestInit)=>fn(String(input),init)) as Fetch;
export function configured(extra:Partial<Env>={}):Env{return {...env,GOOGLE_CLIENT_ID:'fixture-client',GOOGLE_CLIENT_SECRET:'fixture-secret',GOOGLE_REDIRECT_URI:'https://app.example/api/oauth/google/callback',GSC_PROPERTY:'https://mavibasim.com/',...extra};}
export async function connected(extra:Partial<Env>={}):Promise<Env>{const result=configured(extra);await saveTokens(result,{access_token:'test-access',refresh_token:'test-refresh',scope:READ_SCOPES.join(' '),expires_at:Date.now()+3600_000});return result;}
export async function enqueue(provider='gsc',scope='page',day='2026-09-01'){
  await env.DB.prepare('INSERT INTO sync_jobs(id,provider,day,scope,generation,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .bind(`${provider}:${day}:${scope}`,provider,day,scope,'fixture-generation','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z').run();
}
