// SEO İşleri: one product per AI handoff. No external AI API, no live SEO edits.
const E=(tag,text='',className='')=>{const el=document.createElement(tag);if(text)el.textContent=text;if(className)el.className=className;return el;};
const norm=v=>typeof v==='string'?v:JSON.stringify(v??'');
const fields=['title','description','h1','canonical','robots','headings','internal_links','structured_data','notes','hreflang','images','open_graph','twitter_card','x_robots','viewport','lang','redirect','status_code','content_excerpt'];
const labels={title:'SEO Title',description:'Meta Description',h1:'H1',canonical:'Canonical',robots:'Robots',headings:'H2–H6',internal_links:'İç bağlantılar',structured_data:'JSON-LD',notes:'Notlar',hreflang:'Hreflang',images:'Görseller ve ALT',open_graph:'Open Graph',twitter_card:'Twitter Card',x_robots:'X-Robots',viewport:'Viewport',lang:'Dil',redirect:'Yönlendirme',status_code:'HTTP',content_excerpt:'Sayfa metin özeti'};
const metric=rows=>{
 if(!rows?.length)return null;
 const clicks=rows.reduce((sum,r)=>sum+Number(r.clicks||0),0),impressions=rows.reduce((sum,r)=>sum+Number(r.impressions||0),0);
 return {clicks,impressions,ctr:impressions?clicks/impressions:0,position:impressions?rows.reduce((s,r)=>s+Number(r.position||0)*Number(r.impressions||0),0)/impressions:null};
};
const previousMonth=month=>{const d=new Date(month+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,7);};
const latestObservation=(auto,allowed)=>{
 const r=(auto?.observations||[]).filter(x=>allowed.has(x.url)).sort((a,b)=>b.observed_at.localeCompare(a.observed_at));
 return r[0]||null;
};
export function buildProductAiHandoff({product,month,device,report,previous,history,observed,legacyEvidence=null}){
 const urls=[...new Set(product.urls||[product.canonical_url])],allowed=new Set(urls);
 const scoped=r=>({
  month:r?.month||null,available:!!r?.available,verified_days:r?.days_verified??null,expected_days:r?.expected_days??null,
  verified_query_days:r?.query_days_verified??null,query_days_expected:r?.expected_days??null,
  pages:(r?.pages||[]).filter(x=>allowed.has(x.page)&&(device==='ALL'||device===x.device)),
  queries:(r?.queries||[]).filter(x=>allowed.has(x.page)&&(device==='ALL'||device===x.device)),
  property_total_excluded:true,hidden_queries_not_included:true
 });
 const now=scoped(report),before=scoped(previous);
 const baseline=history.versions.filter(v=>v.url===product.canonical_url).at(-1)||null;
 const observedFields=observed?.seo||legacyEvidence?.fields||null;
 const seo={};
 for(const key of fields){
  const v=observedFields?.[key]??baseline?.[key]??'';
  seo[key]=key==='canonical'&&Array.isArray(observedFields?.canonical)?(observedFields.canonical[0]||''):
   key==='robots'&&Array.isArray(observedFields?.robots)?observedFields.robots.join(', '):
   key==='content_excerpt'&&observedFields?.excerpt?observedFields.excerpt:
   key==='h1'&&observedFields?.headings?observedFields.headings.filter(h=>h.level===1).map(h=>h.text).join(' | '):
   key==='headings'&&observedFields?.headings?norm(observedFields.headings):
   key==='internal_links'&&observedFields?.links?norm(observedFields.links):
   key==='images'&&observedFields?.images?norm(observedFields.images):
   key==='open_graph'&&observedFields?.open_graph?norm(observedFields.open_graph):
   key==='twitter_card'&&observedFields?.twitter_card?norm(observedFields.twitter_card):
   norm(v);
 }
 const tracked=[...new Set([...(history.tracked_keywords||[]),...now.queries.map(r=>r.query),...before.queries.map(r=>r.query)])];
 const allowedDetails=history.versions.map(v=>({id:v.id,url:v.url,created_at:v.created_at,source:v.source,status:v.status,title:v.title,description:v.description,h1:v.h1,keywords:v.keywords,keyword_decisions:v.keyword_decisions||[],page_proposals:v.page_proposals||[],supersedes:v.supersedes}));
 const payload={
  format:'MAVI_BASIM_TAYFUN_PRODUCT_HANDOFF_V1',target:{
   id:product.id,name:product.name,category:product.category||null,canonical_url:product.canonical_url,exact_allowed_urls:urls
  },selected_month:month,device,timezone:'GSC America/Los_Angeles; SEO kayıtları ISO UTC',
  gsc:{current:now,previous:before,
   current_url_totals:metric(now.pages),previous_url_totals:metric(before.pages),
   note:'GSC sorguları anonim/gizli olabilir; kaydı olmayan sorguyu sıfır sayma. URL satırlarının toplamı resmî mülk toplamı değildir.'},
  seo:{latest_automatic_observation:observed?{id:observed.id,observed_at:observed.observed_at,source:observed.source,seo:observed.seo}:null,
   archived_legacy_crawl:legacyEvidence?{id:legacyEvidence.id,observed_at:legacyEvidence.observed_at,source:'seo_snapshots',fields:legacyEvidence.fields,record_hash:legacyEvidence.record_hash||null}:null,
   recorded_versions:allowedDetails,oldest_recorded_at:history.oldest_recorded_at||null,
   old_versions_immutable:true,known_current_fields:seo},
  keywords:{ever_tracked:tracked,existing_history_keywords:history.tracked_keywords||[],do_not_delete:true},
  evidence_limitations:[
   'Bu dosyada başka ürünün URL veya sorguları yoktur.',
   'Tarih verilmiş kayıt yalnız gerçek tarama veya kayıt anını ifade eder; CMS yayın kanıtı değildir.',
   'Yapay zekâ önerisi canlı siteye otomatik uygulanmaz.',
   'Küçük dalgalanma içerik değiştirme gerekçesi değildir; başarılı anahtar kelimeler korunur.'
  ]
 };
 const template={
  format:'MAVI_BASIM_TAYFUN_AI_PRODUCT_V1',product_id:product.id,url:product.canonical_url,
  month:history.save_month,expected_latest_id:history.latest_revision_id||null,seo,
  keywords:history.tracked_keywords||[],
  keyword_decisions:[],page_proposals:[]
 };
 const instructions=[
  'Sen Mavi Basım için kanıt odaklı SEO analisti olarak SADECE "'+product.name+'" ürününü ve dosyadaki exact_allowed_urls listesini incele.',
  'Başka ürünler, şehirler, farklı URL adresleri ve site geneli hakkında SEO değişiklik önerme; bunların verisini uydurma.',
  'Önce kaynak kanıtını, sonra muhtemel açıklamayı, en son uygulanabilir öneriyi değerlendir. Korelasyon SEO değişiminin kesin nedeni değildir.',
  'Tıklama/gösterim kayıplarını iki tam dönem ve gerçek sorgu/URL kanıtına göre değerlendir. Küçük dalgalanmalarda çalışan metni KORU.',
  'Geçmişte başarılı olan veya önceki kayıtlarda yer alan anahtar kelimeleri SİLME. Her kelime için koru/izle/yeni_sayfa_adayi kararı ve gerekçe yaz; yeni kelimeleri ekleyebilirsin.',
  'Yeniden yükselen/artan kelimeler varsa ayrı sayfa yalnız farklı arama amacı ve kanıtlı yeterli görünürlük durumunda teklif edilebilir; URL çakışması ve anahtar kelime yamyamlaşmasını değerlendir. Yeni sayfayı otomatik oluşturma.',
  'Mevcut başlık ve içerik işe yarıyorsa değişiklik yapma. Önerdiğin yeni başlık ve metni seo nesnesine eksiksiz yaz; eksik alanları boşaltma.',
  'Çıktı yalnızca tek geçerli JSON nesnesi olsun; format, product_id, url, month ve expected_latest_id değerlerini aşağıdaki şablondan BİREBİR koru.',
  'seo içindeki tüm değerler JSON string olmalı. keywords bir dizi string; keyword_decisions her kayıt {query,action,reason}, action yalnız koru/izle/yeni_sayfa_adayi; page_proposals her kayıt {keyword,reason,url_suggestion}.',
  'Yayın tarihini ve GSC değişiminin sebebini kanıt olmadan tahmin etme. Çıktı bir SEO takip ÖNERİSİDİR, siteyi değiştirmez.'
 ];
 return ['# MAVİ BASIM · TAYFUN / TEK ÜRÜN SEO DEVİR METNİ',
  '## Amaç',...instructions.map((s,i)=>(i+1)+'. '+s),
  '## Yalnızca seçilen ürünün kanıtlı veri paketi',
  '```json',JSON.stringify(payload,null,2),'```',
  '## Bu ürün için döndüreceğin JSON taslağı',
  '```json',JSON.stringify(template,null,2),'```'
 ].join('\n');
}
export function productKeywordTracking({product,current,previous,history,device='ALL'}){
 const allowed=new Set(product.urls||[product.canonical_url]);
 const gather=raw=>{
  const map=new Map();
  for(const r of raw?.queries||[]){
   if(!allowed.has(r.page)||(device!=='ALL'&&r.device!==device))continue;
   const key=r.query.toLocaleLowerCase('tr-TR').trim(),item=map.get(key)||{query:r.query,clicks:0,impressions:0};
   item.clicks+=Number(r.clicks)||0;item.impressions+=Number(r.impressions)||0;map.set(key,item);
  }
  return map;
 };
 const before=gather(previous),now=gather(current);
 const statusByKeyword=new Map();
 for(const v of history.versions||[])for(const decision of v.keyword_decisions||[])
  statusByKeyword.set(decision.query.toLocaleLowerCase('tr-TR'),decision.action);
 const all=new Map();
 for(const [key,value] of before)all.set(key,value.query);
 for(const [key,value] of now)all.set(key,value.query);
 for(const keyword of history.tracked_keywords||[])all.set(keyword.toLocaleLowerCase('tr-TR'),keyword);
 const rows=[...all].map(([key,query])=>{
  const a=now.get(key)||null,b=before.get(key)||null,delta=a&&b?a.clicks-b.clicks:null;
  const rising=delta!==null&&delta>=3&&a.impressions>=30&&a.clicks>=3;
  const reawakening=rising&&b.clicks===0;
  const signal=reawakening?'Canlanıyor · araştır':rising?'Yükseliyor · araştır':
   !a&&b?'Bu ay görünür sorgu satırı yok':a&&!b?'Yeni görünür · önceki ay yok':
   a&&b&&delta<0?'Düşüş · eğilim kontrolü':'İzle';
  return {query,current_clicks:a?.clicks??null,previous_clicks:b?.clicks??null,
   current_impressions:a?.impressions??null,previous_impressions:b?.impressions??null,
   delta_clicks:delta,signal,saved_decision:statusByKeyword.get(key)||null};
 });
 return rows.sort((a,b)=>(b.delta_clicks??-99999)-(a.delta_clicks??-99999)|| (b.current_impressions??0)-(a.current_impressions??0)||a.query.localeCompare(b.query,'tr'));
}

function parseAiAnswer(raw){
 let text=raw.trim();
 if(text.startsWith('```'))text=text.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
 return JSON.parse(text);
}
function ensureValidOutput(data,product,history){
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('JSON nesnesi bekleniyor.');
 if(data.format!=='MAVI_BASIM_TAYFUN_AI_PRODUCT_V1'||data.product_id!==product.id||data.url!==product.canonical_url)
  throw Error('Yanıt yanlış ürüne ait. Yalnız '+product.name+' verisi kabul edilir.');
 if(data.month!==history.save_month||data.expected_latest_id!==(history.latest_revision_id||null))
  throw Error('Kayıt ayı veya önceki sürüm değişmiş. Güncel ürün verisini yeniden al.');
 if(!data.seo||typeof data.seo!=='object'||fields.some(k=>typeof data.seo[k]!=='string'))
  throw Error('seo nesnesinin bütün alanları metin olmalı; eksik alanlara eski değerleri geri koy.');
 if(!Array.isArray(data.keywords)||!Array.isArray(data.keyword_decisions)||!Array.isArray(data.page_proposals))
  throw Error('keywords, keyword_decisions ve page_proposals dizileri eksik.');
 if(data.page_proposals.some(v=>v.url_suggestion&&!/^https:\/\/mavibasim\.com(?:\/|$)/.test(v.url_suggestion)))throw Error('Başka sitelere yönelik sayfa önerisi kabul edilmez.');
 return data;
}
export function renderSeoJobs(container,{products,month,device,current,previous,auto,api,notify,onSaved}){
 container.replaceChildren();
 const now=new Date().toISOString().slice(0,7);
 const intro=E('div','','tayfun-jobs-intro');intro.append(E('h3','SEO İşleri · Tek merkezden yapay zekâ SEO çalışması'),
 E('p','Kategori veya ürün seç → bütün seçili ürünlerin kanıtlarını tek metin olarak ChatGPT’ye gönder → tek JSON cevabını buraya yapıştır. Sistem her kaydı ürün kimliği ve URL’sine göre ayırır. Eski sürümler silinmez.'));
 container.append(intro);
 // Read actual encrypted ledger state; do not confuse AI proposal counts with baseline observations.
 const baselineStatus=E('div','Broşür, El İlanı ve Afiş kanıtlı başlangıç kayıtları kontrol ediliyor…','source-note');
 container.append(baselineStatus);
 api('/api/independent/tayfun/approved-baseline/status').then(state=>{
  baselineStatus.replaceChildren();
  baselineStatus.append(E('strong','22 Ekim 2026 referanslı gerçek SEO temel kayıtları: '+state.saved_count+'/3'));
  for(const item of state.items||[]){
   const name=item.url.endsWith('/brosur')?'Broşür':item.url.endsWith('/el-ilani')?'El İlanı':'Afiş';
   const label=item.status==='saved'?'Kaydedildi · '+new Date(item.created_at).toLocaleString('tr-TR'):
    item.status==='awaiting_verified_crawl'?'Gerçek tarama bekleniyor':
    item.status==='held'?'Kayıt başarısız · tarama/izin durumunu kontrol et':'Henüz kayıt doğrulanmadı';
   baselineStatus.append(E('p',name+': '+label,'source-note'));
  }
  baselineStatus.append(E('p','Bu kayıtlar gerçek tarama sürümleridir; aşağıdaki SEO Takibi yalnız AI SEO taslaklarını sayar.','source-note'));
 }).catch(()=>{baselineStatus.textContent='Gerçek SEO temel kayıtları okunamadı; veritabanında kayıt varmış gibi gösterilmez.';});
 const toolbar=E('div','','tayfun-jobs-toolbar');
 const searchLabel=E('label','','tayfun-jobs-search-wrap');
 searchLabel.setAttribute('aria-label','Ürün veya kategori ara');
 const searchIcon=E('span','⌕','tayfun-jobs-search-icon');searchIcon.setAttribute('aria-hidden','true');
 const search=E('input','','tayfun-jobs-search');
 search.type='search';search.placeholder='Ürün veya kategori ara...';search.setAttribute('aria-label','Ürün veya kategori ara');
 searchLabel.append(searchIcon,search);
 const nav=E('div','','tayfun-jobs-category-scroll');
 nav.setAttribute('role','group');nav.setAttribute('aria-label','SEO İşleri ürün kategorileri');
 nav.tabIndex=0;
 toolbar.append(searchLabel,nav);container.append(toolbar);

 // Single export/import workspace. Category pills and search above are the sole selectors.
 const work=E('section','','tayfun-ai-workspace');work.setAttribute('aria-label','Tek merkezden SEO veri aktarımı');
 const exportPanel=E('section','','tayfun-ai-workspace-panel tayfun-jobs-package');
 exportPanel.append(E('h4','1. Seçili ürünlerin SEO verilerini ChatGPT’ye ver'));
 const make=E('button','Tek SEO veri paketini oluştur','button primary');
 const copy=E('button','Metni kopyala','button secondary');copy.disabled=true;
 const output=E('textarea','','tayfun-ai-output');output.readOnly=true;output.rows=13;output.placeholder='Hazırlanan SEO veri paketi burada gösterilir.';
 const exportInfo=E('p','Üstteki kategori düğmelerini veya aramayı kullanın. Görünen ürünlerin verisi hazırlanır.','source-note');
 const exportRow=E('div','','tayfun-ai-workspace-actions');exportRow.append(make,copy);
 exportPanel.append(exportRow,exportInfo,output);
 const importPanel=E('section','','tayfun-ai-workspace-panel tayfun-jobs-import');
 importPanel.append(E('h4','2. ChatGPT JSON yanıtını tek seferde yapıştır'));
 const answer=E('textarea','','tayfun-ai-answer');answer.rows=13;
 answer.placeholder='Tek ürün JSON, JSON nesneleri dizisi veya MAVI_BASIM_TAYFUN_AI_BATCH_V1 items dizisi…';
 const save=E('button','SEO Analizini Kaydet','button primary');save.disabled=true;
 const preview=E('div','','tayfun-ai-preview');
 const importRow=E('div','','tayfun-ai-workspace-actions');importRow.append(save);
 importPanel.append(answer,importRow,preview);
 work.append(exportPanel,importPanel);toolbar.after(work);
 const knownById=new Map(products.map(p=>[p.id,p]));
 const knownByUrl=new Map(products.map(p=>[p.canonical_url,p]));
 answer.addEventListener('input',()=>{save.disabled=!answer.value.trim();preview.replaceChildren();});
 function available(){const collection=(selectedCategory==='Tüm Kategoriler'?products:grouped.get(selectedCategory)||[])
  .filter(p=>(p.name+' '+(p.category||'')).toLocaleLowerCase('tr-TR').includes(currentQuery));
  return collection.slice().sort((a,b)=>a.name.localeCompare(b.name,'tr'));}
 async function evidenceFor(product){
  const history=await api('/api/independent/tayfun-ai/context?product_id='+encodeURIComponent(product.id));
  if(history.product?.id!==product.id||history.product?.canonical_url!==product.canonical_url)throw Error(product.name+': ürün kimliği ve URL eşleşmedi.');
  const observedRow=latestObservation(auto,new Set([product.canonical_url]));
  let observed=null;
  if(observedRow)try{observed=await api('/api/independent/tayfun-auto/detail?id='+encodeURIComponent(observedRow.id));}catch{/* Unavailable evidence stays missing. */}
  let legacyEvidence=null;
  try{
   const lastDay=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).getUTCDate();
   const end=month+'-'+String(lastDay).padStart(2,'0');
   const source=await api('/api/independent/seo-history?'+new URLSearchParams({kind:'snapshot',url:product.canonical_url,to:end}));
   const latest=(source.items||[]).filter(v=>v.url===product.canonical_url&&v.observed_at?.slice(0,7)<=month)
    .sort((a,b)=>b.observed_at.localeCompare(a.observed_at))[0];
   if(latest){
    const detail=await api('/api/independent/seo-history/detail?'+new URLSearchParams({kind:'snapshot',id:latest.id}));
    if(detail.url===product.canonical_url&&detail.observed_at?.slice(0,7)<=month)legacyEvidence=detail;
   }
  }catch{/* Source not available. */}
  const text=buildProductAiHandoff({product,month,device,report:current,previous,history,observed,legacyEvidence});
  const sections=[...text.matchAll(/```json\n([\s\S]*?)\n```/g)];
  if(sections.length!==2)throw Error('SEO aktarım metni ayrıştırılamadı: '+product.name);
  return {payload:JSON.parse(sections[0][1]),template:JSON.parse(sections[1][1])};
 }
 make.onclick=async()=>{
  const chosen=available();
  if(!chosen.length){notify('Önce kategori veya ürün seçin.');return;}
  make.disabled=true;copy.disabled=true;output.value='';
  const sources=[],failed=[];
  for(let i=0;i<chosen.length;i++){
   const p=chosen[i];exportInfo.textContent='Gerçek SEO ve GSC kanıtları hazırlanıyor: '+(i+1)+'/'+chosen.length+' · '+p.name;
   try{sources.push(await evidenceFor(p));}catch(error){failed.push(p.name+': '+error.message);}
  }
  make.disabled=false;
  if(failed.length){
   exportInfo.textContent='Bazı ürünlerin gerçek verisi alınamadı. Uydurma veri üretilmedi: '+failed.join(' | ');
   notify('Eksik kaynak var; tek paket oluşturulmadı.');return;
  }
  const request={format:'MAVI_BASIM_TAYFUN_AI_BATCH_HANDOFF_V1',month,device,
   warning:'Kısmi ayı tam ay sayma, çalışan SEO’yu koru, gizli sorguları sıfır sayma, farklı ürünleri karıştırma.',
   products:sources.map(x=>x.payload)};
  const template={format:'MAVI_BASIM_TAYFUN_AI_BATCH_V1',items:sources.map(x=>x.template)};
  output.value=[
   '# MAVİ BASIM TAYFUN · TEK MERKEZDEN TOPLU SEO VERİ DEVRİ',
   'YALNIZ AŞAĞIDAKİ ÜRÜNLERİ analiz et. Her ürünün product_id, url, month ve expected_latest_id alanlarını aynen koru.',
   'Mevcut başarılı SEO metinlerini kanıtsız değiştirme; önceki kelimeleri asla silme. Eksik veya kısmi GSC aylarını sıfır sayma.',
   'Her ürünün seo alanlarındaki bütün değerler string olmalı. keywords string dizisi; keyword_decisions dizisinin action değeri yalnız koru/izle/yeni_sayfa_adayi.',
   'Başka URL, ürün, sayfa veya tarih uydurma. JSON dışında açıklama yazma. Tek geçerli JSON nesnesi döndür: format MAVI_BASIM_TAYFUN_AI_BATCH_V1 ve items dizisi.',
   '## Gerçek ürün kanıtları','```json',JSON.stringify(request,null,2),'```',
   '## Çıktı yapısı (içerikleri kanıtlara göre düzenle)','```json',JSON.stringify(template,null,2),'```'
  ].join('\n');
  exportInfo.textContent=chosen.length+' ürünün GSC, tarama ve sürüm geçmişi tek pakette hazır. '+(output.value.length>125000?'Metin çok büyük; kategoriye göre daha küçük paket tercih edin.':'ChatGPT’ye tek seferde gönderin.');
  copy.disabled=false;
 };
 copy.onclick=async()=>{
  try{await navigator.clipboard.writeText(output.value);notify('Tüm seçili ürünlerin SEO devir metni kopyalandı.');}
  catch{output.focus();output.select();notify('Metni seçip Ctrl+C ile kopyalayın.');}
 };
 function unpack(value){
  if(Array.isArray(value))return value;
  if(value?.format==='MAVI_BASIM_TAYFUN_AI_BATCH_V1'&&Array.isArray(value.items))return value.items;
  if(value?.format==='MAVI_BASIM_TAYFUN_AI_PRODUCT_V1')return [value];
  throw Error('Bir ürün JSON’u veya format MAVI_BASIM_TAYFUN_AI_BATCH_V1 içeren items dizisi bekleniyor.');
 }
 save.onclick=async()=>{
  if(!answer.value.trim())return;
  save.disabled=true;save.textContent='Kontrol ediliyor…';preview.replaceChildren();
  let items;
  try{items=unpack(parseAiAnswer(answer.value));}
  catch(error){
   preview.append(E('p','JSON okunamadı: '+error.message,'history-warning'));
   save.textContent='SEO Analizini Kaydet';save.disabled=false;return;
  }
  if(!items.length||items.length>29){
   preview.append(E('p','1–29 ürün içeren JSON gerekli. Hiçbir kayıt değiştirilmedi.','history-warning'));
   save.textContent='SEO Analizini Kaydet';save.disabled=false;return;
  }
  // Validate the entire batch before touching any stored version.
  const checked=[],seen=new Set(),errors=[];
  for(const item of items){
   const product=knownById.get(item?.product_id),urlProduct=knownByUrl.get(item?.url);
   if(!product||product!==urlProduct){errors.push('Ürün veya URL eşleşmedi: '+String(item?.product_id||item?.url));continue;}
   if(seen.has(product.id)){errors.push('Aynı ürün iki kez gönderildi: '+product.name);continue;}
   seen.add(product.id);
   try{
    const history=await api('/api/independent/tayfun-ai/context?product_id='+encodeURIComponent(product.id));
    // A previously saved analysis may be pasted again. Let the archive check for
    // an exact duplicate; do not silently rebase a stale version or overwrite history.
    if(item.month!==history.save_month)throw Error('Kayıt ayı değişmiş. Güncel ürün verisi gerekli.');
    if(item.expected_latest_id!==(history.latest_revision_id||null)){
     const latest=history.versions?.find(v=>v.id===history.latest_revision_id);
     if(latest?.source!=='ai-review'||latest?.supersedes!==(item.expected_latest_id??null))
      throw Error('Ürünün SEO sürümü değişmiş; eski JSON ile farklı içerik kaydedilemez.');
     if(item.format!=='MAVI_BASIM_TAYFUN_AI_PRODUCT_V1'||item.product_id!==product.id||
        item.url!==product.canonical_url)throw Error('Yanıt yanlış ürüne ait.');
     checked.push({product,data:item});continue;
    }
    checked.push({product,data:ensureValidOutput(item,product,history)});
   }catch(error){errors.push(product.name+': '+error.message);}
  }
  if(errors.length){
   preview.append(E('strong','Hiçbir kayıt yapılmadı · '+errors.length+' doğrulama hatası'));
   for(const error of errors)preview.append(E('p',error,'history-warning'));
   save.textContent='SEO Analizini Kaydet';save.disabled=false;return;
  }
  save.textContent='Kaydediliyor…';
  const saved=[],existing=[],failed=[];
  for(const {product,data} of checked){
   try{
    const response=await api('/api/independent/tayfun-ai',{method:'POST',body:JSON.stringify(data)});
    if(!response.ok||response.entry?.product_id!==product.id||response.entry?.url!==product.canonical_url)
     throw Error(response.code||'Arşiv yanıtı doğrulanamadı');
    (response.already_saved?existing:saved).push(product.name);
   }catch(error){failed.push(product.name+': '+error.message);}
  }
  preview.replaceChildren(E('strong',saved.length+' yeni kayıt · '+existing.length+' zaten kayıtlı · '+failed.length+' hata'));
  for(const name of saved)preview.append(E('p','Yeni SEO sürümü kaydedildi: '+name,'source-note'));
  for(const name of existing)preview.append(E('p','Bu analiz zaten kayıtlı, tekrar yazılmadı: '+name,'source-note'));
  for(const error of failed)preview.append(E('p','Kaydedilemedi: '+error,'history-warning'));
  if(saved.length){onSaved?.();notify(saved.length+' ürünün SEO analizi kaydedildi. Eski sürümler korundu.');}
  else if(existing.length)notify(existing.length+' ürünün aynı SEO analizi zaten arşivde var; yeni sürüm oluşturulmadı.');
  if(failed.length)notify(failed.length+' ürün kaydedilemedi.');
  save.textContent='SEO Analizini Kaydet';save.disabled=false;
 };

 const groups=E('div','','tayfun-jobs-groups');container.append(groups);
 let currentQuery='',selectedCategory='Tüm Kategoriler';
 const categoryOrder=['Broşürler ve El İlanları','Reklam Ürünleri','Kurumsal Ürünler','Makbuz ve Formlar'];
 const grouped=new Map();
 for(const product of products){
  const category=product.category||'Diğer Ürünler';
  if(!grouped.has(category))grouped.set(category,[]);
  grouped.get(category).push(product);
 }
 const categories=['Tüm Kategoriler',...categoryOrder.filter(x=>grouped.has(x)),...[...grouped.keys()].filter(x=>!categoryOrder.includes(x)).sort((a,b)=>a.localeCompare(b,'tr'))];
 const categoryButtons=new Map();
 function renderProductCards(target,items){
  const contents=E('div','','tayfun-jobs-list');
  for(const product of items.sort((a,b)=>a.name.localeCompare(b.name,'tr'))){
   const entry=E('details','','tayfun-jobs-product');
   entry.append(E('summary',product.name+' · '+product.canonical_url));
   entry.addEventListener('toggle',()=>{
    if(entry.open&&!entry.querySelector('.tayfun-jobs-editor')){
     const editor=E('div','','tayfun-jobs-editor');entry.append(editor);
     loadProduct(editor,product);
    }
   });
   contents.append(entry);
  }
  target.append(contents);
 }
 function renderGroups(){
  groups.replaceChildren();
  const categoriesToDisplay=selectedCategory==='Tüm Kategoriler'?categories.slice(1):[selectedCategory];
  let count=0;
  for(const category of categoriesToDisplay){
   const items=(grouped.get(category)||[]).filter(p=>(p.name+' '+category).toLocaleLowerCase('tr-TR').includes(currentQuery));
   if(!items.length)continue;
   count+=items.length;
   const section=E('section','','tayfun-jobs-category');
   section.append(E('h4',category+' · '+items.length+' ürün'));
   renderProductCards(section,items);
   groups.append(section);
  }
  if(!count)groups.append(E('p','Bu kategori ve aramada eşleşen ürün bulunamadı.','source-note'));
 }
 function selectCategory(category){
  selectedCategory=category;
  for(const [name,button] of categoryButtons)button.setAttribute('aria-pressed',String(name===category));
  renderGroups();
 }
 for(const category of categories){
  const button=E('button',category,'button tayfun-jobs-category-pill');
  button.type='button';button.setAttribute('aria-pressed',String(category===selectedCategory));
  button.addEventListener('click',()=>selectCategory(category));
  nav.append(button);categoryButtons.set(category,button);
 }
 search.addEventListener('input',()=>{currentQuery=search.value.toLocaleLowerCase('tr-TR').trim();renderGroups();});
 renderGroups();
 async function loadProduct(editor,product){
  editor.replaceChildren(E('p','Yalnız '+product.name+' geçmişi hazırlanıyor…','source-note'));
  try{
   const history=await api('/api/independent/tayfun-ai/context?product_id='+encodeURIComponent(product.id));
   if(history.product?.id!==product.id||history.product?.canonical_url!==product.canonical_url)
    throw Error('Ürün kaynağı eşleşmedi.');
   editor.replaceChildren();
   const legend=E('p','Arşivdeki tarihli SEO sürümleri: '+history.versions.length+' · Bilinen en eski kayıt: '+(history.oldest_recorded_at?new Date(history.oldest_recorded_at).toLocaleString('tr-TR'):'Henüz yok')+' · Korunan kelime: '+history.tracked_keywords.length,'source-note');
   editor.append(legend);
   const tracking=productKeywordTracking({product,current,previous,history,device});
   const keywordDetails=E('details','','tayfun-keyword-history');
   keywordDetails.append(E('summary','Silinmeyen kelime takibi · '+tracking.length+' görünür/geçmiş sorgu'));
   const table=E('div','','tayfun-keyword-table');
   const headings=E('div','','tayfun-keyword-row tayfun-keyword-header');
   for(const label of ['Kelime','Önce','Şimdi','Değişim','Takip durumu'])headings.append(E('strong',label));
   table.append(headings);
   for(const keyword of tracking){
    const row=E('div','','tayfun-keyword-row');
    const previousText=keyword.previous_clicks===null?'Kayıt yok':String(keyword.previous_clicks);
    const currentText=keyword.current_clicks===null?'Kayıt yok':String(keyword.current_clicks);
    const delta=keyword.delta_clicks===null?'Belirsiz':(keyword.delta_clicks>0?'+':'')+keyword.delta_clicks;
    const label=(keyword.saved_decision?keyword.saved_decision+' · ':'')+keyword.signal;
    for(const value of [keyword.query,previousText,currentText,delta,label])row.append(E('span',String(value)));
    table.append(row);
   }
   if(!tracking.length)table.append(E('p','Bu ürün için görünür sorgu veya eski kelime kaydı bulunmadı; eksik veri sıfır değildir.'));
   keywordDetails.append(table);
   editor.append(keywordDetails);
   const proposals=(history.versions||[]).flatMap(v=>(v.page_proposals||[]).map(candidate=>({...candidate,saved_at:v.created_at,version_id:v.id})));
   const candidates=E('details','','tayfun-keyword-history');
   candidates.append(E('summary','Yeni sayfa adayları · '+proposals.length+' arşivlenmiş öneri (siteye otomatik eklenmez)'));
   const holder=E('div','','tayfun-candidates-list');
   if(!proposals.length)holder.append(E('p','Bu ürün için kayıtlı yeni sayfa önerisi yok. Bir kelimenin yükselmesi tek başına yeni sayfa açma nedeni değildir.','source-note'));
   for(const candidate of proposals){
    const card=E('div','','tayfun-candidate');
    card.append(E('strong',candidate.keyword),E('p','Önerilen URL: '+(candidate.url_suggestion||'URL henüz önerilmedi')),
     E('p','Gerekçe: '+candidate.reason),E('small','Öneri tarihi: '+new Date(candidate.saved_at).toLocaleString('tr-TR')+' · Canlı siteye eklenmedi.'));
    holder.append(card);
   }
   candidates.append(holder);editor.append(candidates);
   editor.append(E('p','Yapay zekâya veri gönderme ve JSON kaydetme işlemleri yukarıdaki tek merkezden yapılır.','source-note'));
  }catch(error){editor.replaceChildren(E('p','Ürün geçmişi yüklenemedi: '+error.message,'history-warning'));}
 }
}
