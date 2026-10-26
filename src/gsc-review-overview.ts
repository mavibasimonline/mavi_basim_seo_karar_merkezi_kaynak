import {reviewPerformance} from './gsc-review-performance';
import {Env} from './types';
import {GSC_REVIEW_CANDIDATES,GSC_REVIEW_SOURCE,reviewChecks} from './gsc-review-cohorts';

interface CrawlRow {url:string;observed_at:string;snapshot_json:string}
interface LinkSnapshot {status:number;canonical:string[];links:string[];title:string;excerpt:string;robots:string[];x_robots:string|null}
const base='https://mavibasim.com';
const canonical=(u:string)=>{try{const x=new URL(u);return x.origin===base?x.origin+x.pathname.replace(/\/$/,''):null;}catch{return null;}};

/** Bounded read-only observation: it does not represent a complete site link graph. */
export async function gscReviewOverview(env:Env,month?:string) {
  let performance:ReturnType<typeof reviewPerformance>|null=null;
  if(month){
    if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))throw new Error('INVALID_MONTH');
    const saved=await env.DB.prepare("SELECT result_json FROM analysis_runs WHERE month=? AND engine_version=? AND json_extract(filters_json,'$.device') IS NULL ORDER BY created_at DESC LIMIT 1")
      .bind(month,'1.2.2').first<{result_json:string}>();
    performance=reviewPerformance(saved?JSON.parse(saved.result_json):null,month);
  }
  const targets=GSC_REVIEW_CANDIDATES.map(c=>base+c.path);
  // Only target pages are queried here. This cannot establish inbound source counts.
  const rows=await env.DB.prepare(`SELECT q.url, s.observed_at,s.snapshot_json
    FROM json_each(?) j JOIN pages q ON q.url=j.value
    LEFT JOIN seo_snapshots s ON s.id=(SELECT id FROM seo_snapshots
      WHERE url=q.url ORDER BY observed_at DESC,rowid DESC LIMIT 1)`).bind(JSON.stringify(targets)).all<CrawlRow>();
  const observed=new Map(rows.results.filter(r=>r.observed_at).map(r=>[r.url,r]));
  return {
    source:GSC_REVIEW_SOURCE,created_at:new Date().toISOString(),performance,
    totals:{products:8,cities:18,review_candidates:26,observed_target_snapshots:observed.size},
    limitation:'Sadece hedef URL tarama gözlemleri: site çapında gelen bağlantı sayısı, Google dizin durumu veya tam GSC dönem performansı bu uç noktada doğrulanmaz.',
    rows:GSC_REVIEW_CANDIDATES.map(c=>{
      const item=observed.get(base+c.path);
      let snapshot:LinkSnapshot|null=null;
      if(item){try{snapshot=JSON.parse(item.snapshot_json) as LinkSnapshot;}catch{snapshot=null;}}
      const status=snapshot?.status??null;
      const selfCanonical=!!snapshot&&Array.isArray(snapshot.canonical)&&snapshot.canonical.length===1&&canonical(snapshot.canonical[0])===base+c.path;
      const reasons:string[]=[];
      if(!snapshot)reasons.push('Hedef sayfanın tarama kaydı bulunamadı.');
      else {
        if(status!==200)reasons.push('Son taramada HTTP 200 doğrulanmadı.');
        if(!selfCanonical)reasons.push('Tekil self-canonical doğrulanmadı.');
        if([...(snapshot.robots||[]),snapshot.x_robots||''].some(v=>/noindex/i.test(v)))reasons.push('Noindex sinyali görüldü; amaçlanan durum incelenmeli.');
      }
      reasons.push('Bağımsız gelen bağlantı kaynakları ve iki tam dönem GSC performansı henüz bu raporda doğrulanmadı.');
      if(c.group==='city-content')reasons.push('Şehir sayfasının özgün yararı ve gerçek hizmet kapsamı ayrıca incelenmeli.');
      const measured=performance&&'rows' in performance?performance.rows.find(p=>p.path===c.path):undefined;
      return {
        path:c.path,name:c.name,group:c.group,performance:measured||null,
        sampled_gsc_internal_links:c.gscInternalLinks,
        status:'Veri bekle' as const,
        observed_at:item?.observed_at||null,http_status:status,self_canonical:selfCanonical,
        reasons,checks:reviewChecks(c),
        recommendation:'Canlı sayfada otomatik değişiklik yapma.',
      };
    }),
  };
}
