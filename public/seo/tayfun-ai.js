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
export function buildProductAiHandoff({product,month,device,report,previous,history,observed}){
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
 const observedFields=observed?.seo||null;
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
  'Başka ürünler, şehirler, farklı URL'ler ve site geneli hakkında SEO değişiklik önerme; bunların verisini uydurma.',
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
 const intro=E('div','','tayfun-jobs-intro');intro.append(E('h3','SEO İşleri · Ürün bazlı yapay zekâ çalışması'),
 E('p','Ürünü seç → yalnız onun GSC, SEO ve kelime geçmişini tek metin olarak al → ChatGPT’ye gönder → cevabı incele ve yeni tarihli sürüm olarak kaydet. Eski kayıtlar silinmez.'));
 container.append(intro);
 const search=E('input','','tayfun-jobs-search');search.type='search';search.placeholder='Magnet, kartvizit, reklam ürünleri…';
 container.append(search);
 const groups=E('div','','tayfun-jobs-groups');container.append(groups);
 let currentQuery='';
 const categoryOrder=['Broşürler ve El İlanları','Reklam Ürünleri','Kurumsal Ürünler','Makbuz ve Formlar'];
 const grouped=new Map();
 for(const product of products){
  const category=product.category||'Diğer Ürünler';
  if(!grouped.has(category))grouped.set(category,[]);
  grouped.get(category).push(product);
 }
 function renderGroups(){
  groups.replaceChildren();
  const entries=[...grouped.entries()].sort((a,b)=>{
   const x=categoryOrder.indexOf(a[0]),y=categoryOrder.indexOf(b[0]);
   return (x<0?99:x)-(y<0?99:y)||a[0].localeCompare(b[0],'tr');
  });
  for(const [category,items]of entries){
   const matching=items.filter(p=>(p.name+' '+category).toLocaleLowerCase('tr-TR').includes(currentQuery));
   if(!matching.length)continue;
   const section=E('details','','tayfun-jobs-category');section.open=!!currentQuery||category==='Reklam Ürünleri';
   section.append(E('summary',category+' · '+matching.length+' ürün'));
   const contents=E('div','','tayfun-jobs-list');
   for(const product of matching.sort((a,b)=>a.name.localeCompare(b.name,'tr'))){
    const entry=E('details','','tayfun-jobs-product');
    entry.append(E('summary',product.name+' · '+product.canonical_url));
    entry.addEventListener('toggle',()=>{if(entry.open&&!entry.querySelector('.tayfun-jobs-editor')){
     const editor=E('div','','tayfun-jobs-editor');entry.append(editor);
     loadProduct(editor,product);
    }});
    contents.append(entry);
   }
   section.append(contents);groups.append(section);
  }
 }
 search.oninput=()=>{currentQuery=search.value.toLocaleLowerCase('tr-TR').trim();renderGroups();};
 renderGroups();
 async function loadProduct(editor,product){
  editor.replaceChildren(E('p','Yalnız '+product.name+' geçmişi hazırlanıyor…','source-note'));
  try{
   const history=await api('/api/independent/tayfun-ai/context?product_id='+encodeURIComponent(product.id));
   if(history.product?.id!==product.id||history.product?.canonical_url!==product.canonical_url)
    throw Error('Ürün kaynağı eşleşmedi.');
   editor.replaceChildren();
   const legend=E('p','Eski SEO kayıtları: '+history.versions.length+' · Bilinen en eski kayıt: '+(history.oldest_recorded_at?new Date(history.oldest_recorded_at).toLocaleString('tr-TR'):'Henüz yok')+' · Korunan kelime: '+history.tracked_keywords.length,'source-note');
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
   const urls=new Set(history.product.urls);
   const currentAuto=latestObservation(auto,new Set([product.canonical_url]));
   let observed=null;
   if(currentAuto)try{observed=await api('/api/independent/tayfun-auto/detail?id='+encodeURIComponent(currentAuto.id));}catch{/* Source missing is explicitly retained. */}
   const output=E('textarea','','tayfun-ai-output');output.readOnly=true;output.rows=11;
   const make=E('button','Bu ürünün yapay zekâ metnini oluştur','button primary'),copy=E('button','Metni kopyala','button secondary');
   copy.disabled=true;
   make.onclick=()=>{const packageText=buildProductAiHandoff({product,month,device,report:current,previous,history,observed});output.value=packageText;copy.disabled=false;};
   copy.onclick=async()=>{
    try{await navigator.clipboard.writeText(output.value);notify(product.name+' SEO devir metni kopyalandı. Yalnız bu ürünü ChatGPT’ye gönderin.');}
    catch{output.focus();output.select();notify('Kopyalama izni verilmedi; metni seçip Ctrl+C kullanabilirsiniz.');}
   };
   const answer=E('textarea','','tayfun-ai-answer');answer.rows=10;answer.placeholder='ChatGPT’nin yalnız bu ürüne ait JSON yanıtını buraya yapıştırın…';
   const inspect=E('button','Yanıtı doğrula','button secondary'),save=E('button','Yeni tarihli SEO sürümü kaydet','button primary');
   save.disabled=true;
   const preview=E('div','','tayfun-ai-preview');
   let verified=null;
   answer.oninput=()=>{verified=null;save.disabled=true;preview.replaceChildren();};
   inspect.onclick=()=>{
    try{
     verified=ensureValidOutput(parseAiAnswer(answer.value),product,history);
     preview.replaceChildren(
      E('strong','Doğrulandı · '+product.name+' · Yeni sürüm ayı: '+history.save_month),
      E('p','SEO Title: '+verified.seo.title),
      E('p','Anahtar kelimeler: '+verified.keywords.length+' yeni/korunan + arşivden '+history.tracked_keywords.length+' geçmiş kelime'),
      E('p','Kelime kararları: '+verified.keyword_decisions.length+' · Yeni sayfa önerisi: '+verified.page_proposals.length),
      E('p','Kayıt anı sunucuda oluşturulacak. Eski SEO kayıtları silinmeyecek; siteye yayın yapılmayacak.','source-note')
     );save.disabled=false;
    }catch(error){verified=null;save.disabled=true;preview.replaceChildren(E('p','JSON doğrulanamadı: '+error.message,'history-warning'));}
   };
   save.onclick=async()=>{
    if(!verified)return;
    save.disabled=true;
    try{
     const result=await api('/api/independent/tayfun-ai',{method:'POST',body:JSON.stringify(verified)});
     if(!result.ok||result.entry?.product_id!==product.id)throw Error(result.code||'Ürün sürümü kaydedilemedi');
     preview.replaceChildren(E('strong','Yeni sürüm kaydedildi · '+new Date(result.entry.created_at).toLocaleString('tr-TR')),
      E('p','Arşiv kimliği: '+result.entry.id+' · Eski kayıtlar değişmedi. Canlı site değiştirilmedi.'));
     notify(product.name+' SEO çalışması yeni tarihle kaydedildi. Önceki sürümler ve takip edilen kelimeler korundu.');
     onSaved?.(); // invalidate cached month, do not remount the current editor.
    }catch(error){preview.replaceChildren(E('p','Kayıt yapılamadı: '+error.message,'history-warning'));save.disabled=false;}
   };
   const promptArea=E('div','','tayfun-jobs-package');
   promptArea.append(E('h4','1. Yalnızca '+product.name+' verilerini ChatGPT’ye ver'),make,copy,output);
   const answerArea=E('div','','tayfun-jobs-import');
   answerArea.append(E('h4','2. Yapay zekâ cevabını incele ve yeni kayıt oluştur'),answer,inspect,preview,save);
   editor.append(promptArea,answerArea);
  }catch(error){editor.replaceChildren(E('p','Ürün geçmişi yüklenemedi: '+error.message,'history-warning'));}
 }
}
