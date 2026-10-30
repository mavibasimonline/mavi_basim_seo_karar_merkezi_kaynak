// D1-free verified Google Sheets analysis. Missing daily query/page coverage is NEVER inferred.
import {stable} from './drive-records';
export type SheetRecord={source:string;source_key:string;section:string;family:string;identity:unknown;start:string;end:string;payload:Record<string,any>;daily_page_query_coverage:false;source_filters_verified:false};
type Measurement={clicks:number;impressions:number;ctr:number;position:number};
type Entry={id:string;title:string;period:{start:string;end:string};metrics:Measurement;source_key:string;source:string;section:string};
const monthly=(r:SheetRecord)=>r.start.slice(0,7)===r.end.slice(0,7)&&r.start.endsWith('-01')&&new Date(Date.parse(r.end+'T00:00:00Z')+86400000).getUTCDate()===1;
const metric=(r:SheetRecord):Measurement=>{
 const m=r.payload.validated_metrics;
 if(!m||![m.clicks,m.impressions,m.ctr,m.position].every(Number.isFinite))throw Error('INDEPENDENT_METRICS_INVALID');
 return {clicks:m.clicks,impressions:m.impressions,ctr:m.ctr,position:m.position};
};
export function periodsOf(records:SheetRecord[]){
 return [...new Set(records.filter(r=>r.section==='OZET'&&monthly(r)).map(r=>r.start.slice(0,7)))].sort();
}
function unique(entries:Entry[]){
 const map=new Map<string,Entry>();
 for(const e of entries){if(map.has(e.id))throw Error('INDEPENDENT_AMBIGUOUS_PERIOD');map.set(e.id,e);}
 return [...map.values()].sort((a,b)=>b.metrics.clicks-a.metrics.clicks||a.title.localeCompare(b.title,'tr'));
}
function values(records:SheetRecord[],section:string,month:string):Entry[]{
 return unique(records.filter(r=>r.section===section&&monthly(r)&&r.start.startsWith(month)).map(r=>({
 id:typeof r.identity==='string'?r.identity:stable(r.identity),
 title:section==='SORGULAR'?String(r.payload.Sorgu||''):section==='URUNLER'?String(r.payload['Ürün Adı']||r.payload['Ürün ID']||r.identity):'Site geneli',
 period:{start:r.start,end:r.end},metrics:metric(r),source_key:r.source_key,source:r.source,section:r.section
 })));
}
export function independentReport(records:SheetRecord[],requested:string|undefined,capturedAt:string,quarantined:number){
 const months=periodsOf(records);
 if(!months.length)throw Error('INDEPENDENT_NO_COMPLETE_PERIOD');
 const month=requested||months.at(-1)!;
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))throw Error('INVALID_MONTH');
 if(!months.includes(month))return {available:false,month,months,source:'Google Sheets',message:'Bu ay için doğrulanmış tamamlanmış dönem kaydı yok. Eksik veri sıfır sayılamaz.',captured_at:capturedAt};
 const previous=new Date(month+'-01T00:00:00Z');previous.setUTCMonth(previous.getUTCMonth()-1);
 const prevMonth=previous.toISOString().slice(0,7);
 const overview=values(records,'OZET',month),products=values(records,'URUNLER',month),queries=values(records,'SORGULAR',month);
 const pastProducts=months.includes(prevMonth)?values(records,'URUNLER',prevMonth):[],previousMap=new Map(pastProducts.map(x=>[x.id,x]));
 const productComparisons=products.map(product=>{
  const old=previousMap.get(product.id),delta=old?product.metrics.clicks-old.metrics.clicks:null,rate=old&&old.metrics.clicks>0?delta!/old.metrics.clicks:null;
  return {...product,previous:old?.metrics||null,delta,rate,decision:!old?'Veri bekle':rate!==null&&rate>=-0.1?'Koru':rate!==null&&rate<-0.2&&delta!==null&&delta<=-30?'İncele':'Koru'};
 });
 return {available:true,month,months,previous_month:months.includes(prevMonth)?prevMonth:null,overview,products:productComparisons,queries:queries.slice(0,150),query_count:queries.length,quarantined_records:quarantined,captured_at:capturedAt,source:'Google Sheets',source_scope:'Eski doğrulanmış Sheets dönem özetleri; anlık GSC veya günlük sayfa/sorgu kanıtı değildir.',limitations:['Şehir/cihaz kırılımı kaynağın doğrulanmış alanlarında yoksa gösterilmez.','Eksik dönemler ve sorgular sıfır kabul edilmez.','Bu panel tek başına Google Search Console canlı bağlantısını kanıtlamaz.'],d1_requests:0};
}
export function independentAnswer(report:ReturnType<typeof independentReport>,question:string){
 if(typeof question!=='string'||!question.trim()||question.length>1000)throw Error('INVALID_QUESTION');
 if(!report.available)return {answer:'İstenen dönem için doğrulanmış veri yok; yorum yapılamaz.',evidence:[],decision:'Veri bekle',d1_requests:0};
 const q=question.toLocaleLowerCase('tr-TR'),r=report;
 if(/şehir|şehirler|ilçe|bölge|cihaz|mobil|masaüstü/.test(q))return {answer:'Kaynak Sheets kayıtlarında bu kırılım doğrulanmadığı için şehir veya cihaz performansı hakkında karar veremem.',evidence:[],decision:'Veri bekle',d1_requests:0};
 const selected=[...r.products].sort((a,b)=>b.title.length-a.title.length).find(p=>q.includes(p.title.toLocaleLowerCase('tr-TR'))||q.includes(p.id.toLocaleLowerCase('tr-TR')));
 if(!selected)return {answer:'Doğrulanmış ürün raporuna göre hangi ürünü inceleyelim? Örneğin “broşür neden düştü?” yazabilirsiniz. Canlı GSC kanıtı olmayan nedenleri tahmin etmem.',evidence:[],decision:'Veri bekle',d1_requests:0};
 const base=selected.previous;
 if(!base)return {answer:selected.title+' için karşılaştırılabilir önceki ay verisi yok. Düşüş veya yükseliş iddiasında bulunmuyorum.',evidence:[selected.source_key],decision:'Veri bekle',d1_requests:0};
 const delta=selected.delta!,pct=selected.rate===null?'önceki ay sıfır tıklama olduğundan yüzde karşılaştırılamıyor':(selected.rate!*100).toFixed(1)+'%';
 const trend=delta<0?'azaldı':delta>0?'arttı':'değişmedi';
 const answer=selected.title+' için '+r.previous_month+' → '+r.month+' dönemlerinde tıklama '+base.clicks+' → '+selected.metrics.clicks+' ('+Math.abs(delta)+' '+(delta<0?'düşüş':delta>0?'artış':'fark yok')+', '+pct+'). '+(selected.decision==='Koru'?'Küçük dalgalanma veya güçlü olumsuz kanıt bulunmadığından değişiklik önerilmez.':'Kayda değer düşüş işareti var; neden için günlük GSC ve değişiklik geçmişi kanıtı gerekir.')+' Bu yalnızca tarihsel Sheets karşılaştırmasıdır; nedeni kanıtlamaz.';
 return {answer,trend,evidence:[selected.source_key],decision:selected.decision,d1_requests:0,source:'Google Sheets',month:r.month};
}
