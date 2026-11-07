// Read-only SEO Takibi: visible partial GSC evidence, immutable SEO versions and on-demand month history.
const el=(tag,text='',cls='')=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
const fmt=n=>Number(n).toLocaleString('tr-TR',{maximumFractionDigits:2});
const val=n=>n===null||n===undefined?'Kayıt yok':fmt(n);
const percent=n=>n===null||n===undefined?'—':'%'+(100*n).toLocaleString('tr-TR',{maximumFractionDigits:2});
const pos=n=>n===null||n===undefined?'—':Number(n).toLocaleString('tr-TR',{maximumFractionDigits:1});
const date=s=>s?new Date(s).toLocaleString('tr-TR'):'Bilinmiyor';
const textField=(label,value)=>{const row=el('div','','tayfun-monitor-seo-field');row.append(el('strong',label),el('span',String(value??'')||'—'));return row;};
const note=(value)=>el('p',value,'source-note');
const openable=(name,cls='',open=false)=>{const details=el('details','',cls);details.open=open;details.append(el('summary',name));return details;};
const pretty=v=>{try{return JSON.stringify(JSON.parse(v),null,2);}catch{return String(v||'');}};
const clearMonthData=scope=>scope.page_complete?'Doğrulanmış tam sayfa ayı':'Kısmi / eksik sayfa ayı';
const coverage=scope=>scope.page_days_verified+'/'+scope.expected_days+' gün sayfa; '+scope.query_days_verified+'/'+scope.expected_days+' gün görünür sorgu';
export async function renderSeoMonitor(root,{month,device,api,notify}){
 const token=root.dataset.monitorRequest;
 root.replaceChildren(el('h3','SEO Takibi · Ürün, Kelime ve Tarihli SEO Arşivi'),
  note('GSC tıklaması müşteri veya sipariş değildir. Gerçek müşteri dönüşümü için uygun GA4 dönüşüm olayı gerekir. GSC sorguları Google tarafından anonimleştirilebilir.'));
 const status=note('Aylık GSC gözlemleri ve SEO sürümleri okunuyor…');root.append(status);
 try{
  const result=await api('/api/independent/tayfun-ai/monitor?'+new URLSearchParams({month,device}));
  if(!root.isConnected||root.dataset.monitorRequest!==token)return;
  status.textContent='Karşılaştırma: '+result.previous_month+' → '+result.month+' · Cihaz: '+(device==='ALL'?'Tüm cihazlar':device)+' · Kısmi ayın görünen değerleri gösterilir; kesin düşüş kararı verilmez.';
  const stats=el('div','','tayfun-monitor-summary');
  for(const [n,label,cls] of [[result.warning_count,'Kanıtlı önemli düşüş','down'],[result.rising_count,'Kanıtlı yükseliş','up'],[result.waiting_count,'İzleme / tam veri bekliyor','wait']]){
   const stat=el('div','','tayfun-monitor-stat '+cls);stat.append(el('strong',String(n)),el('span',label));stats.append(stat);
  }
  root.append(stats,note(result.limitation));
  const sorted=[...(result.products||[])].sort((a,b)=>({dusuyor:0,yukseliyor:1,izle:2,bekle:3}[a.status]??4)-({dusuyor:0,yukseliyor:1,izle:2,bekle:3}[b.status]??4)||a.name.localeCompare(b.name,'tr'));
  for(const product of sorted){
   const article=openable('', 'tayfun-monitor-product '+product.status);
   const head=article.querySelector('summary');
   head.append(el('strong',product.name),el('span',product.label,'tayfun-monitor-state '+product.status),el('small',(product.revisions||0)+' AI SEO analizi · '+(product.archive_count||0)+' kayıtlı sürüm'));
   const detail=el('div','','tayfun-monitor-details');
   detail.append(note(product.reason));
   detail.append(note('SEO arşivi ve kelime geçmişi silinmez; taslakların canlı siteye uygulandığı varsayılmaz.'));
   const seo=product.latest_seo;
   if(seo){
    const main=openable('Kaydedilmiş SEO başlıkları ve meta bilgileri · '+seo.month,'tayfun-monitor-seo',true);
    const fields=el('div','','tayfun-monitor-seo-grid');
    for(const [label,value] of [['SEO Title',seo.title],['Meta Description',seo.description],['H1',seo.h1],
     ['Canonical',seo.canonical],['Robots',seo.robots],['SEO kayıt ayı',seo.month],['Kayıt tarihi',date(seo.recorded_at)],
     ['Kayıt türü',seo.source==='ai-review'?'Yapay zekâ SEO analizi':'Temel / manuel SEO kaydı'],['SEO notları',seo.notes]])
     fields.append(textField(label,value));
    main.append(fields);detail.append(main);
   }
   const versions=openable('Tarihli SEO sürüm arşivi · '+(product.archive_count||0)+' sürüm','tayfun-monitor-versions');
   const versionsBody=el('div','Sürüm ayrıntıları açıldığında şifreli arşivden okunur.','tayfun-monitor-version-body');
   versions.append(versionsBody);detail.append(versions);
   let versionsLoaded=false;
   versions.addEventListener('toggle',async()=>{
    if(!versions.open||versionsLoaded)return;
    versionsLoaded=true;versionsBody.textContent='Tarihli sürümler getiriliyor…';
    try{
     const data=await api('/api/independent/tayfun-ai/context?product_id='+encodeURIComponent(product.product_id));
     if(!root.isConnected||root.dataset.monitorRequest!==token)return;
     if(data.product?.id!==product.product_id||data.product?.canonical_url!==product.url)throw Error('Ürün arşivi uyuşmadı.');
     versionsBody.replaceChildren();
     for(const [i,v] of [...(data.versions||[])].sort((a,b)=>b.created_at.localeCompare(a.created_at)).entries()){
      const entry=openable(v.month+' · '+date(v.created_at)+' · '+(v.source==='ai-review'?'AI analizi':'Temel kayıt'),'tayfun-monitor-version',i===0);
      const inside=el('div','','tayfun-monitor-version-fields');
      for(const [label,value] of [['Title',v.title],['Meta Description',v.description],['H1',v.h1],
       ['Canonical',v.canonical],['Robots',v.robots],['Sürüm kimliği',v.id],['Önceki sürüm',v.supersedes||'İlk kayıt'],
       ['Anahtar kelimeler ('+(v.keywords||[]).length+')',(v.keywords||[]).join(' · ')],['Notlar',v.notes]])
       inside.append(textField(label,value));
      for(const [label,value] of [['H1–H6 başlık yapısı',v.headings],['İç bağlantılar',v.internal_links],
       ['Schema / JSON-LD',v.structured_data],['Görseller ve ALT',v.images],
       ['Open Graph',v.open_graph],['Twitter Card',v.twitter_card],
       ['Diğer teknik meta',JSON.stringify({hreflang:v.hreflang,viewport:v.viewport,lang:v.lang,
        x_robots:v.x_robots,redirect:v.redirect,status_code:v.status_code})]]){
       const advanced=openable(label,'tayfun-monitor-seo-extra');
       advanced.append(el('pre',pretty(value),'tayfun-monitor-code'));inside.append(advanced);
      }
      if((v.keyword_decisions||[]).length){
       const dec=openable('Tarihli kelime kararları · '+v.keyword_decisions.length,'tayfun-monitor-seo-extra');
       const dBody=el('div','','tayfun-monitor-decisions');
       for(const d of v.keyword_decisions)dBody.append(textField((d.action||'İzle')+' · '+d.query,d.reason));
       dec.append(dBody);inside.append(dec);
      }
      entry.append(inside);versionsBody.append(entry);
     }
     if(!(data.versions||[]).length)versionsBody.append(note('Henüz kaydedilmiş SEO sürümü yok.'));
    }catch(error){versionsLoaded=false;versionsBody.textContent='Arşiv okunamadı: '+error.message;}
   });
   const prev=product.scopes?.previous||{month:result.previous_month,page_days_verified:0,query_days_verified:0,expected_days:0,page_complete:false};
   const curr=product.scopes?.selected||{month:result.month,page_days_verified:0,query_days_verified:0,expected_days:0,page_complete:false};
   const page=el('div','','tayfun-monitor-month-pair');
   for(const [scope,data] of [[prev,product.observed_previous],[curr,product.observed_current]]){
    const panel=el('div','','tayfun-monitor-month-card');
    panel.append(el('strong',scope.month+' · '+clearMonthData(scope)),el('small',coverage(scope)));
    const metrics=el('div','','tayfun-monitor-month-stats');
    for(const [label,value] of [['Tıklama',val(data?.clicks)],['Gösterim',val(data?.impressions)],['CTR',percent(data?.ctr)],['Ort. sıra',pos(data?.position)]])
     metrics.append(textField(label,value));
    panel.append(metrics);page.append(panel);
   }
   detail.append(page,note('Yukarıdaki değerler yalnız gözlenen GSC satırlarının toplamıdır. Kısmi ayda tam aylık toplam veya düşüş hükmü değildir. “Kayıt yok” sıfır tıklama anlamına gelmez.'));
   const words=product.keywords||[];
   const wordPanel=openable('Silinmeyen anahtar kelime takibi · '+words.length+' sorgu','tayfun-monitor-keywords',words.length>0);
   if(words.length){
    const wrap=el('div','','tayfun-monitor-keyword-scroll');
    const table=el('div','','tayfun-monitor-keyword-table');
    const headers=el('div','','tayfun-monitor-keyword-head');
    for(const name of ['Sorgu','Önce tık','Önce göst.','Önce CTR','Önce sıra','Şimdi tık','Şimdi göst.','Şimdi CTR','Şimdi sıra','Karar'])
     headers.append(el('strong',name));
    table.append(headers);
    for(const w of words){
     const row=el('div','','tayfun-monitor-keyword-row');
     for(const v of [w.query,val(w.previous_clicks),val(w.previous_impressions),percent(w.previous_ctr),pos(w.previous_position),
      val(w.current_clicks),val(w.current_impressions),percent(w.current_ctr),pos(w.current_position),w.decision||'izle'])
      row.append(el('span',v));
     row.title=w.decision_reason||w.status||'';
     table.append(row);
    }
    wrap.append(table);wordPanel.append(wrap);
    wordPanel.append(note('GSC sorgu metrikleri organik arama görünürlüğüdür; bunlardan satış, teklif veya gerçek müşteri sayısı çıkarılmaz. Kaydı olmayan sorgu sıfır değildir.'));
   }else wordPanel.append(note('Henüz izlenecek kelime arşivi veya doğrulanmış görünür sorgu yok.'));
   detail.append(wordPanel);
   if(words.length&&product.archive_count){
    const history=openable('Kelime bazında 3 / 6 / 12 aylık geçmiş','tayfun-monitor-trends');
    const filters=el('div','','tayfun-monitor-trend-filters');
    const querySelect=el('select','','tayfun-monitor-select');
    for(const w of words)querySelect.append(new Option(w.query,w.query));
    const protectedQuery=words.find(w=>w.decision==='koru');if(protectedQuery)querySelect.value=protectedQuery.query;
    const range=el('select','','tayfun-monitor-select');
    for(const x of [3,6,12])range.append(new Option('Son '+x+' ay',String(x)));
    filters.append(querySelect,range);
    const series=el('div','','tayfun-monitor-trend-series');
    history.append(filters,note('Aylık kaynak yalnız mevcut ve doğrulanmış GSC günlük arşividir. SEO kayıt ayı, sitenin yayın tarihi değildir.'),series);
    let generation=0;
    const loadSeries=async()=>{
     const current=++generation;series.replaceChildren(note('Aylık geçmiş okunuyor…'));
     try{
      const response=await api('/api/independent/tayfun-ai/trends?'+new URLSearchParams({
       product_id:product.product_id,month,device,span:range.value,query:querySelect.value}));
      if(current!==generation||!root.isConnected||root.dataset.monitorRequest!==token)return;
      const grid=el('div','','tayfun-monitor-series-table');
      const header=el('div','','tayfun-monitor-series-row tayfun-monitor-series-head');
      for(const v of ['Ay','Sorgu tıklama','Gösterim','CTR','Ort. sıra','Sayfa tıklama','GSC kapsamı','SEO sürümü'])header.append(el('strong',v));
      grid.append(header);
      for(const m of response.months||[]){
       const row=el('div','','tayfun-monitor-series-row');
       for(const value of [m.month,val(m.query?.clicks),val(m.query?.impressions),percent(m.query?.ctr),pos(m.query?.position),
        val(m.page?.clicks),m.error?'Kaynak okunamadı':coverage(m.coverage),m.seo?.recorded_at?
         m.seo.recorded_at.slice(0,7)+' · '+(m.seo.source==='ai-review'?'AI':'Temel'):'SEO kaydı yok'])
        row.append(el('span',value));
       grid.append(row);
      }
      series.replaceChildren(grid,note(response.caveat));
     }catch(error){
      if(current===generation)series.replaceChildren(note('Aylık geçmiş okunamadı: '+error.message+'. Eski kayıtlar korunuyor.'));
     }
    };
    history.addEventListener('toggle',()=>{if(history.open)loadSeries();else generation++;});
    querySelect.addEventListener('change',()=>{if(history.open)loadSeries();});
    range.addEventListener('change',()=>{if(history.open)loadSeries();});
    detail.append(history);
   }
   article.append(detail);root.append(article);
  }
 }catch(error){if(root.dataset.monitorRequest===token)status.textContent='SEO Takibi verisi okunamadı: '+error.message+'. Önceki kayıtlar korunuyor.';}
}
