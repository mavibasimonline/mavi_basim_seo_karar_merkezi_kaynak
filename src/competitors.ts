import robotsParser from 'robots-parser';
import {Env,Fetch,hash,nowISO} from './types';
import {ProviderError,boundedText} from './google';
import {parseHTML,Snapshot,CRAWLER_AGENT} from './crawler';
import {latestMarket} from './radar';
import {saveInsight} from './insights';
import {sameOriginURL,variantFamily,siteURL} from './urls';
const AGENT=CRAWLER_AGENT;
export function publicIPv4(ip:string):boolean{
 const a=ip.split('.');if(a.length!==4||a.some(s=>!/^\d{1,3}$/.test(s)||Number(s)>255||s!==String(Number(s))))return false;
 const [x,y,z]=a.map(Number);return !(x===0||x===10||x===127||x>=224||x===169&&y===254||x===172&&y>=16&&y<=31||x===192&&(y===168||y===0&&(z===0||z===2))||x===100&&y>=64&&y<=127||x===198&&(y===18||y===19||y===51&&z===100)||x===203&&y===0&&z===113);
}
export function competitorOrigin(value:string):string{
 let u:URL;try{u=new URL(value);}catch{throw new Error('INVALID_COMPETITOR_URL');}
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash||!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(u.hostname)||/(?:^|\.)(?:localhost|local|internal|invalid|test|example|onion|lan|arpa|mavibasim\.com)$/.test(u.hostname))throw new Error('INVALID_COMPETITOR_URL');return u.origin;
}
export function productMatch(title:string,headings:{level:number;text:string}[],product:string,known:string[]):boolean{
 const text=variantFamily(title+' '+headings.filter(h=>h.level===1).map(h=>h.text).join(' '));
 const matches=known.filter(name=>new RegExp(`(?:^|[^a-z0-9])${variantFamily(name)}(?:[^a-z0-9]|$)`).test(text)).sort((a,b)=>b.length-a.length);
 return !!matches.length&&variantFamily(matches[0])===variantFamily(product);
}
const TOPICS:[string,RegExp][]=[['Ebat',/\b(ebat|olcu|a[0-6]|\d+\s*x\s*\d+)\b/],['Malzeme',/\b(kuse|kraft|gramaj|karton|kagit)\b/],['Baskı tekniği',/\b(ofset|dijital|selefon)\b/],['Adet',/\b(adet|minimum|toptan)\b/],['Fiyat açıklaması',/\b(fiyat|fiyatlari|ucret|tl)\b/],['Sıkça sorulan sorular',/sikca sorulan|soru.*cevap/]];
export function topicEvidence(text:string){const normalized=variantFamily(text);return TOPICS.flatMap(([topic,pattern])=>{const match=pattern.exec(normalized);return match?[{topic,quote:text.slice(Math.max(0,match.index-35),match.index+85).slice(0,120)}]:[];});}
export function schemaTypes(data:unknown[]):string[]{
 const stack=[...data],types=new Set<string>();let checked=0;
 while(stack.length&&checked++<100){const v=stack.pop();if(Array.isArray(v)){stack.push(...v.slice(0,100));continue;}if(!v||typeof v!=='object')continue;const record=v as Record<string,unknown>;const raw=record['@type'];for(const t of Array.isArray(raw)?raw:[raw])if(typeof t==='string')types.add(t.slice(0,100));if(record['@graph'])stack.push(record['@graph']);}
 return [...types].sort().slice(0,20);
}
function summaryTopics(s:Snapshot){const topics=topicEvidence(s.excerpt);if(schemaTypes(s.structured_data).includes('FAQPage')&&!topics.some(t=>t.topic==='Sıkça sorulan sorular'))topics.push({topic:'Sıkça sorulan sorular',quote:'JSON-LD @type=FAQPage'});return topics;}
export function competitorSummary(s:Snapshot,url:string,product:string,known:string[]){
 return {url,product_match:productMatch(s.title,s.headings,product,known),title:s.title.slice(0,200),description:s.description.slice(0,400),headings:s.headings.filter(h=>h.level<=3).slice(0,20).map(h=>({...h,text:h.text.slice(0,180)})),topics:summaryTopics(s),internal_links:s.links.slice(0,50),structured_types:schemaTypes(s.structured_data),canonical:s.canonical.slice(0,3).map(v=>v.slice(0,2048)),robots:s.robots.slice(0,3).map(v=>v.slice(0,500)),x_robots:s.x_robots?.slice(0,500)||null,content_hash:s.body_hash,scope:'Statik HTML; yalnız başlıklar ve 120 karakterlik konu kanıtları, tam içerik kopyası değildir.'};
}
export function contentGaps(own:Snapshot|null,other:ReturnType<typeof competitorSummary>|null,ownFresh:boolean,otherFresh:boolean,ownURL?:string){
 if(!own||!other||!ownFresh||!otherFresh||!other.product_match||own.status!==200||own.canonical.length!==1||/noindex/i.test([...own.robots,own.x_robots||''].join(','))||!!ownURL&&siteURL(own.canonical[0])!==siteURL(ownURL))return [];
 const ownTopics=new Set(summaryTopics(own).map(t=>t.topic));
 return other.topics.filter(t=>!ownTopics.has(t.topic)).map(t=>({topic:t.topic,competitor_url:other.url,evidence:t.quote,own_state:'Mavi Basım statik özetinde bu konu için kanıt görülmedi; tam sayfa ve işletme bilgisi manuel doğrulanmalı.',priority:'İncele',risk:'Rakipte bulunması ekleme zorunluluğu değildir. Kapasite, fiyat veya teslimat iddiası oluşturmayın.'}));
}
export async function addCompetitor(env:Env,name:unknown,origin:unknown){
 if(typeof name!=='string'||!name.trim()||name.length>100||typeof origin!=='string')throw new Error('INVALID_COMPETITOR_URL');const url=competitorOrigin(origin),id=crypto.randomUUID();
 const row=await env.DB.prepare('INSERT INTO competitors(id,name,origin,created_at) SELECT ?,?,?,? WHERE (SELECT count(*) FROM competitors)<5 ON CONFLICT(origin) DO NOTHING RETURNING id').bind(id,name.trim(),url,nowISO()).first();if(!row)throw new Error('COMPETITOR_LIMIT_OR_DUPLICATE');return row;
}
export async function addCompetitorTarget(env:Env,input:{competitor_id?:unknown;product_id?:unknown;url?:unknown}){
 if(typeof input.competitor_id!=='string'||typeof input.product_id!=='string'||typeof input.url!=='string')throw new Error('INVALID_COMPETITOR_URL');
 const site=await env.DB.prepare('SELECT origin FROM competitors WHERE id=?').bind(input.competitor_id).first<{origin:string}>();if(!site)throw new Error('INVALID_COMPETITOR_URL');
 const url=sameOriginURL(input.url,site.origin,competitorOrigin(site.origin));if(!url)throw new Error('INVALID_COMPETITOR_URL');const stamp=nowISO();
 const row=await env.DB.prepare('INSERT INTO competitor_targets(id,competitor_id,product_id,url,created_at,next_attempt_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM products WHERE id=?) AND (SELECT count(*) FROM competitor_targets)<145 ON CONFLICT DO NOTHING RETURNING id').bind(crypto.randomUUID(),input.competitor_id,input.product_id,url,stamp,stamp,input.product_id).first();if(!row)throw new Error('COMPETITOR_LIMIT_OR_DUPLICATE');return row;
}
export async function crawlCompetitorOne(env:Env,fetcher:Fetch=fetch){
 if(env.AUTOMATION_ENABLED!=='true'||env.COMPETITOR_CRAWL_ENABLED!=='true')return;
 const stamp=nowISO(),lease=crypto.randomUUID();
 const target=await env.DB.prepare('UPDATE competitor_targets SET lease_token=?,lease_until=? WHERE id=(SELECT id FROM competitor_targets WHERE next_attempt_at<=? AND (lease_until IS NULL OR lease_until<?) ORDER BY next_attempt_at,id LIMIT 1) RETURNING *').bind(lease,new Date(Date.now()+120000).toISOString(),stamp,stamp).first<{id:string;competitor_id:string;product_id:string;url:string}>();if(!target)return;
 const attempt=crypto.randomUUID();await env.DB.prepare('INSERT INTO competitor_attempts(id,target_id,started_at) VALUES(?,?,?)').bind(attempt,target.id,stamp).run();
 try{
 const site=(await env.DB.prepare('SELECT * FROM competitors WHERE id=?').bind(target.competitor_id).first<{origin:string;robots_text:string|null;robots_fetched_at:string|null;next_request_at:string}>())!;
 const origin=competitorOrigin(site.origin);if(!sameOriginURL(target.url,origin,origin))throw new ProviderError('COMPETITOR_ORIGIN_MISMATCH');
 if(Date.parse(site.next_request_at)>Date.now())throw new ProviderError('CRAWL_DELAY');
 const get=async(url:string)=>{const response=await fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(10000),headers:{'User-Agent':AGENT,Accept:url.startsWith('https://cloudflare-dns.com/')?'application/dns-json':'text/html,text/plain'}});if(response.status===429){const raw=response.headers.get('Retry-After')||'',seconds=/^\d+$/.test(raw)?Number(raw):Math.ceil((Date.parse(raw)-Date.now())/1000);await response.body?.cancel();throw new ProviderError(url.startsWith('https://cloudflare-dns.com/')?'DNS_HTTP_429':url.endsWith('/robots.txt')?'ROBOTS_HTTP_429':'COMPETITOR_HTTP_429',true,Math.max(0,Math.min(seconds||0,86400)));}return response;};
 const dns=await get('https://cloudflare-dns.com/dns-query?name='+encodeURIComponent(new URL(origin).hostname)+'&type=A');if(!dns.ok)throw new ProviderError('DNS_UNAVAILABLE');
 const reply=JSON.parse(await boundedText(dns,20000)) as {Status:number;Answer?:{type:number;data:string}[]};const ips=reply.Answer?.filter(a=>a.type===1).map(a=>a.data)||[];
 if(reply.Status!==0||!ips.length||ips.some(ip=>!publicIPv4(ip)))throw new ProviderError('UNSAFE_OR_UNSUPPORTED_DNS');
 let robots=site.robots_text;
 if(robots===null||!site.robots_fetched_at||Date.now()-Date.parse(site.robots_fetched_at)>86400000){const r=await get(origin+'/robots.txt');if(![200,404].includes(r.status))throw new ProviderError('ROBOTS_HTTP_'+r.status);robots=r.status===404?'':await boundedText(r,256000);const delay=Math.max(60,robotsParser(origin+'/robots.txt',robots).getCrawlDelay(AGENT)||0);await env.DB.prepare('UPDATE competitors SET robots_text=?,robots_fetched_at=?,next_request_at=? WHERE id=?').bind(robots,stamp,new Date(Date.now()+delay*1000).toISOString(),target.competitor_id).run();throw new ProviderError('CRAWL_DELAY');}
 const parser=robotsParser(origin+'/robots.txt',robots);if(parser.isAllowed(target.url,AGENT)===false)throw new ProviderError('ROBOTS_DISALLOWED');
 const reserved=await env.DB.prepare('UPDATE competitors SET next_request_at=? WHERE id=? AND next_request_at<=? RETURNING id').bind(new Date(Date.now()+Math.max(60,parser.getCrawlDelay(AGENT)||0)*1000).toISOString(),target.competitor_id,stamp).first();if(!reserved)throw new ProviderError('CRAWL_DELAY');
 const response=await get(target.url);await env.DB.prepare('UPDATE competitor_attempts SET status_code=? WHERE id=?').bind(response.status,attempt).run();if(response.status!==200)throw new ProviderError('COMPETITOR_HTTP_'+response.status);if(!response.headers.get('content-type')?.includes('text/html'))throw new ProviderError('COMPETITOR_NOT_HTML');
 const html=await boundedText(response,1000000);if(response.headers.get('cf-mitigated')==='challenge'||/<input[^>]*type=["']?password\b|cf-chl|g-recaptcha|hcaptcha|verify.{0,30}human/i.test(html))throw new ProviderError('ACCESS_WALL_OR_CAPTCHA');
 const products=(await env.DB.prepare('SELECT id,name FROM products').all<{id:string;name:string}>()).results;
 const summary=competitorSummary(await parseHTML(html,target.url,200,response.headers,origin),target.url,products.find(p=>p.id===target.product_id)!.name,products.map(p=>p.name));
 const previous=await env.DB.prepare('SELECT * FROM competitor_snapshots WHERE target_id=? ORDER BY observed_at DESC,rowid DESC LIMIT 1').bind(target.id).first<{id:string;observed_at:string;summary_json:string;summary_hash:string}>();
 const id=crypto.randomUUID(),digest=await hash(JSON.stringify(summary)),statements=[env.DB.prepare('INSERT INTO competitor_snapshots SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM competitor_targets WHERE id=? AND lease_token=?)').bind(id,target.id,stamp,digest,JSON.stringify(summary),target.id,lease)];
 if(previous&&previous.summary_hash!==digest&&summary.product_match&&JSON.parse(previous.summary_json).product_match){const old=JSON.parse(previous.summary_json),diff=Object.fromEntries(Object.keys(summary).filter(k=>JSON.stringify(old[k])!==JSON.stringify((summary as any)[k])).map(k=>[k,{old:old[k],new:(summary as any)[k]}]));statements.push(env.DB.prepare('INSERT INTO competitor_events SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM competitor_snapshots WHERE id=?)').bind(crypto.randomUUID(),target.id,previous.id,id,previous.observed_at,stamp,JSON.stringify(diff),id));}
 statements.push(env.DB.prepare('UPDATE competitors SET last_success=?,last_error=NULL WHERE id=? AND EXISTS(SELECT 1 FROM competitor_targets WHERE id=? AND lease_token=?)').bind(stamp,target.competitor_id,target.id,lease));
 statements.push(env.DB.prepare('UPDATE competitor_targets SET status=?,last_success=?,next_attempt_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?').bind(summary.product_match?'ok':'mapping_unverified',stamp,new Date(Date.now()+86400000).toISOString(),target.id,lease));
 statements.push(env.DB.prepare('UPDATE competitor_attempts SET finished_at=? WHERE id=?').bind(nowISO(),attempt));const stored=await env.DB.batch(statements);if(!stored[0].meta.changes)await env.DB.prepare("UPDATE competitor_attempts SET error_code='LEASE_SUPERSEDED' WHERE id=?").bind(attempt).run();
 }catch(error){
 const failure=error instanceof ProviderError?error:new ProviderError('COMPETITOR_NETWORK_OR_PARSE_ERROR'),code=failure.code;
 const wait=Math.max(/ROBOTS_DISALLOWED|HTTP_40[13]|ACCESS_WALL|UNSAFE_|ORIGIN_MISMATCH/.test(code)?86400:3600,failure.retryAfterSeconds);
 const next=new Date(Date.now()+wait*1000).toISOString();
 await env.DB.batch([
  env.DB.prepare('UPDATE competitor_attempts SET finished_at=?,error_code=?,status_code=COALESCE(status_code,?) WHERE id=?').bind(nowISO(),code,code==='COMPETITOR_HTTP_429'?429:null,attempt),
  env.DB.prepare('UPDATE competitors SET last_error=?,next_request_at=CASE WHEN ? THEN MAX(next_request_at,?) ELSE next_request_at END WHERE id=? AND EXISTS(SELECT 1 FROM competitor_targets WHERE id=? AND lease_token=?)').bind(code,Number(failure.retryAfterSeconds>0||/ROBOTS_HTTP_40[13]|ACCESS_WALL/.test(code)),next,target.competitor_id,target.id,lease),
  env.DB.prepare("UPDATE competitor_targets SET status='blocked',next_attempt_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?").bind(next,target.id,lease)
 ]);
 }
}
export async function competitorsView(env:Env,after=''){
 const [sites,targets,history,products,market]=await Promise.all([env.DB.prepare('SELECT id,name,origin,last_success,last_error FROM competitors ORDER BY name').all(),env.DB.prepare(`SELECT t.*,p.name,p.canonical_url,p.url_verified_at,s.id snapshot_id,s.observed_at,s.summary_json FROM competitor_targets t JOIN products p ON p.id=t.product_id LEFT JOIN competitor_snapshots s ON s.id=(SELECT id FROM competitor_snapshots WHERE target_id=t.id ORDER BY observed_at DESC,rowid DESC LIMIT 1) WHERE t.id>? ORDER BY t.id LIMIT 20`).bind(after).all<any>(),env.DB.prepare('SELECT e.*,t.url,t.product_id FROM competitor_events e JOIN competitor_targets t ON t.id=e.target_id ORDER BY observed_to DESC LIMIT 30').all(),env.DB.prepare('SELECT id,name FROM products ORDER BY name').all<{id:string;name:string}>(),latestMarket(env)]);
 const comparisons=[];
 for(const t of targets.results){const own=t.canonical_url?await env.DB.prepare('SELECT id,observed_at,snapshot_json,(SELECT error_code FROM crawls WHERE url=seo_snapshots.url ORDER BY started_at DESC,rowid DESC LIMIT 1) latest_error,(SELECT status_code FROM crawls WHERE url=seo_snapshots.url ORDER BY started_at DESC,rowid DESC LIMIT 1) latest_http FROM seo_snapshots WHERE url=? ORDER BY observed_at DESC,rowid DESC LIMIT 1').bind(t.canonical_url).first<{id:string;observed_at:string;snapshot_json:string;latest_error:string|null;latest_http:number|null}>():null;const summary=t.summary_json?JSON.parse(t.summary_json):null;const fresh=(stamp:string|null,days:number)=>!!stamp&&Date.now()-Date.parse(stamp)>=0&&Date.now()-Date.parse(stamp)<days*86400000;comparisons.push({target_id:t.id,product_id:t.product_id,name:t.name,url:t.canonical_url,competitor_url:t.url,status:t.status,comparison_status:t.status==='ok'&&!!own&&own.latest_http===200&&!own.latest_error&&!!summary&&summary.product_match&&!!t.url_verified_at&&fresh(own.observed_at,3)&&fresh(t.observed_at,7)?'Gözlemsel karşılaştırma':'Veri yetersiz',own_fresh:!!own&&own.latest_http===200&&!own.latest_error&&fresh(own.observed_at,3),competitor_fresh:t.status==='ok'&&fresh(t.observed_at,7),observed_at:t.observed_at||null,summary,competitor_snapshot_id:t.snapshot_id||null,market_demand:market.results.filter(m=>m.product_id===t.product_id),own_snapshot:own?{id:own.id,observed_at:own.observed_at,...competitorSummary(JSON.parse(own.snapshot_json),t.canonical_url,t.name,products.results.map(p=>p.name))}:null,gaps:contentGaps(own?JSON.parse(own.snapshot_json):null,summary,!!t.url_verified_at&&!!own&&own.latest_http===200&&!own.latest_error&&fresh(own.observed_at,3),t.status==='ok'&&fresh(t.observed_at,7),t.canonical_url||undefined)});}
 const result={id:crypto.randomUUID(),measured_at:nowISO(),source:'İzinli rakip/Mavi Basım statik taramaları + ayrı Keyword Planner arşivi',sites:sites.results,products:products.results,comparisons,next:targets.results.length===20?targets.results.at(-1)!.id:null,history:history.results,crawl_enabled:env.AUTOMATION_ENABLED==='true'&&env.COMPETITOR_CRAWL_ENABLED==='true',note:'Gerçek tarama yoksa karşılaştırma yok. Eksik konu adayları sınırlı statik özete dayanır; kapasite/fiyat/teslimat iddiası veya otomatik site değişikliği üretmez.'};
 return saveInsight(env,'competitor-comparison',await hash(JSON.stringify([sites.results,comparisons,history.results,market.results,result.crawl_enabled])),result);
}
