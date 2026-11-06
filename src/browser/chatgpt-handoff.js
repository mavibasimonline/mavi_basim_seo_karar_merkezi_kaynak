// Deterministic, read-only ChatGPT handoff. Never collect, write, infer missing rows or fetch providers.
// Contains the actual selected GSC/GA4/crawl evidence, not a request to remember past chats.
const dateBefore=month=>{const d=new Date(month+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,7);};
const metric=rows=>{if(!Array.isArray(rows)||!rows.length)return null;const clicks=rows.reduce((n,r)=>n+(Number(r.clicks)||0),0),impressions=rows.reduce((n,r)=>n+(Number(r.impressions)||0),0);return {clicks,impressions,ctr:impressions?clicks/impressions:null,position:impressions?rows.reduce((n,r)=>n+(Number(r.position)||0)*(Number(r.impressions)||0),0)/impressions:null};};
const grouped=(rows,key)=>{const out=new Map();for(const row of rows||[]){const k=key(row),v=out.get(k)||[];v.push(row);out.set(k,v);}return out;};
function deltaTable(now,old,key){const a=grouped(now,key),b=grouped(old,key),keys=[...new Set([...a.keys(),...b.keys()])];return keys.map(k=>{const current=metric(a.get(k)),previous=metric(b.get(k));return {key:k,current,previous,delta_clicks:current&&previous?current.clicks-previous.clicks:null,status:current&&previous?'her_iki_ayda_gorunur':current?'yalniz_guncel_ayda_gorunur':'yalniz_onceki_ayda_gorunur'};}).sort((x,y)=>(x.delta_clicks??0)-(y.delta_clicks??0)||x.key.localeCompare(y.key,'tr'));}

export function buildChatGptHandoff({month,device='ALL',current,previous,ga4,oldGa4,catalog,changes,status,ga4Status}){
 if(!/^\\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Devir için geçerli ay seçilmedi.');
 const expectedPrevious=dateBefore(month);
 const months=Array.isArray(current)?current:[];
 const end=months.find(r=>r?.month===month)||null;
 const before=previous?.month===expectedPrevious?previous:months.find(r=>r?.month===expectedPrevious)||null;
 const filter=rows=>(rows||[]).filter(r=>device==='ALL'||r.device===device);
 const monthState=r=>r?{month:r.month,source:r.source||null,timezone:r.timezone||'America/Los_Angeles',available:r.available===true,days_verified:r.days_verified??null,query_days_verified:r.query_days_verified??null,expected_days:r.expected_days??null,data_state:r.data_state||null,property_total:r.property_total||null,mapping_evidence:r.mapping_evidence||null,source_evidence:r.evidence||[],daily:(r.daily||[]).map(d=>({day:d.day,verified:d.verified===true,fetched_at:d.fetched_at||null,devices:filter(d.devices||[])})),pages:filter(r.pages),queries:filter(r.queries)}:null;
 const nowPages=filter(end?.pages),oldPages=filter(before?.pages),nowQueries=filter(end?.queries),oldQueries=filter(before?.queries);
 const products=(catalog?.products||[]).map(p=>{const urls=[...new Set(p.urls||[p.canonical_url])],match=r=>urls.includes(r.page),pageRows=deltaTable(nowPages.filter(match),oldPages.filter(match),r=>r.page),queryRows=deltaTable(nowQueries.filter(match),oldQueries.filter(match),r=>r.page+' | '+r.query+' | '+r.device+' | '+r.country);
  return {id:p.id,name:p.name,category:p.category||null,verified_at:p.url_verified_at||null,canonical_url:p.canonical_url,urls,page_comparison:pageRows,query_device_country_comparison:queryRows};
 });
 const contextEvents=Array.isArray(catalog?.changes)?catalog.changes:[];
 const safeEvent=e=>({id:e.id,url:e.url,observed_from:e.observed_from,observed_to:e.observed_to,changed_fields:e.changed_fields,publication_verified:!!e.publication_evidence,published_at:e.publication_evidence?e.published_at:null,publication_evidence:e.publication_evidence||null,before:e.before||null,after:e.after||null});
 const allEvents=contextEvents.map(safeEvent);
 const packageData={
  format:'MAVI_BASIM_CHATGPT_SEO_DEVIR_V1',purpose:'Yeni bir ChatGPT sohbetinde, hafızaya veya önceki dosyalara ihtiyaç olmadan kanıta dayalı SEO araştırması ve karar oluşturmak',
  generated_at:new Date().toISOString(),site:'https://mavibasim.com',selected_month:month,previous_month:expectedPrevious,device_filter:device,scope:'GSC seçili cihaz, tüm ülkeler; GA4 ayrı olarak tüm cihazlar ve ülkeler',
  provenance:{gsc:'Google Search Console Search Analytics API',ga4:'Google Analytics 4 Organic Search; GSC tıklamasıyla eşit değildir',changes:'Tarama aralıkları; yayın tarihi ancak bağımsız kanıt varsa kesinleşir',catalog_source_hash:catalog?.source_hash||null,catalog_captured_at:catalog?.captured_at||null,context_coverage:catalog?.coverage||null},
  completeness:{current_page_days:end?.days_verified??null,current_query_days:end?.query_days_verified??null,current_expected_days:end?.expected_days??null,previous_page_days:before?.days_verified??null,previous_query_days:before?.query_days_verified??null,previous_expected_days:before?.expected_days??null,ga4_current_closed:ga4?.month===month&&ga4.closed===true,ga4_previous_closed:oldGa4?.month===expectedPrevious&&oldGa4.closed===true,gsc_connected:status?.connected===true,ga4_connected:ga4Status?.connected===true,
   warnings:['Eksik gün/satır sıfır trafik değildir.','GSC gizlenmiş sorguları API de göstermez.','Sorgu satırlarının toplamı sayfa toplamına eşit olmak zorunda değildir.','Geçmiş tarama kaydı yokluğu SEO değişikliği yapılmadığını göstermez.','Önce/sonra tarama alanları tam sayfa metni veya yayın kanıtı değildir.','GA4 ile GSC ölçümleri farklıdır ve doğrudan farkları neden kanıtı değildir.']},
  monthly_gsc:{current:monthState(end),previous:monthState(before)},
  aggregate_observations:{page_rows:deltaTable(nowPages,oldPages,r=>r.page+' | '+r.device+' | '+r.country),query_rows:deltaTable(nowQueries,oldQueries,r=>r.page+' | '+r.query+' | '+r.device+' | '+r.country)},
  product_catalog_and_observations:products,
  ga4:{current:ga4?.month===month?ga4:null,previous:oldGa4?.month===expectedPrevious?oldGa4:null},
  seo_change_history:{events:allEvents,full_history_guaranteed:false,source_snapshots:(catalog?.snapshots||[]),source_limitations:catalog?.limitations||[],change_answer:changes?.answer||null,change_source_hash:changes?.source_hash||null},
  unresolved:['Günlük sorgu/cihaz karşılaştırmaları aylık veriden türetilmemeli; günlük sorgu serisi gerekiyorsa ayrıca kanıtlı kaynaktan alınmalı.','Tarama aralığına denk gelmek tek başına kaybın sebebi olduğunu kanıtlamaz.']
 };
 const instructions=[
  '# Mavi Basım — ChatGPT SEO devir raporu',
  'Bu rapor tek başına okunacaktır. Önceki sohbetlere veya ChatGPT hafızasına dayanma.',
  'ÖNCE KANIT, SONRA YORUM, EN SON SEO KARARI. Veriyi uydurma; eksik kayıt sıfır değildir.',
  'Görev: (1) her anlamlı ürün/URL/sorgu/cihaz yükselişini ve düşüşünü tarihler ve önce→sonra değerleriyle raporla; (2) gözlemsel mekanizmaları alternatifleriyle ayır; (3) SEO değişikliklerinin gerçek önce/sonra alanlarını karşılaştır ve yayın tarihi yoksa sebep ilan etme; (4) kazanan ve hâlâ trafik sağlayan sorguları koru; (5) hangi kontrolün yapılacağını, kanıtını ve hangi bulguda hangi sınırlı düzeltmenin uygun olacağını yaz; (6) sonraki ay için ölçülebilir takip kriteri koy.',
  'Kullanıcı sitede otomatik değişiklik istemiyor. Kullanıcıdan yeniden CSV veya geçmiş sohbet isteme. Bu pakette gerçekten bulunmayan bilgiyi açık eksik kaynak olarak belirt.',
  'Ham ölçümler ve kanıt kimlikleri aşağıdadır. JSON içindeki alanları dayanak olarak kullan; veri kapsamlarını birleştirip çift sayma.',
  '## Bağımsız kaynak paketi (JSON)',
  JSON.stringify(packageData,null,2)
 ];
 return instructions.join('\\n\\n');
}
