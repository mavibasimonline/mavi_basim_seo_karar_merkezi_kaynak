// Local operator entry point only. Never mounted in the production application.
import {Env,json} from './types';
import {seedCrawl,crawlOne} from './crawler';
interface PilotEnv extends Env {PILOT_RUN_KEY?:string}
async function state(env:PilotEnv,counts=false){
  const targets=(await env.DB.prepare("SELECT id,canonical_url,url_verified_at FROM products WHERE id IN ('brosur','el-ilani') ORDER BY id").all()).results;
  const recent=(await env.DB.prepare('SELECT url,started_at,finished_at,status_code,error_code FROM crawls ORDER BY started_at DESC LIMIT 3').all()).results;
  const evidence=(await env.DB.prepare(`SELECT p.id product,s.observed_at,json_extract(s.snapshot_json,'$.status') status,
    json_extract(s.snapshot_json,'$.canonical[0]') canonical,json_extract(s.snapshot_json,'$.title') title,
    json_extract(s.snapshot_json,'$.body_hash') body_hash,json_extract(s.snapshot_json,'$.rendering') rendering
    FROM products p LEFT JOIN seo_snapshots s ON s.id=(SELECT id FROM seo_snapshots WHERE url=p.canonical_url ORDER BY observed_at DESC,rowid DESC LIMIT 1)
    WHERE p.id IN ('brosur','el-ilani') ORDER BY p.id`).all()).results;
  const sources=counts?await env.DB.prepare('SELECT (SELECT count(*) FROM products) products,(SELECT count(*) FROM keyword_sources) csv_files,(SELECT count(*) FROM keyword_metric_observations) csv_rows').first():undefined;
  return {targets,recent,snapshot_evidence:evidence,source_counts:sources,note:'Gerçek salt okunur site taraması; Google veya canlı site yazma çağrısı yok.'};
}
export default {
  async fetch(request:Request,env:PilotEnv){
    const url=new URL(request.url);
    if(!['127.0.0.1','localhost'].includes(url.hostname))return json({error:'LOCAL_ONLY'},403);
    if(url.pathname==='/health')return json({ok:true});
    if(!env.PILOT_RUN_KEY||request.headers.get('Authorization')!=='Bearer '+env.PILOT_RUN_KEY)return json({error:'UNAUTHORIZED'},401);
    if(env.CRAWL_ENABLED!=='true')return json({error:'CRAWL_DISABLED'},409);
    if(request.method==='GET'&&url.pathname==='/state')return json(await state(env,true));
    if(request.method!=='POST'||url.pathname!=='/run')return json({error:'NOT_FOUND'},404);
    await seedCrawl(env);await crawlOne(env);
    return json(await state(env));
  },
};
