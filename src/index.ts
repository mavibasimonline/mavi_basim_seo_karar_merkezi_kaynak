import { Env, json, nowISO } from './types';
import { authenticated, login, safeOrigin, securityHeaders } from './security';
import { oauthCallback, oauthStart, ProviderError, boundedText, verifyGscAccess } from './google';
import { analyze, lastCompleteMonth, saveAnalysis, monthPeriod, AnalysisReport, ENGINE_VERSION, AnalysisOptions } from './analysis';
import { validateAnalysis } from './validation';
import { answerQuestion, prepareQuestion, parseQuestion } from './questions';
import { enqueueDaily, enqueueAds, claimJob, processJob, pilotGscDay } from './sync';
import { seedCrawl, crawlOne } from './crawler';
import { measureOneOutcome, recordAppliedChange } from './outcomes';
import { radar } from './radar';
import {changeCalendar,changeImpact} from './change-impact';
import {dataIntegrity} from './data-integrity';

export async function getReport(env:Env,month:string,options:AnalysisOptions={}):Promise<AnalysisReport>{
  monthPeriod(month);
  if(month<'2020-01'||month>new Date().toISOString().slice(0,7))throw new Error('INVALID_MONTH');
  const period=options.current||monthPeriod(month);
  const cached=await env.DB.prepare(`SELECT result_json,created_at,
    (SELECT checked_at FROM health_checks WHERE provider='gsc' ORDER BY day DESC LIMIT 1) health_checked_at,
    (SELECT status FROM health_checks WHERE provider='gsc' ORDER BY day DESC LIMIT 1) health_status,
    (SELECT MAX(fetched_at) FROM dataset_coverage WHERE provider='gsc' AND scope='page' AND day BETWEEN ? AND ?) coverage_fetched_at
    FROM analysis_runs WHERE month=? AND engine_version=? AND json_extract(filters_json,'$.device') IS ?
    AND json_extract(result_json,'$.sources.google_connected')=EXISTS(SELECT 1 FROM oauth_credentials WHERE provider='google')
    AND created_at>=COALESCE((SELECT MAX(stamp) FROM (
      SELECT MAX(fetched_at) AS stamp FROM dataset_coverage UNION ALL SELECT MAX(updated_at) FROM oauth_credentials
      UNION ALL SELECT MAX(checked_at) FROM health_checks UNION ALL SELECT MAX(url_verified_at) FROM products
      UNION ALL SELECT MAX(imported_at) FROM keyword_sources)), '')
    ORDER BY created_at DESC LIMIT 1`).bind(period.start,period.end,options.current?`${options.current.start}/${options.current.end}`:month,ENGINE_VERSION,options.device||null).first<{result_json:string;created_at:string;health_checked_at:string|null;health_status:string|null;coverage_fetched_at:string|null}>();
  if(cached){const result=JSON.parse(cached.result_json) as AnalysisReport;const recent=(stamp:string|null,limit:number)=>!!stamp&&Date.now()-Date.parse(stamp)>=0&&Date.now()-Date.parse(stamp)<limit;
    if(recent(cached.created_at,15*60_000)&&(result.missing.length||cached.health_status==='ok'&&recent(cached.health_checked_at,72*3600_000)&&recent(cached.coverage_fetched_at,72*3600_000)))return result;}
  const report=await analyze(env,month,new Date(),options);
  const errors=await validateAnalysis(env,report);
  if(errors.length)throw new Error('ANALYSIS_VALIDATION_FAILED');
  await saveAnalysis(env,report);
  return report;
}
async function route(request:Request,env:Env):Promise<Response>{
  const url=new URL(request.url),path=url.pathname;
  if(request.method==='GET'&&path==='/api/health')return json({ok:true,service:'Mavi Basım SEO Karar Merkezi'});
  if(request.method==='POST'&&path==='/api/session')return login(request,env);
  if(request.method==='GET'&&path==='/api/oauth/google/callback')return oauthCallback(request,env);
  if(!path.startsWith('/api/'))return env.ASSETS.fetch(request);
  if(!await authenticated(request,env))return json({error:'Giriş yapmanız gerekiyor.'},401);
  if(!['GET','HEAD'].includes(request.method)&&!safeOrigin(request))return json({error:'Geçersiz istek kaynağı.'},403);
  if(request.method==='DELETE'&&path==='/api/session')return new Response(null,{status:204,headers:{'Set-Cookie':'mavi_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'}});
  if(request.method==='POST'&&path==='/api/oauth/google/start')return oauthStart(env);
  if(request.method==='GET'&&path==='/api/gsc/verify')return json(await verifyGscAccess(env));
  if(request.method==='POST'&&path==='/api/gsc/pilot')return json(await pilotGscDay(env));
  if(request.method==='GET'&&path==='/api/status'){
    const [google,health,jobs,crawls,coverage]=await Promise.all([
      env.DB.prepare("SELECT scopes,updated_at FROM oauth_credentials WHERE provider='google'").first(),
      env.DB.prepare('SELECT * FROM health_checks ORDER BY day DESC,provider LIMIT 15').all(),
      env.DB.prepare('SELECT provider,status,count(*) AS jobs FROM sync_jobs GROUP BY provider,status').all(),
      env.DB.prepare('SELECT url,started_at,status_code,error_code FROM crawls ORDER BY started_at DESC LIMIT 5').all(),
      env.DB.prepare('SELECT provider,scope,min(day) AS earliest,max(day) AS latest,count(*) AS days FROM dataset_coverage WHERE complete=1 GROUP BY provider,scope').all(),
    ]);
    return json({google_connected:!!google,ga4_configured:!!env.GA4_PROPERTY_ID,ads_configured:env.ENABLE_GOOGLE_ADS==='true'&&!!env.GOOGLE_ADS_DEVELOPER_TOKEN,crawl_enabled:env.CRAWL_ENABLED==='true',automation_enabled:env.AUTOMATION_ENABLED==='true',health:health.results,jobs:jobs.results,crawls:crawls.results,coverage:coverage.results,
      note:'Yapılandırma veya OAuth kaydı başarılı API erişimi anlamına gelmez; günlük sağlık sonuçlarını kontrol edin.'});
  }
  if(request.method==='GET'&&path==='/api/data-integrity')return json(await dataIntegrity(env,url.searchParams.get('month')||lastCompleteMonth()));
  if(request.method==='GET'&&path==='/api/audit-history')return json({rows:(await env.DB.prepare("SELECT id,kind,created_at,result_json FROM insight_runs WHERE kind IN ('data-integrity','sync-audit') AND id>? ORDER BY id LIMIT 50").bind(url.searchParams.get('after')||'').all()).results});
  if(request.method==='GET'&&path==='/api/change-calendar')return json({rows:await changeCalendar(env,url.searchParams.get('day')||new Date().toISOString().slice(0,10),url.searchParams.get('after')||''),timezone:'UTC',note:'Takvim tespit tarihidir; kesin yayın tarihi değildir.'});
  if(request.method==='GET'&&path==='/api/change-impact')return json(await changeImpact(env,url.searchParams.get('id')||''));
  if(request.method==='GET'&&path==='/api/radar'){const plan=parseQuestion('Son 28 günde hangi ürünler yükseldi?',[]);return json(await radar(env,await getReport(env,plan.context.month,{current:plan.period,previous:plan.previous})));}
  if(request.method==='GET'&&path==='/api/report')return json(await getReport(env,url.searchParams.get('month')||lastCompleteMonth()));
  if(request.method==='POST'&&path==='/api/questions'){
    const body=await request.json() as {question?:unknown;month?:unknown;previous_question_id?:unknown};
    if(typeof body.question!=='string'||body.question.length>1000)return json({error:'Soru en fazla 1000 karakter olmalı.'},400);
    if(body.previous_question_id!==undefined&&typeof body.previous_question_id!=='string')return json({error:'Takip sorusu bağlamı geçersiz.'},400);
    const plan=await prepareQuestion(env,body.question,typeof body.month==='string'?body.month:undefined,body.previous_question_id as string|undefined);
    const filtered=!!plan.context.device||!!plan.period;
    const report=filtered?await analyze(env,plan.context.month,new Date(),{current:plan.period,previous:plan.previous,device:plan.context.device}):await getReport(env,plan.context.month);
    if(filtered){if((await validateAnalysis(env,report)).length)throw new Error('ANALYSIS_VALIDATION_FAILED');await saveAnalysis(env,report);}
    return json(await answerQuestion(env,report,body.question,plan));
  }
  if(request.method==='GET'&&path==='/api/keywords'){
    const product=url.searchParams.get('product'),after=url.searchParams.get('after')||'';
    if(!product)return json({error:'Ürün seçin.'},400);
    const rows=await env.DB.prepare(`SELECT k.id,k.keyword,k.variant_family,s.path,s.sha256,s.exported_at,s.period_label,s.location,s.language,s.network,
      o.row_number,o.avg_monthly_searches,o.advertiser_competition,o.monthly_json
      FROM keyword_catalog k JOIN keyword_metric_observations o ON o.keyword_id=k.id JOIN keyword_sources s ON s.id=o.source_id
      WHERE k.product_id=? AND k.id>? AND (s.exported_at,s.id,o.row_number)=(SELECT s2.exported_at,s2.id,o2.row_number FROM keyword_metric_observations o2 JOIN keyword_sources s2 ON s2.id=o2.source_id WHERE o2.keyword_id=k.id ORDER BY s2.exported_at DESC,s2.id DESC,o2.row_number DESC LIMIT 1)
      ORDER BY k.id LIMIT 50`).bind(product,after).all<{id:string}>();
    return json({rows:rows.results,next:rows.results.length===50?rows.results.at(-1)!.id:null,notes:['Her kelimenin son gözlemi ayrı gösterilir; tekrarlar veya varyantlar toplanmaz.','Lokasyon/dil/ağ dosyada bulunmuyorsa bilinmiyor.','Reklam rekabeti organik SEO zorluğu değildir.']});
  }
  if(request.method==='GET'&&path==='/api/history'){
    const after=url.searchParams.get('after')||'',page=url.searchParams.get('url')||'';
    const results=await env.DB.prepare('SELECT * FROM seo_change_events WHERE url=? AND id>? ORDER BY id LIMIT 50').bind(page,after).all<{id:string}>();
    return json({rows:results.results,next:results.results.length===50?results.results.at(-1)!.id:null,note:'published_at yoksa yalnızca iki tarama arasındaki tespit aralığı bilinir.'});
  }
  if(request.method==='GET'&&path==='/api/inventory'){
    const rows=await env.DB.prepare('SELECT p.*,s.id AS snapshot_id,s.observed_at,s.snapshot_json FROM pages p LEFT JOIN seo_snapshots s ON s.id=(SELECT id FROM seo_snapshots WHERE url=p.url ORDER BY observed_at DESC,rowid DESC LIMIT 1) WHERE p.url>? ORDER BY p.url LIMIT 50').bind(url.searchParams.get('after')||'').all<{url:string}>();
    return json({rows:rows.results,next:rows.results.length===50?rows.results.at(-1)!.url:null,rendering:'static-html',note:'JS render, gerçek mobil performans ve kapsamlı Lighthouse denetimi yapılmaz.'});
  }
  if(request.method==='POST'&&path==='/api/applied-changes'){
    const body=await request.json() as Parameters<typeof recordAppliedChange>[1];
    if(!body||typeof body.recommendation_id!=='string'||typeof body.applied_at!=='string'||body.old===undefined||body.new===undefined)return json({error:'Değişiklik kaydı eksik.'},400);
    return json({id:await recordAppliedChange(env,body),note:'Yalnızca uygulanan değişiklik beyanını kaydeder; canlı siteye yazmaz.'},201);
  }
  if(request.method==='GET'&&path==='/api/outcomes')return json((await env.DB.prepare('SELECT * FROM outcome_windows ORDER BY applied_change_id,days LIMIT 100').all()).results);
  if(request.method==='GET'&&path==='/api/export'){
    const report=await getReport(env,url.searchParams.get('month')||lastCompleteMonth());
    return new Response(JSON.stringify(report,null,2),{headers:{'Content-Type':'application/json','Content-Disposition':`attachment; filename="mavi-seo-${report.month}.json"`,'Cache-Control':'no-store'}});
  }
  return json({error:'Bu işlem bulunamadı.'},404);
}
export async function tick(env:Env,fetcher:typeof fetch=fetch,time=new Date()):Promise<void>{
  // An accidental Cron configuration must not start collection before operator acceptance.
  if(env.AUTOMATION_ENABLED!=='true')return;
  if(await enqueueDaily(env)){await enqueueAds(env);return;}
  // Dedicated slots prevent a long historical backfill from starving crawl/outcome work.
  if(env.CRAWL_ENABLED==='true'&&time.getUTCMinutes()===45){await seedCrawl(env);await crawlOne(env,fetcher);return;}
  if(time.getUTCMinutes()===30&&time.getUTCHours()%4===0){await measureOneOutcome(env);return;}
  // Process up to three provider pages per scheduled tick while respecting free-tier limits.
  // Each job retains its own lease, retry, and validated dataset generation.
  let processed=0;
  for(let i=0;i<3;i++){
    const job=await claimJob(env,time);
    if(!job)break;
    await processJob(env,job,fetcher);
    processed++;
  }
  if(processed)return;
  await seedCrawl(env);
  await crawlOne(env,fetcher);
  await measureOneOutcome(env);
}
export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    try{
      if(Number(request.headers.get('content-length'))>16_384)return securityHeaders(json({error:'İstek çok büyük.'},413));
      if(request.body){
        let body:string;
        try{body=await boundedText(new Response(request.body),16_384);}catch(error){if(error instanceof ProviderError&&error.code==='RESPONSE_TOO_LARGE')return securityHeaders(json({error:'İstek çok büyük.'},413));throw error;}
        request=new Request(request.url,{method:request.method,headers:request.headers,body});
      }
      return securityHeaders(await route(request,env));
    }catch(error){
      const code=error instanceof ProviderError?error.code:error instanceof Error?error.message:'UNKNOWN';
      const invalid=['INVALID_MONTH','INVALID_QUESTION','INVALID_QUESTION_CONTEXT','INVALID_APPLIED_CHANGE','INVALID_CHANGE_DAY','INVALID_CHANGE_ID','CHANGE_NOT_FOUND'].includes(code)||error instanceof SyntaxError;
      return securityHeaders(json({error:invalid?'İstek verisi geçersiz.':'İşlem tamamlanamadı. Veri kaynağı ve sistem durumunu kontrol edin.',code:invalid?'INVALID_INPUT':error instanceof ProviderError?error.code:'INTERNAL_ERROR'},invalid?400:503));
    }
  },
  async scheduled(_event:ScheduledController,env:Env,context:ExecutionContext){context.waitUntil(tick(env).catch(async()=>{
    const stamp=nowISO();
    await env.DB.prepare("INSERT INTO health_checks VALUES('scheduler',?,?,?,?) ON CONFLICT(provider,day) DO UPDATE SET checked_at=excluded.checked_at,status=excluded.status,code=excluded.code")
      .bind(stamp.slice(0,10),stamp,'failed','SCHEDULER_FAILED').run();
  }));},
};
