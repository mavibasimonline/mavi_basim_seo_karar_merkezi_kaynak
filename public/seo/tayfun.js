// Tayfun monthly SEO evidence notebook: the source site and historical records are never changed.
const el=(tag,text='',className='')=>{const n=document.createElement(tag);if(text)n.textContent=text;if(className)n.className=className;return n;};
const dateMonth=m=>'01.'+m.slice(5)+'.'+m.slice(0,4);
const nextMonth=m=>{const d=new Date(m+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);return d.toISOString().slice(0,7);};
const previousMonth=m=>{const d=new Date(m+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,7);};
const pageName=u=>{try{const path=new URL(u).pathname;return path==='/'?'Ana Sayfa':decodeURIComponent(path.slice(1)).replaceAll('-',' ').replace(/\b\p{L}/gu,s=>s.toLocaleUpperCase('tr-TR'));}catch{return u;}};
const metric=rows=>{if(!rows?.length)return null;const clicks=rows.reduce((n,r)=>n+Number(r.clicks||0),0),impressions=rows.reduce((n,r)=>n+Number(r.impressions||0),0);return {clicks,impressions,ctr:impressions?100*clicks/impressions:null,position:impressions?rows.reduce((n,r)=>n+Number(r.position||0)*Number(r.impressions||0),0)/impressions:null};};
const nfmt=v=>Number(v).toLocaleString('tr-TR',{maximumFractionDigits:2});
const CONTROL=['title','description','h1','canonical','robots','keywords','headings','internal_links','structured_data','notes'];
const ADVANCED=['hreflang','images','open_graph','twitter_card','x_robots','viewport','lang','redirect','status_code','content_excerpt'];
const LABELS={title:'SEO Title',description:'Meta açıklaması',h1:'H1',canonical:'Canonical',robots:'Robots',keywords:'Takip edilecek hedef sorgular (virgülle)',headings:'H2–H6 / başlıklar',internal_links:'İç bağlantılar',structured_data:'Yapılandırılmış veri / JSON-LD',notes:'Notlar ve yayın kanıtı',hreflang:'Hreflang',images:'Görseller ve ALT metinleri',open_graph:'Open Graph etiketleri',twitter_card:'Twitter/X Card etiketleri',x_robots:'X-Robots-Tag',viewport:'Viewport',lang:'HTML lang',redirect:'Yönlendirme URL',status_code:'HTTP durum kodu',content_excerpt:'Kaydedilmiş sayfa içerik özeti'};
const MAX={title:300,description:1000,h1:500,canonical:2048,robots:200,headings:2500,internal_links:2500,structured_data:5000,notes:2500,keywords:3000,hreflang:2500,images:2500,open_graph:2500,twitter_card:2500,x_robots:200,viewport:500,lang:100,redirect:2048,status_code:100,content_excerpt:5000};
export function createTayfunWorkspace({api,scope,notify}){
 const root=document.getElementById('tayfunApp');
 let generation=0,cache=new Map(),revision=-1,filter='',mode='groups';
 async function getMonth(m){
  if(cache.has(m))return cache.get(m);
  const data=await api('/api/independent/tayfun?month='+m);
  cache.set(m,data);return data;
 }
 const currentMetrics=(month,url,device,raw)=>metric((raw?.pages||[]).filter(r=>r.page===url&&(device==='ALL'||r.device===device)));
 function inventory(s,sitemap=[]){
  const map=new Map();
  for(const p of s.catalog?.products||[]){
   const urls=p.urls?.length?p.urls:[p.canonical_url];
   for(const url of urls||[])if(url)map.set(url,{url,product:p.name,category:p.category||'Ürünler'});
  }
  const categoryFor=url=>{
   try{
    const path=new URL(url).pathname;
    if(path.startsWith('/blog/'))return 'Blog Sayfaları';
    if(path.startsWith('/sektor/'))return 'Sektörel Sayfalar';
    if(/-matbaa(?:\/|$)|-baski(?:\/|$)/.test(path))return 'Şehir / Baskı Sayfaları';
   }catch{}
   return 'Eşleşmemiş sayfalar';
  };
  for(const raw of [...s.current||[],s.previous].filter(Boolean))for(const r of raw.pages||[]){
   if(!map.has(r.page))map.set(r.page,{url:r.page,product:pageName(r.page),category:categoryFor(r.page)});
  }
  for(const sn of s.catalog?.snapshots||[])if(sn.url&&!map.has(sn.url))map.set(sn.url,{url:sn.url,product:pageName(sn.url),category:'Tarama arşivi'});
  for(const url of sitemap){
   if(map.has(url))continue;
   const category=categoryFor(url);
   map.set(url,{url,product:pageName(url),category});
  }
  return [...map.values()].sort((a,b)=>a.category.localeCompare(b.category,'tr')||a.product.localeCompare(b.product,'tr'));
 }
 function recordFor(records,url){
  const rows=records.filter(r=>r.url===url).sort((a,b)=>a.created_at.localeCompare(b.created_at));
  return rows.at(-1)||null;
 }
 function field(n,title,value,type='text'){
  const label=el('label',title,'tayfun-field'),control=type==='textarea'?el('textarea'):el('input');
  control.name=n;control.value=value||'';control.maxLength=MAX[n]||2000;control.placeholder=title;
  if(type!=='textarea')control.type='text';if(n==='canonical')control.placeholder='https://mavibasim.com/...';
  label.append(control);return label;
 }
 function formFor(month,url,record,seo,refresh){
  const form=el('form','','tayfun-form');
  form.append(el('h4',record?'Yeni sürüm oluştur · önceki sürüm kalır':'Yeni SEO kaydı oluştur'));
  form.append(el('p','Kaydetmek canlı siteyi değiştirmez. Kayıt sadece bu ayın SEO takip planına eklenir.','source-note'));
  for(const key of CONTROL){
   let value=record?.[key]??'';
   if(key==='keywords')value=(record?.keywords||[]).join(', ');
   if(!record&&seo){if(key==='keywords')value=seo.other_meta?.keywords||'';else if(key==='title')value=seo.title||'';else if(key==='description')value=seo.description||'';else if(key==='h1')value=(seo.headings||[]).filter(h=>h.level===1).map(h=>h.text).join('; ')||'';else if(key==='canonical')value=seo.canonical||'';else if(key==='robots')value=seo.robots||'';else if(key==='headings')value=JSON.stringify(seo.headings||[]);else if(key==='internal_links')value=JSON.stringify(seo.links||[]);else if(key==='structured_data')value=JSON.stringify(seo.structured_data||'');}
   form.append(field(key,LABELS[key],value,['description','headings','internal_links','structured_data','notes'].includes(key)?'textarea':'text'));
  }
  const extra=el('details','','tayfun-advanced');extra.append(el('summary','Ek SEO alanları (görseller, hreflang, sosyal meta, HTTP)'));
  for(const key of ADVANCED){
   let value=record?.[key]??'';
   if(!record&&seo){const saved=seo[key];value=typeof saved==='string'?saved:JSON.stringify(saved||'');}
   extra.append(field(key,LABELS[key],value,['hreflang','images','open_graph','twitter_card','content_excerpt'].includes(key)?'textarea':'text'));
  }
  form.append(extra);
  const status=el('select');status.name='status';
  for(const [key,label]of[['aktif','Aktif · takip adayı'],['pasif','Pasif · geçmişte sakla']])status.append(new Option(label,key));
  status.value=record?.status||'aktif';const statusLabel=el('label','SEO sürümünün takip durumu','tayfun-field');statusLabel.append(status);form.append(statusLabel);
  const submit=el('button','Sürümü kaydet','button primary');submit.type='submit';
  const cancel=el('button','Taslağı sil','button secondary');cancel.type='button';cancel.onclick=()=>form.remove();
  form.append(submit,cancel);
  form.onsubmit=async e=>{
   e.preventDefault();submit.disabled=true;
   try{
    const fields=Object.fromEntries(new FormData(form).entries());
    const input={...fields,month,url,supersedes:record?.id||null,keywords:String(fields.keywords||'').split(',').map(x=>x.trim()).filter(Boolean)};
    const r=await api('/api/independent/tayfun',{method:'POST',body:JSON.stringify(input)});
    if(!r.ok)throw Error(r.code||'SEO sürümü doğrulanamadı');
    cache.delete(month);notify('SEO sürümü kaydedildi. Eski kayıt silinmedi, canlı site değiştirilmedi.');refresh();
   }catch(err){notify('Kayıt hatası: '+err.message);}finally{submit.disabled=false;}
  };
  return form;
 }
 async function showEvidence(area,url,month){
  area.replaceChildren(el('p','Kaynak tarama kayıtları okunuyor…'));
  try{
   const list=await api('/api/independent/seo-history?'+new URLSearchParams({kind:'snapshot',url,to:month+'-'+new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).getUTCDate().toString().padStart(2,'0')}));
   const allowed=(list.items||[]).filter(x=>x.observed_at?.slice(0,7)<=month).sort((a,b)=>b.observed_at.localeCompare(a.observed_at));
   if(!allowed.length){area.replaceChildren(el('p','Bu ay veya öncesi için arşivlenmiş SEO tarama sürümü bulunamadı. Eksik bilgi sıfır veya boş SEO anlamına gelmez.'));return null;}
   const detail=await api('/api/independent/seo-history/detail?'+new URLSearchParams({kind:'snapshot',id:allowed[0].id}));
   area.replaceChildren(el('p','Tarihli kaynak: '+detail.observed_at+' · '+detail.source+' · '+detail.content_hash));
   const pre=el('pre',JSON.stringify(detail.fields||{},null,2),'tayfun-evidence');area.append(pre,el('p','Bu kayıt tarama zamanını gösterir; doğrulanmış yayın zamanı değildir.','source-note'));
   return detail.fields||null;
  }catch(err){area.replaceChildren(el('p','Arşiv kanıtı getirilemedi: '+err.message));return null;}
 }
 function pageDetail(month,item,record,raw,previousRaw,s,refresh,history=[],writable=true,automatic=null){
  const box=el('div','','tayfun-detail');
  const seoArea=el('section','','tayfun-proof'),recordArea=el('section','','tayfun-versions');
  box.append(seoArea,recordArea);
  if(automatic){
   const automaticArea=el('div','','tayfun-automatic');
   automaticArea.append(el('h4','Otomatik SEO kaydı · '+new Date(automatic.observed_at).toLocaleString('tr-TR')),
    el('p','Kaynak: canlı statik HTML taraması · doğrulanmış SEO yayın tarihi değildir.','source-note'));
   const facts=el('dl');
   for(const [label,value] of [
    ['SEO Title',automatic.seo?.title],['Meta açıklaması',automatic.seo?.description],
    ['H1',automatic.seo?.headings?.filter(h=>h.level===1).map(h=>h.text).join(' / ')],
    ['Canonical',automatic.seo?.canonical?.join(', ')],['Robots',automatic.seo?.robots?.join(', ')],
    ['H2–H6',automatic.seo?.headings?.filter(h=>h.level!==1).map(h=>h.level+': '+h.text).join(' | ')],
    ['Meta keywords',automatic.seo?.other_meta?.keywords],['İç bağlantılar',automatic.seo?.links?.join(', ')],
    ['Görsel ve ALT',JSON.stringify(automatic.seo?.images||[])],['JSON-LD',JSON.stringify(automatic.seo?.structured_data||[])],
    ['Hreflang',JSON.stringify(automatic.seo?.hreflang||[])],['Open Graph',JSON.stringify(automatic.seo?.open_graph||{})],
    ['Twitter/X',JSON.stringify(automatic.seo?.twitter_card||{})],['Viewport',automatic.seo?.viewport],
    ['Dil',automatic.seo?.lang],['HTTP',automatic.seo?.status],['X-Robots',automatic.seo?.x_robots],
    ['Metin özeti',automatic.seo?.excerpt],['Metin hash',automatic.seo?.body_hash]
   ]){
     const dt=el('dt',label),dd=el('dd',String(value??'Kaynakta yok'));facts.append(dt,dd);
   }
   automaticArea.append(facts);
   box.prepend(automaticArea);
  }
  const openEvidence=el('button','Tarihli SEO tarama kaydını aç','button secondary');openEvidence.type='button';seoArea.append(openEvidence);
  const info=el('div');seoArea.append(info);
  let scanned=null;
  openEvidence.onclick=async()=>{openEvidence.disabled=true;scanned=await showEvidence(info,item.url,month);openEvidence.disabled=false;};
  recordArea.append(el('h4','Kayıtlı sürümler'));
  const rows=history.filter(e=>e.url===item.url).sort((a,b)=>a.created_at.localeCompare(b.created_at));
  const sup=new Set(rows.map(r=>r.supersedes).filter(Boolean));
  if(!rows.length)recordArea.append(el('p','Bu ay için elle kaydedilmiş SEO sürümü yok. GSC görünürlüğü mevcut olabilir; SEO geçmişi otomatik olarak uydurulmaz.','source-note'));
  for(const version of rows){
   const card=el('div','','tayfun-revision');const old=sup.has(version.id);
   card.append(el('strong',(old?'Önceki sürüm · ':version.status==='pasif'?'Pasif · ':'Aktif takip · ')+new Date(version.created_at).toLocaleString('tr-TR')),el('p','Title: '+(version.title||'Kaydedilmemiş')),el('p','H1: '+(version.h1||'Kaydedilmemiş')),el('p','Hedef sorgular: '+version.keywords.join(', ')),el('p','Not: '+(version.notes||'—')));
   recordArea.append(card);
  }
  if(!writable)recordArea.append(el('p','Şifreli arşiv API erişilebilir olmadığından kayıt oluşturma kapalı. Sayfa ve GSC verileri salt okunur gösteriliyor.','source-note'));
  const add=el('button',record?'Yeni SEO sürümü oluştur':'SEO kaydı ekle','button primary');add.type='button';
  add.onclick=()=>{const old=box.querySelector('.tayfun-form');old?.remove();box.append(formFor(month,item.url,record,scanned||automatic?.seo||null,refresh));};
  if(writable)recordArea.append(add);
  if(writable&&record&&record.status==='aktif'){
   const passive=el('button','Eski sürümü pasif olarak kaydet','button secondary');
   passive.type='button';passive.onclick=()=>{box.querySelector('.tayfun-form')?.remove();const form=formFor(month,item.url,record,scanned||automatic?.seo||null,refresh);form.querySelector('[name=status]').value='pasif';box.append(form);};
   recordArea.append(passive);
  }
  const rowsCurrent=currentMetrics(month,item.url,s.device,raw),rowsPrevious=currentMetrics(previousMonth(month),item.url,s.device,previousRaw);
  if(rowsCurrent)recordArea.append(el('p','Aylık GSC: '+nfmt(rowsCurrent.clicks)+' tıklama · '+nfmt(rowsCurrent.impressions)+' gösterim · '+nfmt(rowsCurrent.position)+' sıra. Bu değer SEO değişiminin nedeni değildir.','source-note'));
  if(rowsCurrent&&rowsPrevious&&raw?.days_verified===raw?.expected_days&&previousRaw?.days_verified===previousRaw?.expected_days){
   const delta=rowsCurrent.clicks-rowsPrevious.clicks;
   recordArea.append(el('p',previousMonth(month)+' → '+month+' · Aynı URL ve cihaz için '+nfmt(rowsPrevious.clicks)+' → '+nfmt(rowsCurrent.clicks)+' GSC tıklama ('+(delta>0?'+':'')+nfmt(delta)+'). Trafik korelasyonu, SEO sürümünün etkisini kanıtlamaz.','source-note'));
  }else recordArea.append(el('p','İki tam ve karşılaştırılabilir aylık GSC sayfa kırılımı yok. Kısmi ayı tam ayla kıyaslayıp başarı kararı verilmez.','source-note'));
  return box;
 }
 async function render(){
  const at=++generation,s=scope(),month=s.month,second=nextMonth(month);
  if(revision!==s.revision){cache.clear();revision=s.revision;}
  root.replaceChildren(el('p','Aylık SEO kayıtları hazırlanıyor…'));

  let raw2=null;
  try{const result=await Promise.allSettled([getMonth(month),getMonth(second),api('/api/independent/gsc-month?month='+second),api('/api/independent/tayfun-pages'),api('/api/independent/tayfun-auto?month='+month),api('/api/independent/tayfun-auto?month='+second)]);
   if(at!==generation)return;
   const [first,after,gsc,sitemapResult,autoFirst,autoSecond]=result;
   const archiveReady=first.status==='fulfilled'&&after.status==='fulfilled';
   const firstLedger=first.status==='fulfilled'?first.value:{entries:[],unavailable:true};
   const afterLedger=after.status==='fulfilled'?after.value:{entries:[],unavailable:true};
   raw2=gsc.status==='fulfilled'?gsc.value:null;
   const sitemap=sitemapResult.status==='fulfilled'?sitemapResult.value:null;
   const pages=inventory(s,sitemap?.urls||[]);
   root.replaceChildren();
   if(!archiveReady)root.append(el('p','Tayfun arşiv hizmeti henüz güncel değil veya ulaşılamıyor. Sayfalar ve GSC verileri gösterilecek; arşiv düzeldiğinde SEO sürüm kayıtları kendiliğinden yüklenecek.','history-warning'));
   const heading=el('div','','tayfun-head');heading.append(el('h2','Tayfun · Aylık SEO Sürüm Defteri'),el('p','SEO bilgilerini ay ay kaydet, eskisini pasife al, geçmişi silmeden GSC performansını karşılaştır. Veri yalnız tarama ve kayıtlardan doğrulanır.'));root.append(heading);
   const search=el('input');search.type='search';search.placeholder='Sayfa URL, ürün veya kategori ara…';search.value=filter;
   const filterWrap=el('div','','tayfun-search');filterWrap.append(search,el('span','Kayıtlı sayfalar · '+pages.length+' gözlenen URL; tüm sitemap sayfalarının eksiksiz listesi olduğu garanti edilmez.','source-note'));root.append(filterWrap);
   const tabs=el('div','','tayfun-tabs');
   const groups=el('button','Ürün Grupları','button secondary'),unmapped=el('button','Eşleşmemiş Sayfalar','button secondary');
   groups.type='button';unmapped.type='button';groups.onclick=()=>{mode='groups';paint();};unmapped.onclick=()=>{mode='unmapped';paint();};
   tabs.append(groups,unmapped);root.append(tabs);
   const place=el('div','','tayfun-months');root.append(place);
   root.append(el('p',sitemap?.urls?.length?'Site haritasından '+sitemap.urls.length+' URL eklendi. Kaynak: '+sitemap.source+(sitemap.stale?' · Son kayıt; anlık doğrulanmadı':''): 'Site haritası doğrulanamadı; ürün, GSC ve tarama kayıtlarından görünen URL’ler listeleniyor.','source-note'));
   const rawFirst=s.current?.find(r=>r.month===month)||s.previous?.month===month&&s.previous||null;
   const months=[[month,firstLedger,rawFirst,autoFirst.status==='fulfilled'?autoFirst.value:null],[second,afterLedger,raw2,autoSecond.status==='fulfilled'?autoSecond.value:null]];
   const automaticCache=new Map();
   async function loadAutomatic(id){
    if(automaticCache.has(id))return automaticCache.get(id);
    const result=await api('/api/independent/tayfun-auto/detail?id='+encodeURIComponent(id));
    automaticCache.set(id,result);return result;
   }
   function paint(){
    place.replaceChildren();
    groups.setAttribute('aria-pressed',String(mode==='groups'));unmapped.setAttribute('aria-pressed',String(mode==='unmapped'));
    for(const [period,ledger,raw,auto] of months){
     const section=el('section','','panel tayfun-month');section.append(el('h3',dateMonth(period)+' · SEO kayıt paneli'));
     const visible=pages.filter(p=>(mode==='groups'?p.category!=='Eşleşmemiş sayfalar':p.category==='Eşleşmemiş sayfalar')&&(p.url+' '+p.product+' '+p.category).toLocaleLowerCase('tr-TR').includes(filter.toLocaleLowerCase('tr-TR')));
     const summary=el('p',visible.length+' sayfa · '+ledger.entries.length+' saklanan manuel sürüm · '+(auto?.observed_urls??'?')+' URL için otomatik tarihli SEO gözlemi · '+(raw?.days_verified??0)+'/'+(raw?.expected_days??'?')+' doğrulanmış GSC günü','source-note');section.append(summary);
     const aggregate=metric((raw?.pages||[]).filter(r=>(s.device==='ALL'||r.device===s.device)&&visible.some(p=>p.url===r.page)));
     const cards=el('div','','tayfun-kpis');
     for(const [label,value] of [['Tıklama',aggregate?nfmt(aggregate.clicks):'Veri yok'],['Gösterim',aggregate?nfmt(aggregate.impressions):'Veri yok'],['CTR',aggregate?nfmt(aggregate.ctr)+'%':'—'],['Ortalama konum',aggregate?nfmt(aggregate.position):'—']]){
      const card=el('div','','tayfun-kpi');card.append(el('small',label),el('strong',value));cards.append(card);
     }section.append(cards);
     const rawBefore=period===month?(s.current?.find(r=>r.month===previousMonth(month))||s.previous?.month===previousMonth(month)&&s.previous||null):rawFirst;
     visible.sort((a,b)=>(currentMetrics(period,b.url,s.device,raw)?.clicks||0)-(currentMetrics(period,a.url,s.device,raw)?.clicks||0));
     const columnHeading=el('div','','tayfun-table-header');
     for(const label of ['Ürün / Sayfa','Tıklama','Gösterim','CTR','Ort. sıra','Durum'])columnHeading.append(el('span',label));
     section.append(columnHeading);
     for(const p of visible){
      const line=el('details','','tayfun-page'),head=el('summary','','tayfun-page-summary');
      const result=currentMetrics(period,p.url,s.device,raw);
      const relevantEntries=period===month?ledger.entries:[...firstLedger.entries,...ledger.entries];
      const previousVersion=recordFor(relevantEntries,p.url);
      const name=el('div','','tayfun-name');name.append(el('strong',p.product),el('small',p.url,'tayfun-url'));
      const complete=raw?.days_verified===raw?.expected_days;
      const observed=(auto?.observations||[]).filter(r=>r.url===p.url).sort((a,b)=>b.observed_at.localeCompare(a.observed_at))[0]||null;
      const label=previousVersion?(previousVersion.status==='aktif'?'Aktif takip':'Pasif'):observed?'Otomatik SEO kayıtlı':'SEO kaydı yok';
      head.append(name,el('span',result?nfmt(result.clicks):'—'),el('span',result?nfmt(result.impressions):'—'),el('span',result?nfmt(result.ctr)+'%':'—'),el('span',result?nfmt(result.position):'—'),el('small',label+(complete?'':' · kısmi dönem')));
      line.append(head);
      line.addEventListener('toggle',async()=>{
       if(!line.open||line.querySelector('.tayfun-detail'))return;
       const marker=el('p','SEO sürüm kanıtları okunuyor…','source-note');line.append(marker);
       let automatic=null;
       if(observed)try{automatic=await loadAutomatic(observed.id);}catch{notify('Otomatik SEO gözlemi okunamadı; manuel kayıtlar korunuyor.');}
       marker.remove();
       if(line.open)line.append(pageDetail(period,p,previousVersion,raw,rawBefore,s,()=>render(),relevantEntries,archiveReady&&period<=new Date().toISOString().slice(0,7),automatic));
      });
      section.append(line);
     }
     if(!visible.length)section.append(el('p','Bu aramada eşleşen URL yok.'));
     place.append(section);
    }
   }
   search.oninput=()=>{filter=search.value;paint();};paint();
  }catch(err){if(at===generation)root.replaceChildren(el('p','Tayfun kayıtları yüklenemedi: '+err.message));}
 }
 return {render,clear(){generation++;root.replaceChildren();cache.clear();revision=-1;}};
}
