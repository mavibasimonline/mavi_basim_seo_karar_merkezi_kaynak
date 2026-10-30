// Fixed public Sheets source only. No D1, credentials, decisions or GSC job writes.
export const DRIVE_SHEET='1uKs8G9hUbmUvU8tqKfnDkZ1PbiVk-JcuJTgGqD3lB-4';
export const DRIVE_SECTIONS=['GSC_GUNLUK','OZET','URUNLER','SORGULAR'] as const;
type Row=Record<string,unknown>;
export function stable(value:unknown):string{
 if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+stable(v)).join(',')+'}';
 return JSON.stringify(value);
}
export function sourceDate(value:unknown){
 if(typeof value!=='string'&&typeof value!=='number')throw Error('SOURCE_DATE_INVALID');
 let text=String(value),match=/^Date\((\d{4}),(\d{1,2}),(\d{1,2})\)$/.exec(text);
 if(match)text=`${match[1]}-${String(Number(match[2])+1).padStart(2,'0')}-${match[3].padStart(2,'0')}`;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(text)){
  const serial=Number(text);if(!Number.isInteger(serial)||serial<36526||serial>73415)throw Error('SOURCE_DATE_INVALID');
  text=new Date(Date.UTC(1899,11,30)+serial*86400000).toISOString().slice(0,10);
 }
 const at=Date.parse(text+'T00:00:00Z');if(!Number.isFinite(at)||new Date(at).toISOString().slice(0,10)!==text||text<'2000-01-01'||text>'2100-12-31')throw Error('SOURCE_DATE_INVALID');
 return text;
}
export function gvizRows(text:string):Row[]{
 const prefix='google.visualization.Query.setResponse(',start=text.indexOf(prefix),end=text.lastIndexOf(');');
 if(start<0||end<start||text.length>20_000_000)throw Error('SHEETS_RESPONSE_INVALID');
 const data=JSON.parse(text.slice(start+prefix.length,end));
 if(data.status!=='ok'||!Array.isArray(data.table?.cols)||!Array.isArray(data.table?.rows)||data.table.rows.length>20000)throw Error('SHEETS_RESPONSE_INVALID');
 const labels=data.table.cols.map((c:any)=>c.label);
 if(labels.some((l:unknown)=>typeof l!=='string'||!l)||new Set(labels).size!==labels.length)throw Error('SOURCE_HEADER_INVALID');
 return data.table.rows.map((r:any)=>{
  if(!Array.isArray(r.c)||r.c.length>labels.length)throw Error('SOURCE_ROW_INVALID');
  const row:Row={};r.c.forEach((c:any,i:number)=>{if(c?.v!==null&&c?.v!==undefined){if(!['string','number','boolean'].includes(typeof c.v))throw Error('SOURCE_CELL_INVALID');row[labels[i]]=typeof c.v==='boolean'?(c.v?'1':'0'):String(c.v);}});return row;
 });
}
function validatedMetrics(row:Row){
 const values=['Tıklama','Gösterim','TO (%)','Ortalama Konum'].map(k=>{if(row[k]===null||row[k]===undefined||row[k]===''||typeof row[k]==='boolean')throw Error('SOURCE_METRIC_INVALID');return Number(row[k]);});
 const [clicks,impressions,ctr,position]=values;
 if(values.some(n=>!Number.isFinite(n)||n<0)||!Number.isSafeInteger(clicks)||!Number.isSafeInteger(impressions)||clicks>impressions||ctr>100||Math.abs(ctr-(impressions?clicks/impressions*100:0))>0.011||impressions>0&&position<=0)throw Error('SOURCE_METRIC_INVALID');
 return {clicks,impressions,ctr:ctr/100,position};
}
export async function verifiedDriveRecords(sheets:Record<string,Row[]>,time=new Date()){
 const periods=new Map<string,[string,string]>(),groups=new Map<string,Map<string,any>>(),day=time.toISOString().slice(0,10);
 for(const section of DRIVE_SECTIONS)if(!Array.isArray(sheets[section]))throw Error('SOURCE_SHEETS_REQUIRED');
 async function add(section:string,family:string,identity:unknown,start:string,end:string,row:Row){
  if(start>end||end>day)throw Error('SOURCE_PERIOD_INVALID');
  const metrics=validatedMetrics(row),payload={...row,'Tıklama':metrics.clicks,'Gösterim':metrics.impressions,'TO (%)':metrics.ctr*100,'Ortalama Konum':metrics.position,validated_metrics:metrics};
  delete (payload as Row)['Son Güncelleme'];
  if('Tarih' in payload)(payload as Row).Tarih=start;
  if('Başlangıç Tarihi' in payload){(payload as Row)['Başlangıç Tarihi']=start;(payload as Row)['Bitiş Tarihi']=end;}
  const record={source:DRIVE_SHEET,section,family,identity,start,end,payload,daily_page_query_coverage:false,source_filters_verified:false};
  const logical=stable([section,identity,start,end]),key=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stable(record))))].map(b=>b.toString(16).padStart(2,'0')).join('');
  let group=groups.get(logical);if(!group){group=new Map();groups.set(logical,group);}group.set(key,{source_key:key,...record});
 }
 for(const row of sheets.OZET){
  const code=String(row['Dönem Kodu']||''),period:[string,string]=[sourceDate(row['Başlangıç Tarihi']),sourceDate(row['Bitiş Tarihi'])];
  if(!code||periods.has(code)&&stable(periods.get(code))!==stable(period))throw Error('SOURCE_PERIOD_AMBIGUOUS');
  periods.set(code,period);await add('OZET','period_total',code,...period,row);
 }
 for(const row of sheets.GSC_GUNLUK){const date=sourceDate(row.Tarih);await add('GSC_GUNLUK','site_daily_total',date,date,date,row);}
 for(const section of ['URUNLER','SORGULAR'])for(const row of sheets[section]){
  const period=periods.get(String(row['Dönem Kodu']));if(!period||!row['Ürün ID']||section==='SORGULAR'&&!row.Sorgu)throw Error('SOURCE_ENTITY_OR_PERIOD_REQUIRED');
  await add(section,section==='URUNLER'?'product_period':'query_period',section==='URUNLER'?row['Ürün ID']:[row['Ürün ID'],row.Sorgu],...period,row);
 }
 const records:any[]=[];let quarantined=0;
 for(const group of groups.values()){
  if(group.size!==1){quarantined+=group.size;continue;}
  const record=group.values().next().value,end=Date.parse(record.end+'T00:00:00Z');
  const closed=record.start.endsWith('-01')&&record.start.slice(0,7)===record.end.slice(0,7)&&new Date(end+86400000).getUTCDate()===1&&end+3*86400000<Date.parse(day);
  if(record.family==='site_daily_total'||closed)records.push(record);
 }
 records.sort((a,b)=>stable([a.section,a.identity,a.start,a.end]).localeCompare(stable([b.section,b.identity,b.start,b.end]),'en'));
 return {records,record_count:records.length,quarantined_records:quarantined,daily_gsc_jobs_completed:0};
}
