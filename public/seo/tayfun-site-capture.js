// Read-only, product and sitemap SEO evidence. Never edits mavibasim.com.
const E=(tag,text='',className='')=>{const node=document.createElement(tag);if(text)node.textContent=text;if(className)node.className=className;return node;};
export function mountSiteCapture(host,{api,notify}){
 const section=E('section','','tayfun-site-capture');
 const title=E('h4','8 Kasım 2026 · Site SEO Envanteri');
 const detail=E('p','Sitemap üzerinden gerçek HTML taraması: SEO Title, Meta Description, H1–H6, canonical, robots, JSON-LD ve sosyal meta. Eski sürümler silinmez; canlı siteye değişiklik uygulanmaz.','source-note');
 const status=E('p','Sayfa kayıtları kontrol ediliyor…','tayfun-site-status');
 status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const button=E('button','Eksik SEO sayfalarını şimdi tara','button secondary');button.type='button';
 const search=E('input','','tayfun-site-search');search.type='search';search.placeholder='Kaydedilen site URL veya başlığı ara…';search.setAttribute('aria-label','Site SEO kayıtlarında ara');
 const list=E('div','','tayfun-site-list');
 section.append(title,detail,status,button,search,list);host.append(section);
 let state=null;
 const showField=(box,label,value)=>{
  const row=E('div','','tayfun-site-field'),head=E('strong',label),val=E('pre',typeof value==='string'?value:JSON.stringify(value??'',null,2));
  row.append(head,val);box.append(row);
 };
 async function openDetails(box,id){
  box.replaceChildren(E('p','Kaydedilmiş SEO verisi açılıyor…'));
  try{
   const page=await api('/api/independent/tayfun-auto/detail?id='+encodeURIComponent(id));
   if(!page||page.id!==id||page.status!==200)throw Error('Doğrulanmış tarama kaydı bulunamadı');
   box.replaceChildren();
   showField(box,'SEO Title',page.seo.title||'');
   showField(box,'Meta Description',page.seo.description||'');
   showField(box,'Canonical',page.seo.canonical||'');
   showField(box,'H1–H6 başlıklar',page.seo.headings||[]);
   showField(box,'Robots',page.seo.robots||'');
   showField(box,'Meta etiketleri',page.seo.all_meta||{});
   showField(box,'JSON-LD / Yapısal veri',page.seo.structured_data||[]);
   showField(box,'Open Graph',page.seo.open_graph||{});
   showField(box,'Twitter Card',page.seo.twitter_card||{});
   showField(box,'Hreflang',page.seo.hreflang||[]);
   showField(box,'Görseller / ALT',page.seo.images||[]);
   showField(box,'İç bağlantılar',page.seo.links||[]);
   showField(box,'Sayfa metin özeti',page.seo.excerpt||'');
   showField(box,'Kaynak, gözlem ve hash',page.observed_at+' · '+page.source+' · '+page.hash);
  }catch(error){box.replaceChildren(E('p','Kayıt açılamadı: '+(error.message||'Kaynak hatası'),'history-warning'));}
 }
 function render(){
  list.replaceChildren();
  if(!state)return;
  const query=search.value.trim().toLocaleLowerCase('tr-TR');
  const rows=(state.items||[]).filter(x=>(x.url+' '+x.title).toLocaleLowerCase('tr-TR').includes(query));
  if(!rows.length){list.append(E('p','Bu aramada kaydedilen bir sayfa bulunamadı.','source-note'));return;}
  const max=1000;
  for(const row of rows.slice(0,max)){
   const card=E('details','','tayfun-site-record');
   const date=new Date(row.observed_at).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul'});
   card.append(E('summary',row.title+' · '+row.url+' · '+date));
   const inner=E('div','','tayfun-site-record-body');card.append(inner);
   card.addEventListener('toggle',()=>{if(card.open&&!inner.dataset.loaded){inner.dataset.loaded='true';openDetails(inner,row.source_id);}});
   list.append(card);
  }
  if(rows.length>max)list.append(E('p',(rows.length-max)+' kayıt daha var; aramayla filtreleyin.','source-note'));
 }
 async function refresh(){
  try{
   const previousCount=state?.captured_count??-1;
   state=await api('/api/independent/tayfun/site-capture/status');
   if(state?.reference_day!=='2026-11-08'||!Array.isArray(state.items))throw Error('SEO arşiv yanıtı hatalı');
   const failed=state.failures?.length||0;
   const captured=state.captured_count||0,total=state.expected_urls||0;
   const last=state.last_run?new Date(state.last_run).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul'}):'Henüz tarama yapılmadı';
   status.textContent='8 Kasım 2026 envanteri · Kaydedilen: '+captured+' / '+total+' site sayfası · '+state.product_pages_captured+' / '+state.product_pages_total+' ürün · Son tarama: '+last+' · '+(failed?failed+' erişilemeyen sayfa · ':'')+(state.complete?'Tamamlandı':'Eksikler otomatik tamamlanıyor')+'. Gerçek tarama tarihleri her sayfada gösterilir.';
   button.disabled=state.complete||state.clock_day<state.reference_day;
   if(previousCount!==captured&&!list.querySelector('.tayfun-site-record[open]'))render();
  }catch(error){status.textContent='SEO arşivi okunamadı: '+(error.message||'Bağlantı hatası');}
 }
 async function run(){
  if(button.disabled)return;
  button.disabled=true;
  button.textContent='Gerçek SEO taraması yapılıyor…';
  try{
   const result=await api('/api/independent/tayfun/site-capture/run',{method:'POST',body:'{}'});
   if(result?.status==='held'||result?.status==='outside_reference_day')
    notify?.('Canlı SEO kaydı tamamlanamadı: '+(result.code||result.status));
   await refresh();
  }catch(error){status.textContent='Tarama işlemi tamamlanamadı: '+error.message;}
  finally{button.textContent='Eksik SEO sayfalarını şimdi tara';button.disabled=state?.clock_day<state?.reference_day||state?.complete;}
 }
 button.addEventListener('click',run);
 search.addEventListener('input',render);
 const refreshTimer=setInterval(()=>{if(!section.isConnected){clearInterval(refreshTimer);return;}if(document.visibilityState==='visible'&&!state?.complete)refresh();},60000);
 refresh();
}
