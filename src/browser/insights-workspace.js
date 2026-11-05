// Loaded on demand. All analysis is read-only; catalogue edits are explicit drafts.
import {$,node,number,percent,deviceName,badge,detail,list,siteLink,empty} from '../../public/ui.js';
import {drawChart} from '../../public/chart.js';
import {buildInsights,metric,CATEGORIES,QUERY_TYPES,fold} from '../independent-insights';
const prior=m=>{const d=new Date(m+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,7);};
const monthLabel=m=>new Date(m+'-01T00:00:00Z').toLocaleDateString('tr-TR',{month:'long',year:'numeric',timeZone:'UTC'});
const stamp=s=>s?new Date(s).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul'})+' (TSİ)':'Doğrulanmadı';
const delta=v=>v===null||v===undefined?'Doğrulanmadı':(v>0?'+':'')+number(v);
function tags(values){const root=node('div',null,'insight-badges');values.forEach(v=>root.append(node('span',v,'insight-tag'+(/Koru/.test(v)?' good':/Kaybı|Gerileme|bekle|Çakışma/.test(v)?' warning':''))));return root;}
function stats(root,values){root.replaceChildren(...values.map(([title,value,note])=>{const card=node('article',null,'insight-stat');card.append(node('span',title),node('strong',value,value==='Doğrulanmadı'?'missing':''),node('small',note||''));return card;}));}
function download(name,value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=node('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function createInsightsWorkspace({scope,read,table,evidence,openProduct,ask,notify}){
 let data=null,raw=null,old=null,catalog=null,version=0,pageMode='products',queryType='Tümü',page=1,queryPage=1,active='products',comparisonRows=[],comparisonEpoch=0;
 let selectedMonths=new Set([prior(scope().month),scope().month]),selectedYear=scope().month.slice(0,4);
 const setOptions=(id,values,all)=>{const before=$(id).value;$(id).replaceChildren(...(all?[new Option(all,'')]:[]),...values.map(([name,value])=>new Option(name,value)));if([...$(id).options].some(o=>o.value===before))$(id).value=before;};
 const filterRows=(rows,s)=>rows.filter(r=>(s.device==='ALL'||r.device===s.device)&&(!s.country||r.country===s.country));
 const note=()=>data.month+' ↔ '+(data.previous_month||'Önceki ay doğrulanmadı')+' · '+deviceName(scope().device)+' · tüm ülkeler · '+data.timezone+'. '+(data.complete?'GSC sayfa dönemi doğrulandı.':'Kısmi sayfa kaydı; aylık toplam ve kesin karar üretilmez.')+' Bu ekran seçili bitiş ayını karşılaştırır.';
 const inspect=(row,kind='page')=>{const button=node('button','İncele','button secondary');button.onclick=()=>recordDetail(row,kind);return button;};
 function pager(root,total,current,change){if(total<=40)return;const bar=node('div',null,'insight-pager'),back=node('button','Önceki','button secondary'),next=node('button','Sonraki','button secondary');back.disabled=current<=1;next.disabled=current*40>=total;back.onclick=()=>change(current-1);next.onclick=()=>change(current+1);bar.append(back,node('span',current+' / '+Math.ceil(total/40)),next);root.append(bar);}
 async function model(){
  const s=scope(),at=++version,nextRaw=s.current.find(r=>r.month===s.month)||{month:s.month,available:false,pages:[],queries:[],days_verified:0,expected_days:0,query_days_verified:0},nextCatalog=s.catalog||{available:false,products:[],changes:[]};let nextOld=s.previous;
  if(!nextOld||nextOld.month!==prior(s.month))try{nextOld=await read('gsc-month?month='+prior(s.month));}catch{nextOld=null;}
  if(at!==version)return false;
  raw=nextRaw;catalog=nextCatalog;old=nextOld;
  data=buildInsights(raw,old,catalog.products||[],{device:s.device,country:s.country},catalog.available===true);
  for(const id of ['pageCoverage','pageModes','catalogManagement','catalogDraftNote'])$(id).hidden=false;
  setOptions('groupFilter',CATEGORIES.map(c=>[c,c]),'Tüm kategoriler');$('groupFilter').hidden=false;
  setOptions('impactCategory',CATEGORIES.map(c=>[c,c]),'Tüm Gruplar');
  setOptions('impactProduct',[...data.products.map(p=>[p.name,p.id]),...data.unmapped.map(p=>[p.url,'url:'+p.url])],'Tüm ürünler / sayfalar');
  setOptions('comparisonProduct',(catalog.products||[]).map(p=>[p.name,p.id]));
  $('catalogDraftNote').textContent='Kategori: uygulama tanımı. Eşleme: yalnız doğrulanmış tam canonical URL. JSON içe aktarımı ve yeni gruplar yalnız yönetim taslağıdır.';
  return true;
 }
 function products(nextSort={key:'clicks',direction:'desc'}){
  if(!data)return;const search=fold($('productSearch').value),category=$('groupFilter').value,decision=$('decisionFilter').value;
  stats($('pageCoverage'),[['Toplam GSC sayfası',number(data.counters.pages),'Seçili cihazda gözlenen URL'],['Eşleşen',data.catalog_verified?number(data.counters.matched):'Doğrulanmadı','Birebir katalog eşlemesi'],['Eşleşmeyen',data.catalog_verified?number(data.counters.unmapped):'Doğrulanmadı','URL tahmini yapılmaz'],['Çakışma',data.catalog_verified?number(data.counters.conflicts):'Doğrulanmadı','Aynı URL birden çok grupta'],['Tıklama kapsamı',percent(data.counters.click_coverage),data.complete?'Doğrulanmış sayfa tıklamaları':'Yalnız gözlenen kısmi sayfalar']]);
  const source=pageMode==='products'?data.products:pageMode==='unmapped'?data.unmapped:pageMode==='conflicts'?data.conflicts:data.pages.filter(r=>r.current);
  const rows=source.filter(p=>fold(p.label+' '+(p.canonical_url||p.url||'')).includes(search)&&(!category||p.category===category)&&(!decision||p.decision===decision));
  const key=nextSort.key;rows.sort((a,b)=>{const av=key==='name'?a.label:key==='decision'?a.decision:key==='change'?Math.abs(a.delta??0):a.current?.[key]??-1,bv=key==='name'?b.label:key==='decision'?b.decision:key==='change'?Math.abs(b.delta??0):b.current?.[key]??-1;return(typeof av==='string'?av.localeCompare(bv,'tr'):av-bv)*(nextSort.direction==='asc'?1:-1);});
  page=Math.min(page,Math.max(1,Math.ceil(rows.length/40)));const values=rows.slice((page-1)*40,page*40).map(p=>{
   const name=node('div',null,'insight-meta');name.append(node('strong',p.label),node('small',p.category));if(p.canonical_url)name.append(siteLink(p.canonical_url));else name.append(siteLink(p.url,'Sayfayı görüntüle'));
   const status=!p.verified?'Veri bekle':p.mapping==='conflict'||p.mapping_conflict?'Çakışma':p.decision==='İncele'?'Gerileme · İncele':p.opportunities?.[0]||p.decision;
   if(pageMode==='unmapped'){const define=node('button','Ürün Tanımla','button secondary');define.onclick=()=>draft(p.url);return [name,number(p.current?.clicks),number(p.current?.impressions),percent(p.current?.ctr),number(p.current?.position),define];}
   return [name,number(p.current?.clicks),delta(p.delta),number(p.current?.impressions),percent(p.current?.ctr),number(p.current?.position),tags([status]),inspect(p,pageMode==='products'?'product':'page')];
  });
  table($('products'),pageMode==='unmapped'?['Eşlenmemiş sayfa URL','Tıklama','Gösterim','CTR','Ort. sıra','İşlem']:['Ürün / sayfa','Tıklama','Değişim','Gösterim','CTR','Ort. sıra','Durum','İncele'],values);
  pager($('products'),rows.length,page,n=>{page=n;products(nextSort);});$('productCount').textContent=number(rows.length);$('productPeriod').textContent=note();
  document.querySelectorAll('[data-page-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.pageMode===pageMode)));
 }
 function opportunities(){
  if(!data)return;const q=fold($('opportunitySearch').value),threshold=Number($('opportunityThreshold').value);
  const rows=data.queries.filter(r=>r.opportunities.length&&r.current.impressions>=threshold&&(queryType==='Tümü'||r.type===queryType)&&fold(r.query).includes(q)).sort((a,b)=>b.current.impressions-a.current.impressions);
  $('opportunityCount').textContent=number(rows.length);$('opportunityScope').textContent=note()+' Görünür sorgu günleri: '+raw.query_days_verified+'/'+raw.expected_days+'. '+(data.query_comparison_available?'İki dönemin görünür sorgu günleri doğrulandı; anonim sorgular kapsam dışı.':'Sorgu karşılaştırması eksik; farklar sıfır varsayımıyla hesaplanmadı.');
  queryPage=Math.min(queryPage,Math.max(1,Math.ceil(rows.length/40)));
  table($('opportunityTable'),['Arama sorgusu','Sorgu türü','Fırsat türü','Tıklama','Tıklama değişimi','Gösterim','CTR','Ort. sıra','Sıra değişimi','Ayrıntı'],rows.slice((queryPage-1)*40,queryPage*40).map(r=>[r.query,r.type,tags(r.opportunities),number(r.current.clicks),delta(r.delta),number(r.current.impressions),percent(r.current.ctr),number(r.current.position),delta(r.position_delta),inspect(r,'query')]));
  pager($('opportunityTable'),rows.length,queryPage,n=>{queryPage=n;opportunities();});
 }
 function contextEvent(e){return {...e,event_id:e.id,source_hash:catalog.source_hash,observed_interval:{from:e.observed_from,to:e.observed_to}};}
 function impact(){
  if(!data)return;const cat=$('impactCategory').value,product=$('impactProduct').value,min=Number($('impactThreshold').value);
  const selected=data.pages.filter(p=>(!cat||p.category===cat)&&(!product||(product.startsWith('url:')?p.url===product.slice(4):p.product_id===product))&&Math.max(p.current?.impressions||0,p.previous?.impressions||0)>=min);
  const compared=selected.filter(p=>p.comparison_available),dropped=compared.filter(p=>p.delta<0).sort((a,b)=>a.delta-b.delta),urls=new Set(selected.map(p=>p.url));
  const finalDay=(raw.evidence||[]).filter(r=>r.scope==='page').map(r=>r.day).sort().at(-1),capture=(raw.evidence||[]).map(r=>r.captured_at).sort().at(-1);
  $('impactContext').replaceChildren(node('p','Güncel: '+data.month+' · Önceki: '+(data.previous_month||'Doğrulanmadı')+' · Yöntem: aynı tam ay / tam URL / cihaz / ülke kapsamı. '+note()),node('p','GSC son doğrulanmış kesin gün: '+(finalDay||'Doğrulanmadı')+' · Son çekim: '+stamp(capture)),node('p','GSC saat dilimi: '+data.timezone+'. Ayların gün sayıları farklı olabilir; tek başına neden seçilmez.'));
  const pageDelta=data.comparison_available&&data.totals&&data.previous_totals?data.totals.clicks-data.previous_totals.clicks:null;
  stats($('impactSummary'),[['Seçilen sonuçlar',number(selected.length),number(compared.length)+' karşılaştırılabilir sayfa'],['Seçili tıklama farkı',compared.length?delta(compared.reduce((n,p)=>n+p.delta,0)):'Doğrulanmadı','Yalnız iki ayda da gözlenen URL’ler'],['GSC sayfa toplamı farkı',delta(pageDelta),'Resmi mülk toplamı değildir'],['Resmi GSC site toplamı','Doğrulanmadı','Ayrı mülk toplamı kaydı yok'],['Mutabakat farkı','Doğrulanmadı','Resmi mülk toplamı olmadan hesaplanmaz']]);
  table($('impactTable'),['Düşen sayfa','Tıklama','Değişim','Gösterim','CTR','Ort. sıra','Durum / karar','İncele'],dropped.map(p=>[siteLink(p.url),number(p.current.clicks),delta(p.delta),number(p.current.impressions),percent(p.current.ctr),number(p.current.position),tags([p.current.ctr<p.previous.ctr?'CTR Kaybı':p.position_delta>.5?'Sıra Gerilemesi':'Tıklama Kaybı',p.decision]),inspect(p,'page')]));
  const queryModel=buildInsights({...raw,queries:(raw.queries||[]).filter(r=>urls.has(r.page))},old?{...old,queries:(old.queries||[]).filter(r=>urls.has(r.page))}:null,catalog.products||[],{device:scope().device},catalog.available===true);
  const losses=queryModel.queries.filter(q=>q.delta!==null&&q.delta<0&&Math.max(q.current.impressions,q.previous?.impressions||0)>=min).sort((a,b)=>a.delta-b.delta);
  $('impactQueries').replaceChildren(node('h3','Seçili sayfalarda görünür sorgu kayıpları'),node('p',queryModel.query_comparison_available?losses.length+' görünür kayıp adayı · ilk 40 kayıt. Sorgu tıklamaları anonimleştirme nedeniyle sayfa toplamına eşit değildir.':'İki dönemin görünür sorgu kapsamı tam doğrulanmadı; kayıp hesaplanmadı. Eksik satır sıfır değildir.'));
  const queryTable=node('div',null,'table-scroll');table(queryTable,['Görünür sorgu','Tıklama','Değişim','Gösterim','CTR','Ort. sıra','İncele'],losses.slice(0,40).map(q=>[q.query,number(q.current.clicks),delta(q.delta),number(q.current.impressions),percent(q.current.ctr),number(q.current.position),inspect({...q,scope_urls:[...urls]},'query')]));$('impactQueries').append(queryTable);
  const devices=[...new Set([...raw.pages||[],...old?.pages||[]].filter(r=>urls.has(r.page)).map(r=>r.device))];
  $('impactDevices').replaceChildren(node('h3','Seçili sayfalarda cihaz dağılımı'));
  const deviceTable=node('div',null,'table-scroll');table(deviceTable,['Cihaz','GSC tıklama','Önceki tıklama','Fark','Gösterim','CTR','Ort. sıra'],devices.filter(d=>scope().device==='ALL'||d===scope().device).map(device=>{const now=metric((raw.pages||[]).filter(r=>urls.has(r.page)&&r.device===device)),before=data.comparison_available?metric((old?.pages||[]).filter(r=>urls.has(r.page)&&r.device===device)):null;return [deviceName(device),number(now?.clicks),number(before?.clicks),now&&before?delta(now.clicks-before.clicks):'Doğrulanmadı',number(now?.impressions),percent(now?.ctr),number(now?.position)];}));$('impactDevices').append(deviceTable,node('p','Eksik cihaz/sayfa satırı sıfır sayılmaz; GA4 oturumları bu tabloya eklenmez.'));
  const events=(catalog.changes||[]).filter(e=>urls.has(e.url)).sort((a,b)=>b.observed_to.localeCompare(a.observed_to)),from=(data.previous_month||data.month)+'-01',to=data.month+'-31',overlap=events.filter(e=>e.observed_to.slice(0,10)>=from&&e.observed_from.slice(0,10)<=to);
  $('impactChanges').replaceChildren(node('h3','Tarihli SEO değişiklikleri · ayrı kanıt'),node('p',overlap.length?overlap.length+' kayıt karşılaştırma aralığıyla kesişiyor; bu durum neden kanıtı değildir.':'Bu sınırlı arşivde seçili sayfalarda karşılaştırma dönemine denk gelen kayıt yok; değişiklik yapılmadığı kanıtlanmaz.'),evidence((overlap.length?overlap:events).slice(0,10).map(contextEvent)));
  if(!overlap.length&&events.length)$('impactChanges').append(node('p','Gösterilen kayıtlar karşılaştırma dönemi dışında; düşüşe neden olarak kullanılamaz.'));
  $('impactChanges').append(node('p','En fazla 10 arşiv kaydı gösterilir; liste tam CMS yayın geçmişi değildir. Görünür sorgu kayıpları ve fırsatları ayrı ölçümlerdir. İncele, sayfayı değiştir demek değildir.'));
 }
 function recordDetail(row,kind){
  if(kind==='product')return openProduct(row);
  $('dialogTitle').textContent=kind==='query'?row.query:row.url;const root=$('productDetail');root.replaceChildren(node('h3',kind==='query'?'Görünür sorgu kanıtı':'Tam URL sayfa kanıtı'),node('p',note()),node('p',(kind==='query'?'Sorgu türü: '+row.type+'. Tür bir metin sınıflandırmasıdır. ':'')+'Karar: '+row.decision+'. İncele, sayfayı değiştir demek değildir.'));
  const t=node('div',null,'table-scroll');table(t,['Dönem','Tıklama','Gösterim','CTR','Ort. sıra'],[[data.month,number(row.current?.clicks),number(row.current?.impressions),percent(row.current?.ctr),number(row.current?.position)],[data.previous_month||'Önceki',number(row.previous?.clicks),number(row.previous?.impressions),percent(row.previous?.ctr),number(row.previous?.position)]]);root.append(t,node('p','Tıklama farkı '+delta(row.delta)+' · Sıra farkı '+delta(row.position_delta)+'. Eksik kayıt sıfır değildir. GA4 oturumu bu metrik değildir.'));
  if(kind==='query'){
   root.append(node('p','Fırsat: '+(row.opportunities.join(', ')||'Kural eşiğini karşılamıyor')));
   const urls=[...new Set(filterRows(raw.queries||[],scope()).filter(r=>r.query===row.query&&(!row.scope_urls||row.scope_urls.includes(r.page))).map(r=>r.page))];root.append(detail('Sorgunun gözlenen sayfaları',...urls.map(url=>siteLink(url))));if(row.scope_urls)root.append(node('p','Bu sorgu ölçümleri yalnız etki analizinde seçili '+row.scope_urls.length+' URL kapsamındadır; genel sorgu toplamı değildir.'));
  }else{const changes=(catalog.changes||[]).filter(e=>e.url===row.url);root.append(evidence(changes.slice(0,5).map(contextEvent)));}
  root.append(evidence([...(raw.evidence||[]),...(old?.evidence||[])].filter(e=>e.scope===(kind==='query'?'query':'page'))));
  if(!row.scope_urls||row.scope_urls.length===1){const button=node('button','Bu kanıtı soru-cevap ile incele','button secondary');button.onclick=()=>ask(kind==='query'?'“'+row.query+'” sorgusu nasıl değişti?'+(row.scope_urls?' '+row.scope_urls[0]:''):row.url+' neden düşüyor?',root,kind==='query'?'gsc':'auto');root.append(button);}$('productDialog').showModal();
 }
 function drawMonths(){
  const at=new Date().toISOString().slice(0,7);$('comparisonMonths').replaceChildren(...Array.from({length:12},(_,i)=>{const month=selectedYear+'-'+String(i+1).padStart(2,'0'),b=node('button',monthLabel(month).split(' ')[0]);b.type='button';b.disabled=month>at;b.dataset.month=month;b.setAttribute('aria-pressed',String(selectedMonths.has(month)));b.onclick=()=>{if(selectedMonths.has(month))selectedMonths.delete(month);else if(selectedMonths.size<6)selectedMonths.add(month);else return notify('En fazla 6 ay seçebilirsiniz.');drawMonths();};return b;}));
  $('comparisonSelection').textContent=selectedMonths.size+' ay seçildi · '+[...selectedMonths].sort().map(monthLabel).join(' / ')+' · '+deviceName(scope().device)+' · tüm ülkeler';
 }
 async function compare(){
  const months=[...selectedMonths].sort(),product=(catalog.products||[]).find(p=>p.id===$('comparisonProduct').value);if(months.length<2||months.length>6)return notify('Karşılaştırma için 2 ile 6 ay arasında seçim yapın.');if(!product)return notify('Doğrulanmış katalogdan bir ürün seçin.');
  const at=++comparisonEpoch,s=scope(),button=$('comparisonForm').querySelector('button[type=submit]');button.disabled=true;$('comparisonResult').textContent='Seçili ayların kayıtları okunuyor…';const jobs=[...months],rows=[];
  async function worker(){while(jobs.length){const month=jobs.shift();try{const source=await read('gsc-month?month='+month),m=buildInsights(source,null,[product],{device:s.device}),p=m.products[0];rows.push({month,verified:m.complete&&!!p.current,metrics:p.current,refs:source.evidence||[],captured_at:(source.evidence||[]).map(r=>r.captured_at).sort().at(-1)});}catch(e){rows.push({month,verified:false,metrics:null,refs:[],reason:e.message});}}}
  try{await Promise.all([worker(),worker()]);if(at!==comparisonEpoch||scope().revision!==s.revision)return;comparisonRows=months.map(month=>rows.find(r=>r.month===month));
   const valid=comparisonRows.filter(r=>r.verified),first=valid[0],last=valid.at(-1),difference=valid.length>1?last.metrics.clicks-first.metrics.clicks:null;
   $('comparisonResult').replaceChildren(node('h3',product.name+' · '+deviceName(s.device)),siteLink(product.canonical_url),node('p','Bu sabit doğrulanmış URL’nin seçili aylardaki gözlemleri karşılaştırılır. Katalog kaydı: '+stamp(catalog.captured_at)+'. Bu sonuç yalnızca doğrulanmış dönemlerden üretilmiştir. '+valid.length+'/'+months.length+' seçili ay doğrulandı. '+(valid.length>1?monthLabel(first.month)+' → '+monthLabel(last.month)+': '+(difference>0?'yükseliş':difference<0?'düşüş':'değişim yok')+'; ara aylardaki eksiklikler trendin sürekliliğini kanıtlamaz.':'Karşılaştırılabilir en az iki ürün dönemi bekleniyor.')));
   const summary=node('div',null,'insight-stats');stats(summary,[['Tıklama farkı',delta(difference),'Doğrulanmış ilk → son ay'],['Gösterim farkı',valid.length>1?delta(last.metrics.impressions-first.metrics.impressions):'Doğrulanmadı','Aynı tam URL / cihaz'],['CTR farkı',valid.length>1?delta((last.metrics.ctr-first.metrics.ctr)*100)+' puan':'Doğrulanmadı','Yüzde puan'],['Konum farkı',valid.length>1?delta(last.metrics.position-first.metrics.position):'Doğrulanmadı','Daha düşük konum daha iyidir']]);$('comparisonResult').append(summary,evidence(comparisonRows.flatMap(r=>r.refs.filter(e=>e.scope==='page'))));
   table($('comparisonTable'),['Ay','Tıklama','Gösterim','CTR','Ort. konum','Durum'],comparisonRows.map(r=>[monthLabel(r.month),number(r.verified?r.metrics.clicks:null),number(r.verified?r.metrics.impressions:null),percent(r.verified?r.metrics.ctr:null),number(r.verified?r.metrics.position:null),r.verified?'Doğrulanmış dönem':'Veri bekle · eksik kayıt sıfır değil']));drawComparison();
  }finally{button.disabled=false;}
 }
 function drawComparison(){drawChart($('comparisonChart'),$('comparisonChartTable'),{granularity:'month',series:comparisonRows.map(r=>({day:r.month+'-01',verified:r.verified,metrics:r.verified?r.metrics:null,fetched_at:r.captured_at}))},$('comparisonMetric').value);}
 function draft(url=''){$('draftProductName').value='';$('draftProductUrls').value=url;$('catalogDraftError').textContent='';$('catalogDialog').showModal();}
 function validateDraft(value){
  const groups=Array.isArray(value)?value:value.products||value.groups;if(!Array.isArray(groups)||groups.length>100||!groups.length)throw Error('1–100 ürün/grup içeren JSON seçin.');
  const known=new Set([...(catalog.products||[]).map(p=>p.canonical_url),...data.pages.map(p=>p.url)]);
  return groups.map((p,i)=>{if(typeof p.name!=='string'||!p.name.trim()||p.name.length>100)throw Error('Ürün adı eksik veya uzun.');const urls=p.urls||[p.canonical_url];if(!Array.isArray(urls)||!urls.length||urls.length>200)throw Error('Her grup için gözlenen URL seçin.');
   for(const url of urls){let u;try{u=new URL(url);}catch{throw Error('Geçerli bir tam sayfa URL’si girin.');}if(!['http:','https:'].includes(u.protocol)||!['mavibasim.com','www.mavibasim.com'].includes(u.hostname)||u.username||u.password||u.port||!known.has(url))throw Error('Yalnız katalogda veya GSC’de gözlenen tam mavibasim.com URL’leri taslağa alınabilir.');}
   return {id:typeof p.id==='string'?p.id:'draft-'+(i+1),name:p.name.trim(),category:CATEGORIES.includes(p.category)?p.category:CATEGORIES[4],urls:[...new Set(urls)],verified:false,draft:true};
  });
 }
 async function render(name){active=name;if(!await model())return;if(name==='products')products();if(name==='opportunities')opportunities();if(name==='impact')impact();if(name==='comparison'){setOptions('comparisonYear',[...new Set([...$('month').options].map(o=>o.value.slice(0,4)))].map(y=>[y,y]));$('comparisonYear').value=selectedYear;drawMonths();if(!comparisonRows.length)$('comparisonResult').textContent='Bir ürün ve 2–6 ay seçerek karşılaştırmayı başlatın.';}}
 document.querySelectorAll('[data-page-mode]').forEach(b=>b.onclick=()=>{pageMode=b.dataset.pageMode;page=1;products();});
 document.querySelectorAll('[data-query-type]').forEach(b=>b.onclick=()=>{queryType=b.dataset.queryType;queryPage=1;document.querySelectorAll('[data-query-type]').forEach(v=>v.setAttribute('aria-pressed',String(v===b)));opportunities();});
 $('opportunitySearch').oninput=()=>{queryPage=1;opportunities();};$('opportunityThreshold').onchange=()=>{queryPage=1;opportunities();};
 for(const id of ['impactCategory','impactProduct','impactThreshold'])$(id).onchange=impact;
 $('comparisonYear').onchange=()=>{selectedYear=$('comparisonYear').value;drawMonths();};$('comparisonMetric').onchange=drawComparison;$('comparisonForm').onsubmit=e=>{e.preventDefault();compare().catch(e=>notify(e.message));};
 $('catalogDownload').onclick=()=>download('mavi-basim-dogrulanmis-katalog.json',{format:'verified-product-catalog-v1',source:catalog.source,source_hash:catalog.source_hash,captured_at:catalog.captured_at,category_source:catalog.category_source,products:catalog.products,read_only:true});
 $('newProductGroup').onclick=()=>draft();$('closeCatalogDialog').onclick=()=>$('catalogDialog').close();setOptions('draftProductCategory',CATEGORIES.map(c=>[c,c]));
 $('catalogImport').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>150000)throw Error('JSON taslağı en fazla 150 KB olabilir.');const drafts=validateDraft(JSON.parse(await file.text()));$('catalogDraftNote').textContent=drafts.length+' grup yalnız yönetim taslağı olarak doğrulandı. Canlı katalog, analiz eşlemeleri ve arşiv değiştirilmedi.';download('mavi-basim-katalog-taslagi.json',{format:'catalog-draft-v1',based_on:catalog.source_hash,products:drafts,draft:true});}catch(error){notify(error.name==='SyntaxError'?'Geçerli bir katalog JSON dosyası seçin.':error.message);}finally{e.target.value='';}};
 $('catalogDraftForm').onsubmit=e=>{e.preventDefault();try{const products=validateDraft([{name:$('draftProductName').value,category:$('draftProductCategory').value,urls:$('draftProductUrls').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)}]);download('mavi-basim-yeni-urun-taslagi.json',{format:'catalog-draft-v1',based_on:catalog.source_hash,products,draft:true});$('catalogDraftError').textContent='Taslak indirildi. Doğrulanmış katalog ve arşiv değiştirilmedi.';}catch(error){$('catalogDraftError').textContent=error.message;}};
 return {render,products,clear(){version++;comparisonEpoch++;data=null;raw=null;old=null;catalog=null;comparisonRows=[];for(const id of ['comparisonResult','comparisonChart','comparisonTable','comparisonChartTable','opportunityTable','opportunityScope','opportunityCount','impactTable','impactSummary','impactContext','impactQueries','impactDevices','impactChanges','pageCoverage','catalogDraftNote'])$(id).replaceChildren();$('draftProductName').value='';$('draftProductUrls').value='';if($('catalogDialog').open)$('catalogDialog').close();}};
}
