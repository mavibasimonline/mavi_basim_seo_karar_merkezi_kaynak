import {Env,hash} from './types';
// Budget/scheduler heartbeats are deliberately excluded. Only input evidence
// changes invalidate a measured response; its original measurement time is kept.
export async function evidenceRevision(env:Env){
 return JSON.stringify(await env.DB.prepare(`SELECT
  (SELECT MAX(fetched_at) FROM dataset_coverage) coverage,
  (SELECT MAX(updated_at) FROM oauth_credentials) oauth,
  (SELECT count(*) FROM oauth_credentials WHERE provider='google') connected,
  (SELECT MAX(checked_at) FROM health_checks WHERE provider IN ('gsc','ga4')) health,
  (SELECT MAX(url_verified_at) FROM products) mapping,
  (SELECT MAX(imported_at) FROM keyword_sources) archive`).first());
}
export async function cachedRead<T>(env:Env,key:string,produce:()=>Promise<T>,time=new Date()):Promise<T>{
 const revision=await evidenceRevision(env),cacheKey=await hash(key+':'+time.toISOString().slice(0,10));
 const row=await env.DB.prepare('SELECT result_json,created_at FROM api_read_cache WHERE cache_key=? AND revision=?').bind(cacheKey,revision).first<{result_json:string;created_at:string}>();
 if(row&&Date.parse(row.created_at)<=time.getTime()&&time.getTime()-Date.parse(row.created_at)<5*60_000)return JSON.parse(row.result_json) as T;
 const result=await produce();
 // A failed/replaced generation or revoked connection during calculation must
 // never persist a valid-looking response over its replacement.
 if(await evidenceRevision(env)===revision)await env.DB.prepare('INSERT INTO api_read_cache VALUES(?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET revision=excluded.revision,created_at=excluded.created_at,result_json=excluded.result_json').bind(cacheKey,revision,time.toISOString(),JSON.stringify(result)).run();
 return result;
}
