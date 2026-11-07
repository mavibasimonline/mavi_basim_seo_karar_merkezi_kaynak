// Read-only, evidence-first monitoring of archived Tayfun AI SEO plans.
// No site writes, no changes to historical revisions, no causation claims.
import {readIndependentContext} from './independent-context';
import {resolvedCatalog} from './independent-catalog';
import {tayfunList,type TayfunEntry} from './tayfun-ledger';
type Store={get<T=unknown>(key:string):Promise<T|undefined>;put(key:string,value:unknown):Promise<unknown>};
type Row={page:string;device:string;clicks:number;impressions:number;position:number;query?:string};
type Month={month:string;available:boolean;days_verified:number;expected_days:number;pages:Row[];queries:Row[];evidence?:{day:string;scope:string}[]};
const previous=(month:string)=>{const d=new Date(month+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,7);};
const months=(end:string)=>{const result:string[]=[];for(let m='2026-01';m<=end&&result.length<36;){result.push(m);const d=new Date(m+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);m=d.toISOString().slice(0,7);}return result;};
const aggregate=(rows:Row[],urls:Set<string>,device:string)=>{const chosen=rows.filter(r=>urls.has(r.page)&&(device==='ALL'||r.device===device));if(!chosen.length)return {clicks:0,impressions:0,position:null as number|null,observed:false};
 const clicks=chosen.reduce((n,r)=>n+r.clicks,0),impressions=chosen.reduce((n,r)=>n+r.impressions,0);
 return {clicks,impressions,position:impressions?chosen.reduce((n,r)=>n+r.position*r.impressions,0)/impressions:null,observed:true};};
export function evaluateSeoMonitor(product:{id:string;name:string;category?:string;canonical_url:string;urls?:string[]},history:TayfunEntry[],current:Month,prior:Month,device='ALL'){
 const versions=history.filter(x=>x.url===product.canonical_url&&x.source==='ai-review').sort((a,b)=>a.created_at.localeCompare(b.created_at));
 const latest=versions.at(-1)||null,oldest=versions[0]?.created_at||null,urls=new Set(product.urls?.length?product.urls:[product.canonical_url]);
 const completeCurrent=!!current?.available&&current.days_verified===current.expected_days&&current.expected_days>0;
 const completePrior=!!prior?.available&&prior.days_verified===prior.expected_days&&prior.expected_days>0;
 const base={product_id:product.id,name:product.name,category:product.category||'',url:product.canonical_url,
  revisions:versions.length,latest_revision_id:latest?.id||null,latest_saved_at:latest?.created_at||null,first_saved_at:oldest,
  tracked_keywords:latest?.keywords||[],selected_month:current?.month,previous_month:prior?.month,
  coverage:{selected:current?.days_verified||0,selected_expected:current?.expected_days||0,previous:prior?.days_verified||0,previous_expected:prior?.expected_days||0},
  note:'SEO sürüm kaydı yayına alınmış değişiklik kanıtı değildir. GSC karşılaştırması nedensellik kanıtlamaz.'};
 const waiting=(reason:string)=>({...base,status:'bekle',label:'İzleme bekliyor',reason,previous_clicks:null,current_clicks:null,click_delta:null,change_percent:null,keywords:[]});
 if(!latest)return waiting('Bu ürüne ait kaydedilmiş yapay zekâ SEO sürümü henüz yok.');
 if(!completeCurrent||!completePrior)return waiting('Seçili ve önceki ayın doğrulanmış tam GSC sayfa verileri gerekli. Kısmi ay düşüş sayılmaz.');
 if(latest.created_at>=current.month+'-01')return waiting('Son SEO sürümü seçili ay başlamadan önce kaydedilmedi. Sonraki tam ay gözlemi bekleniyor.');
 const before=aggregate(prior.pages||[],urls,device),after=aggregate(current.pages||[],urls,device);
 const difference=after.clicks-before.clicks,ratio=before.clicks?100*difference/before.clicks:null;
 const significantDrop=before.clicks>=10&&((difference<=-30&&ratio!==null&&ratio<=-20)||(ratio!==null&&ratio<=-30))&&Math.min(before.impressions,after.impressions)>=100;
 const significantRise=(before.clicks>=10&&ratio!==null&&ratio>=30&&difference>=5||difference>=15&&ratio!==null&&ratio>=20)&&Math.min(before.impressions,after.impressions)>=100;
 const status=significantDrop?'dusuyor':significantRise?'yukseliyor':'izle';
 const oldQueries=new Map<string,{clicks:number;impressions:number}>();
 const newQueries=new Map<string,{clicks:number;impressions:number}>();
 const collect=(rows:Row[],map:Map<string,{clicks:number;impressions:number}>)=>{for(const r of rows)if(r.query&&urls.has(r.page)&&(device==='ALL'||r.device===device)){const k=r.query.toLocaleLowerCase('tr-TR').trim(),v=map.get(k)||{clicks:0,impressions:0};v.clicks+=r.clicks;v.impressions+=r.impressions;map.set(k,v);}};
 collect(prior.queries||[],oldQueries);collect(current.queries||[],newQueries);
 const keywords=[...new Set(latest.keywords||[])].slice(0,500).map(query=>{const key=query.toLocaleLowerCase('tr-TR').trim(),a=oldQueries.get(key),b=newQueries.get(key);
  return {query,previous_clicks:a?.clicks??null,current_clicks:b?.clicks??null,change:a&&b?b.clicks-a.clicks:null,
   status:!a||!b?'Görünür sorgu eksik · sıfır sayma':b.clicks>a.clicks?'Yükseldi':b.clicks<a.clicks?'Düştü':'Sabit'};});
 return {...base,status,label:significantDrop?'Önemli düşüş · incele':significantRise?'Anlamlı yükseliş · koru':'Küçük değişim · izle',
  reason:'Aynı URL ve cihaz için iki doğrulanmış tam GSC ayı karşılaştırıldı. SEO etkisi kanıtlanmadı.',previous_clicks:before.clicks,current_clicks:after.clicks,
  previous_impressions:before.impressions,current_impressions:after.impressions,click_delta:difference,change_percent:ratio,keywords};
}
export async function tayfunMonitor(storage:Store,secret:string,month:string,device:string,gsc:(period:string)=>Promise<Month>,time=new Date()){
 if(!/^20\d\d-(0[1-9]|1[0-2])$/.test(month)||month<'2026-01'||month>time.toISOString().slice(0,7))throw Error('TAYFUN_MONITOR_INVALID_MONTH');
 if(!['ALL','MOBILE','DESKTOP','TABLET'].includes(device))throw Error('TAYFUN_MONITOR_INVALID_DEVICE');
 const ctx=await readIndependentContext(storage),catalog=await resolvedCatalog(storage,secret,ctx);
 const periods=months(month);
 const ledgers=await Promise.all(periods.map(p=>tayfunList(storage,secret,p)));
 const records=ledgers.flatMap(l=>l.entries);
 const [current,prior]=await Promise.all([gsc(month),gsc(previous(month))]);
 const products=catalog.products.map(p=>evaluateSeoMonitor({id:p.id,name:p.name,category:(p as any).category,canonical_url:p.canonical_url,urls:p.urls},records,current,prior,device));
 return {month,previous_month:previous(month),device,read_only:true,site_mutations:0,d1_requests:0,
  warning_count:products.filter(p=>p.status==='dusuyor').length,rising_count:products.filter(p=>p.status==='yukseliyor').length,
  waiting_count:products.filter(p=>p.status==='bekle').length,products,
  limitation:'GSC değişimleri kaydedilmiş SEO taslağının siteye uygulandığını veya yükselişe/düşüşe neden olduğunu kanıtlamaz. Eksik ay/sorgu sıfır değildir.'};
}
