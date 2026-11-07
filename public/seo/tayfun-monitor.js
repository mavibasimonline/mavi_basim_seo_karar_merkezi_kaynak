// Visible read-only SEO trend monitoring. No edits, backfills or website publishing.
const el=(tag,text='',cls='')=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
const number=n=>Number(n).toLocaleString('tr-TR',{maximumFractionDigits:1});
const display=n=>n===null||n===undefined?'Veri bekleniyor':number(n);
export async function renderSeoMonitor(root,{month,device,api,notify}){
 const requestToken=root.dataset.monitorRequest;
 root.replaceChildren(el('h3','SEO Takibi · Düşen ve Yükselen Çalışmalar'),el('p','SEO İşleri’nde kaydettiğiniz sürümlerin ardından ürün ve kelime GSC değişimlerini izler. Sadece tam, doğrulanmış ve aynı cihaz kapsamındaki aylar karşılaştırılır.','source-note'));
 const status=el('p','Tarihli SEO sürümleri ve doğrulanmış GSC verileri kontrol ediliyor…','source-note');root.append(status);
 try{
  const result=await api('/api/independent/tayfun-ai/monitor?'+new URLSearchParams({month,device}));
  if(!root.isConnected||root.dataset.monitorRequest!==requestToken)return;
  status.textContent='Karşılaştırma: '+result.previous_month+' → '+result.month+' · Cihaz: '+(device==='ALL'?'Tüm cihazlar':device)+' · Siteye değişiklik yapılmaz.';
  const summary=el('div','','tayfun-monitor-summary');
  for(const [count,label,kind] of [[result.warning_count,'Düşüş uyarısı','down'],[result.rising_count,'Yükseliş','up'],[result.waiting_count,'Veri / yeni sürüm bekliyor','wait']]){
   const item=el('div','','tayfun-monitor-stat '+kind);item.append(el('strong',String(count)),el('span',label));summary.append(item);
  }
  root.append(summary);
  if(result.warning_count)notify('SEO Takibi: '+result.warning_count+' üründe önemli GSC düşüşü görüldü. Kanıtları kontrol edin; otomatik sayfa değişikliği yapılmadı.');
  root.append(el('p',result.limitation,'source-note'));
  const sorted=[...(result.products||[])].sort((a,b)=>({dusuyor:0,yukseliyor:1,izle:2,bekle:3}[a.status]??4)-({dusuyor:0,yukseliyor:1,izle:2,bekle:3}[b.status]??4)||a.name.localeCompare(b.name,'tr'));
  for(const product of sorted){
   const article=el('details','','tayfun-monitor-product '+product.status);
   const summary=el('summary');summary.append(el('strong',product.name),el('span',product.label,'tayfun-monitor-state '+product.status),el('small',product.revisions+' SEO sürümü'));
   article.append(summary);
   const detail=el('div','','tayfun-monitor-details');
   detail.append(el('p','İlk kayıt: '+(product.first_saved_at?new Date(product.first_saved_at).toLocaleString('tr-TR'):'Henüz yok')+' · Son sürüm: '+(product.latest_saved_at?new Date(product.latest_saved_at).toLocaleString('tr-TR'):'Henüz yok')));
   detail.append(el('p','Son SEO sürümü: '+(product.latest_revision_id||'Yok')+' · Bu kayıt canlı yayın kanıtı değildir.'));
   detail.append(el('p',product.reason));
   detail.append(el('p','GSC sayfa tıklaması: '+display(product.previous_clicks)+' → '+display(product.current_clicks)+' · Fark: '+(product.click_delta===null?'Karşılaştırma bekleniyor':(product.click_delta>0?'+':'')+display(product.click_delta))));
   detail.append(el('p','GSC kapsamı: '+product.previous_month+' '+product.coverage.previous+'/'+product.coverage.previous_expected+' gün · '+product.selected_month+' '+product.coverage.selected+'/'+product.coverage.selected_expected+' gün'));
   if(product.keywords.length){
    const kw=el('details','','tayfun-monitor-keywords');kw.append(el('summary','Takip edilen kelimeler · '+product.keywords.length));
    const table=el('div','','tayfun-monitor-keyword-table');
    const head=el('div','','tayfun-monitor-keyword-head');for(const label of ['Anahtar kelime','Önce','Sonra','Durum'])head.append(el('strong',label));table.append(head);
    for(const word of product.keywords){const row=el('div','','tayfun-monitor-keyword-row');for(const value of [word.query,display(word.previous_clicks),display(word.current_clicks),word.status])row.append(el('span',value));table.append(row);}
    kw.append(table);detail.append(kw);
   }else detail.append(el('p',product.revisions?'Kelime karşılaştırması için iki tam ay bekleniyor.':'Yapay zekâ SEO sürümü henüz kaydedilmedi.','source-note'));
   article.append(detail);root.append(article);
  }
 }catch(error){if(root.dataset.monitorRequest===requestToken)status.textContent='SEO Takibi verisi okunamadı: '+error.message+'. Önceki kayıtlar korunuyor.';}
}
