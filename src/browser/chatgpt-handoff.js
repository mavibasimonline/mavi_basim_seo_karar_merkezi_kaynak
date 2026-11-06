// Read-only ChatGPT handoff. Raw rows occur exactly once; no remote calls or writes.
// The human-readable lead is a navigation aid. Raw sources remain authoritative.
const previousMonth=month=>{const d=new Date(month+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,7);};
const num=(v)=>Number.isFinite(v)?v:null;
const metric=rows=>{
 if(!rows?.length)return null;
 const clicks=rows.reduce((n,r)=>n+(Number(r.clicks)||0),0),impressions=rows.reduce((n,r)=>n+(Number(r.impressions)||0),0);
 return {clicks,impressions,ctr:impressions?clicks/impressions:null,position:impressions?rows.reduce((n,r)=>n+(Number(r.position)||0)*(Number(r.impressions)||0),0)/impressions:null};
};
const groups=(rows,key)=>{
 const map=new Map();
 for(const r of rows||[]){const k=key(r),bucket=map.get(k)||[];bucket.push(r);map.set(k,bucket);}
 return map;
};
const paired=(now,old,key)=>{
 const a=groups(now,key),b=groups(old,key),keys=new Set([...a.keys(),...b.keys()]);
 return [...keys].map(k=>{
  const current=metric(a.get(k)),previous=metric(b.get(k));
  return {key:k,current,previous,delta_clicks:current&&previous?current.clicks-previous.clicks:null,status:current&&previous?'karşılaştırılabilir':current?'yalnız güncel dönemde görünür':'yalnız önceki dönemde görünür'};
 });
};
const aggregate=(items,side='current')=>metric(items.flatMap(x=>x[side]||[]));
const formatMetric=m=>m?m.clicks+' tıklama / '+m.impressions+' gösterim / CTR '+(m.ctr===null?'belirsiz':(m.ctr*100).toFixed(2)+'%')+' / konum '+(m.position===null?'belirsiz':m.position.toFixed(2)):'doğrulanmadı';
const groupTop=(rows,order)=>rows.filter(r=>r.delta_clicks!==null&&r.delta_clicks*(order===1?1:-1)>0).sort((a,b)=>order*(b.delta_clicks-a.delta_clicks)).slice(0,15);
const differences=rows=>rows.filter(r=>r.status!=='karşılaştırılabilir');
const ga4Facets=report=>{
 if(!report)return null;
 const total=num(report.totals?.sessions);
 const facets={};
 for(const name of ['devices','cities','pages']){
  const rows=report[name];
  if(Array.isArray(rows)){const sum=rows.reduce((n,r)=>n+(Number(r.sessions)||0),0);facets[name]={rows:rows.length,sessions_sum:sum,official_sessions:total,delta_vs_official:total===null?null:sum-total,not_additive_to_other_facets:true};}
 }
 return {month:report.month,closed:report.closed===true,official:report.totals||null,facets};
};
function describePairs(rows,label){
 const ascending=rows.filter(r=>r.delta_clicks!==null).sort((a,b)=>a.delta_clicks-b.delta_clicks);
 const losers=ascending.filter(r=>r.delta_clicks<0).slice(0,12),gainers=ascending.filter(r=>r.delta_clicks>0).reverse().slice(0,12);
 const lines=[label+' — karşılaştırılabilir gözlemler'];
 for(const [kind,subset] of [['Kayıplar',losers],['Artışlar',gainers]]){
  lines.push(kind+': '+(subset.length?subset.map(r=>r.key+' ('+r.previous.clicks+' → '+r.current.clicks+', '+(r.delta_clicks>0?'+':'')+r.delta_clicks+')').join('; '):'Önemli karşılaştırılabilir kayıt bulunmadı'));
 }
 return lines.join('\n');
}
function monthBundle(r,device){
 if(!r)return null;
 const filter=rows=>(rows||[]).filter(item=>device==='ALL'||item.device===device);
 return {
  month:r.month,source:r.source||null,timezone:r.timezone||'America/Los_Angeles',available:r.available===true,
  days_verified:r.days_verified??null,query_days_verified:r.query_days_verified??null,expected_days:r.expected_days??null,
  data_state:r.data_state??null,property_total:r.property_total||null,
  mapping_evidence:r.mapping_evidence||null,
  // One daily source receipt per day and scope; original row/hash identifiers are preserved.
  source_evidence:r.evidence||[],
  daily:(r.daily||[]).map(d=>({day:d.day,verified:d.verified===true,fetched_at:d.fetched_at||null,devices:filter(d.devices)})),
  pages:filter(r.pages),queries:filter(r.queries)
 };
}

// Categories are URL-based evidence scopes; a city landing page is not the same as a GA4 visitor city.
const citySlugs=new Set(('adana adiyaman afyonkarahisar agri aksaray amasya ankara antalya ardahan artvin aydin balikesir bartin batman bayburt bilecik bingol bitlis bolu burdur bursa canakkale cankiri corum denizli diyarbakir duzce edirne elazig erzincan erzurum eskisehir gaziantep giresun gumushane hakkari hatay igdir isparta istanbul izmir kahramanmaras karabuk karaman kars kastamonu kayseri kirikkale kirklareli kirsehir kilis kocaeli konya kutahya malatya manisa mardin mersin mugla mus nevsehir nigde ordu osmaniye rize sakarya samsun sanliurfa siirt sinop sirnak sivas tekirdag tokat trabzon tunceli usak van yalova yozgat zonguldak').split(' '));
const urlPath=u=>{try{return new URL(u,'https://mavibasim.com').pathname.toLowerCase().replace(/\\/$/,'')||'/';}catch{return '';}};
function classifySeoUrl(url,products){
 const path=urlPath(url);
 if(path==='/blog'||path.startsWith('/blog/'))return 'blog';
 if(path==='/sektor'||path.startsWith('/sektor/'))return 'sektorel';
 const product=products.find(p=>p.urls.some(u=>urlPath(u)===path));
 if(product)return 'urun';
 const slug=path.slice(1).split('-')[0];
 if(citySlugs.has(slug)&&path.length>slug.length+1)return 'sehir';
 if(citySlugs.has(slug)&&path==='/'+slug)return 'sehir';
 return 'diger';
}
const byDevice=rows=>{
 const values=groups(rows||[],r=>r.device||'BILINMIYOR');
 return [...values.entries()].map(([device,records])=>({device,...metric(records)})).sort((a,b)=>a.device.localeCompare(b.device));
};
const labeledMetric=m=>m?m.clicks+' tıklama; '+m.impressions+' gösterim; CTR '+(m.ctr===null?'?':(100*m.ctr).toFixed(2)+'%')+'; konum '+(m.position===null?'?':m.position.toFixed(2)):'bu ay kayıt yok (sıfır olduğu kanıtlanmadı)';
function categorySections(now,before,products){
 const categories=[['urun','Ürün sayfaları'],['sehir','Şehir ve şehre özel baskı sayfaları'],['sektorel','Sektörel sayfalar'],['blog','Blog yazıları'],['diger','Diğer sayfalar']];
 const sections=[],classCounts={},taxonomy={rules:'Kanonik ürün katalog URL’leri ürün; /blog/ blog; /sektor/ sektörel; il adıyla başlayan diğer URL’ler şehir; kalanlar diğer. GA4 ziyaretçi şehri, şehir SEO URL sınıfına girmez.',classification_version:'url-category-v1'};
 for(const [id,title] of categories){
  const pick=rows=>(rows||[]).filter(r=>classifySeoUrl(r.page,products)===id);
  const currentRows=pick(now?.pages),priorRows=pick(before?.pages);
  const currentQueries=pick(now?.queries),priorQueries=pick(before?.queries);
  const pages=paired(currentRows,priorRows,r=>r.page);
  const queries=paired(currentQueries,priorQueries,r=>r.page+' | '+r.query);
  const totalNow=metric(currentRows),totalBefore=metric(priorRows);
  const countNow=new Set(currentRows.map(r=>r.page)).size,countBefore=new Set(priorRows.map(r=>r.page)).size;
  classCounts[id]={current_url_count:countNow,previous_url_count:countBefore,current_page_rows:currentRows.length,previous_page_rows:priorRows.length,not_all_indexed_urls:true};
  const worst=pages.filter(r=>r.delta_clicks<0).sort((a,b)=>a.delta_clicks-b.delta_clicks).slice(0,8);
  const best=pages.filter(r=>r.delta_clicks>0).sort((a,b)=>b.delta_clicks-a.delta_clicks).slice(0,8);
  const queryLoss=queries.filter(r=>r.delta_clicks<0).sort((a,b)=>a.delta_clicks-b.delta_clicks).slice(0,5);
  const queryGain=queries.filter(r=>r.delta_clicks>0).sort((a,b)=>b.delta_clicks-a.delta_clicks).slice(0,5);
  const list=items=>items.length?items.map(x=>x.key+' ['+x.previous.clicks+'→'+x.current.clicks+'; '+(x.delta_clicks>0?'+':'')+x.delta_clicks+']').join('; '):'iki ayda ortak kayıtla doğrulanmış önemli değişim yok';
  const devices=new Set([...byDevice(currentRows).map(x=>x.device),...byDevice(priorRows).map(x=>x.device)]);
  const dBefore=Object.fromEntries(byDevice(priorRows).map(x=>[x.device,x])),dNow=Object.fromEntries(byDevice(currentRows).map(x=>[x.device,x]));
  const deviceLines=[...devices].sort().map(d=>d+': '+labeledMetric(dBefore[d])+' → '+labeledMetric(dNow[d]));
  sections.push('## '+title+' — URL bazlı GSC incelemesi',
   'Kayıtlı URL sayısı: '+countBefore+' → '+countNow+' (dizindeki toplam URL sayısı değildir).',
   'Kayıtlı sayfa kırılımı: '+labeledMetric(totalBefore)+' → '+labeledMetric(totalNow)+'. Resmî mülk toplamından ayrı tutulur.',
   'Mobil / masaüstü / tablet URL kırılımı:\\n'+(deviceLines.length?deviceLines.join('\\n'):'GSC satırı bulunmuyor.'),
   'Tıklama kaybeden URL’ler: '+list(worst),
   'Tıklama kazanan URL’ler: '+list(best),
   'Görünür kayıp sorgular: '+list(queryLoss),
   'Görünür kazanan sorgular: '+list(queryGain),
   'Tek ayda görünen URL/sorgu satırları diğer ayda sıfır sayılmaz; ham kaynak paketinde mevcuttur.'
  );
 }
 const dailyTotals=r=>{
  if(!r)return null;
  return {month:r.month,verified_days:r.daily?.filter(d=>d.verified).length??null,expected_days:r.expected_days,
   by_device:byDevice((r.daily||[]).filter(d=>d.verified).flatMap(d=>d.devices||[])),
   caveat:'Günlük seri site geneli cihaz toplamlarından üretilmiştir. URL veya sorgunun gün bazlı hareketini göstermez.'};
 };
 return {sections,classification:{...taxonomy,counts:classCounts},daily_device_totals:{current:dailyTotals(now),previous:dailyTotals(before)}};
}

export function buildChatGptHandoff({month,device='ALL',current,previous,ga4,oldGa4,catalog,changes,status,ga4Status}){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Devir için geçerli ay seçilmedi.');
 const prev=previousMonth(month),months=Array.isArray(current)?current:[],cur=months.find(r=>r?.month===month)||null;
 const old=previous?.month===prev?previous:months.find(r=>r?.month===prev)||null;
 const now=monthBundle(cur,device),before=monthBundle(old,device);
 const entries=paired(now?.pages,before?.pages,r=>r.page);
 const qEntries=paired(now?.queries,before?.queries,r=>r.page+' | '+r.query);
 const selectedPage=metric(now?.pages),priorPage=metric(before?.pages);
 const activeTotal=cur?.property_total||null,priorTotal=old?.property_total||null;
 const isAll=device==='ALL';
 const ga4Current=ga4?.month===month?ga4:null,ga4Previous=oldGa4?.month===prev?oldGa4:null;
 const gscReconcile=r=>{
  if(!r)return null;
  const reported=metric((r.pages||[]).filter(x=>device==='ALL'||x.device===device));
  const official=isAll?r.property_total||null:null;
  return {month:r.month,scope_device:device,reported_page_rows:r.pages?.length??null,reported_page_clicks:reported?.clicks??null,official_site_clicks:official?.clicks??null,
   observed_minus_official:reported&&official?reported.clicks-official.clicks:null,
   caveat:isAll?'Resmî mülk toplamı ile bu dosyadaki sayfa kırılımı farklı kapsam/satır sınırlarına sahip olabilir. Aradaki farkı kayıp trafik olarak yorumlama.':'Resmî mülk toplamı tüm cihazlar içindir; cihaz filtreli sayfa toplamıyla karşılaştırılamaz.'};
 };
 const products=(catalog?.products||[]).map(p=>({id:p.id,name:p.name,category:p.category||null,canonical_url:p.canonical_url,urls:[...new Set(p.urls||[p.canonical_url])],verified_at:p.url_verified_at??null}));
 const events=(catalog?.changes||[]).map(e=>({id:e.id,url:e.url,observed_from:e.observed_from,observed_to:e.observed_to,
  changed_fields:e.changed_fields,publication_evidence:e.publication_evidence||null,published_at:e.publication_evidence?e.published_at:null,
  before:e.before||null,after:e.after||null}));
 const inChanges=new Set(events.flatMap(e=>[e.before?.id,e.after?.id]).filter(Boolean));
 const uncoveredSnapshots=(catalog?.snapshots||[]).filter(s=>!inChanges.has(s.id));
 const classified=categorySections(now,before,products);
 const data={
  taxonomy:classified.classification,daily_device_totals:classified.daily_device_totals,
  format:'MAVI_BASIM_CHATGPT_SEO_DEVIR_V2',site:'https://mavibasim.com',generated_at:new Date().toISOString(),
  selected_month:month,previous_month:prev,device_filter:device,
  source_scope:{gsc:'GSC Search Analytics API, seçilen cihaz, tüm ülkeler',ga4:'GA4 Organic Search, tüm cihazlar ve ülkeler',timezone_gsc:'America/Los_Angeles'},
  completeness:{current_page_days:cur?.days_verified??null,current_query_days:cur?.query_days_verified??null,current_expected_days:cur?.expected_days??null,
   previous_page_days:old?.days_verified??null,previous_query_days:old?.query_days_verified??null,previous_expected_days:old?.expected_days??null,
   ga4_current_closed:ga4Current?.closed===true,ga4_previous_closed:ga4Previous?.closed===true,
   gsc_connected:status?.connected===true,ga4_connected:ga4Status?.connected===true},
  reconciliation:{gsc:{current:gscReconcile(cur),previous:gscReconcile(old)},ga4:{current:ga4Facets(ga4Current),previous:ga4Facets(ga4Previous)}},
  gsc:{current:now,previous:before},
  catalog:{products,source_hash:catalog?.source_hash||null,captured_at:catalog?.captured_at||null,coverage:catalog?.coverage||null,limitations:catalog?.limitations||[]},
  ga4:{current:ga4Current,previous:ga4Previous},
  seo_change_history:{events,other_snapshots:uncoveredSnapshots,full_history_guaranteed:false,source_answer:changes?.answer||null},
  caveats:['Eksik satır ve görünmeyen arama sorgusu sıfır değildir. Yalnız iki dönemde de görünen sorguların tıklama farkı kesin karşılaştırmadır.',
   'GSC resmî mülk toplamı, kayıtlı sayfa/sorgu toplamı ve GA4 oturumları farklı ölçümler/kapsamlardır; toplanmaz.',
   'GA4 şehir/cihaz/sayfa kırılımları resmî toplama eşit olmayabilir; her birini ayrı mutabakatla değerlendir.',
   'Tarama öncesi/sonrası hash değişikliği, gerçek metin değişikliğini veya kesin yayın tarihini tek başına göstermez.',
   'Tarama geçmişi son 100 olayla sınırlı olabilir; eksik geçmişte değişiklik olmadığı varsayılmaz.',
   'Günlük GSC verisi bu dosyada cihaz toplamları düzeyindedir; günlük sorgu dökümü mevcut değilse varmış gibi davranma.']
 };
 const dates=(cur?.days_verified??'?')+'/'+(cur?.expected_days??'?')+' sayfa günü, '+(cur?.query_days_verified??'?')+'/'+(cur?.expected_days??'?')+' sorgu günü; önceki '+(old?.days_verified??'?')+'/'+(old?.expected_days??'?');
 const synopsis=[
  '# Mavi Basım · ChatGPT SEO devir raporu',
  'Dönem: '+prev+' → '+month+' · Cihaz: '+device+' · GSC kapsamı: '+dates,
  '**Önce kanıt, sonra yorum, en son SEO kararı.** Eksik kayıt sıfır değildir; gözlenen eşzamanlılık kesin neden değildir.',
  '## Doğrulanabilir başlangıç özeti',
  'Resmî GSC mülk toplamı (tüm cihazlar): '+(priorTotal?formatMetric(priorTotal):'yok')+' → '+(activeTotal?formatMetric(activeTotal):'yok')+'. Bu tüm cihaz ölçümü, seçilen cihazın sayfa dökümü değildir.',
  'Dışa aktarılan GSC sayfa satırları: '+formatMetric(priorPage)+' → '+formatMetric(selectedPage)+'. Resmî mülk toplamıyla bir tutma.',
  'GA4 resmî Organic Search oturumları: '+(ga4Previous?.totals?.sessions??'doğrulanmadı')+' → '+(ga4Current?.totals?.sessions??'doğrulanmadı')+'. GSC tıklamasıyla eşit değil.',
  ...classified.sections,
  'Önemli koruma kuralı: Önceki veya güncel ayda trafik getiren sorguları; artışları ve düşüşleri birlikte değerlendir. Özellikle gerilemiş olsa bile hâlâ trafik getirenleri koru.',
  '## Mutabakat ve veri sınırları',
  'GSC dışa aktarılan sayfa / resmî site (güncel): '+(selectedPage?.clicks??'yok')+' / '+(isAll?activeTotal?.clicks??'yok':'tüm-cihaz toplamıyla kıyaslanamaz')+'.',
  'GA4 güncel oturum / cihaz satır toplamı / şehir satır toplamı / sayfa satır toplamı: '+[ga4Current?.totals?.sessions,ga4Facets(ga4Current)?.facets?.devices?.sessions_sum,ga4Facets(ga4Current)?.facets?.cities?.sessions_sum,ga4Facets(ga4Current)?.facets?.pages?.sessions_sum].map(v=>v??'?').join(' / ')+'. Bu sayılar eşit olmayabilir; farkları saklama.',
  '## ChatGPT görevi',
  'Bu dosya tek başına yeterli bağlam olmalıdır. Önceki konuşma, hatıra veya yeniden CSV isteme. Varsa eksik kanıtı adıyla belirt.',
  'Ürün, şehir sayfası, sektörel sayfa ve blog analizlerini birbirinden ayrı raporla; her grubun mobil/masaüstü performansını ve kazanan-kaybeden URL/sorgularını ele al. GA4 ziyaretçinin şehrini şehir sayfası trafiği sanma. Günlük cihaz toplamlarından günlük URL veya sorgu kaybı türetme.',
  'Her anlamlı ürün, URL, sorgu ve cihaz artış/kaybını değerlendir; nedeni kanıtlanmış olay ile olası açıklamayı ayır; yayın doğrulaması olmayan tarama aralığını kesin neden sayma.',
  'Kazanan/aktif sorguları koru. Her önemli aday için: Ne oldu? Tarihli kanıt? Alternatif neden? Ne kontrol edilmeli? Hangi doğrulanmış bulguda hangi sınırlı düzeltme yapılmalı? Sonraki ay hangi ölçümle izlenecek? sorularını yanıtla.',
  'Kullanıcının onayı olmadan canlı siteye değişiklik önerisi uygulanmaz. Gösterim artarken CTR düşmesini otomatik hata sayma.',
  '## Tekil ham kaynak paketi (JSON, tekrar içermeyen alanlar)',
  // Compact encoding is intentional: source rows were formerly duplicated in 3 further sections and pretty-printed.
  JSON.stringify(data)
 ];
 return synopsis.join('\n\n');
}
