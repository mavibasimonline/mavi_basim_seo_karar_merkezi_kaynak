// Presentation of stored, verified evidence. Never invokes legacy D1 APIs or collection.
import {$,node,number,percent,deviceName,date,time,icon,badge,detail,list,siteLink,empty} from '../../public/ui.js';
import {drawChart} from '../../public/chart.js';
import {table,sortableChart} from '../../public/seo/tables.js';
import {comparisonDecision} from '../independent-gsc-analysis';

const label=m=>new Date(m+'-01T00:00:00Z').toLocaleDateString('tr-TR',{month:'long',year:'numeric',timeZone:'UTC'});
const prior=(m,n=1)=>{const d=new Date(m+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()-n);return d.toISOString().slice(0,7);};
const closedMonth=()=>{const d=new Date(Date.now()-3*86400000);d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,7);};
const stamp=s=>s?new Date(s).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul'}):'Doğrulanmadı';
function sum(rows,zero=false){
 if(!rows.length&&!zero)return null;
 const clicks=rows.reduce((n,r)=>n+r.clicks,0),impressions=rows.reduce((n,r)=>n+r.impressions,0);
 return {clicks,impressions,ctr:impressions?clicks/impressions:0,position:impressions?rows.reduce((n,r)=>n+r.position*r.impressions,0)/impressions:0};
}
function evidence(refs=[]){
 const ul=node('ul',null,'evidence-list');
 for(const r of refs){
  let text;
  if(r.event_id)text='SEO değişikliği '+r.url+' · '+(r.publication_evidence?'Kanıtlı yayın: '+stamp(r.published_at):'Tarama aralığı: '+stamp(r.observed_interval?.from)+' — '+stamp(r.observed_interval?.to))+' · '+(r.changed_fields||[]).join(', ')+' · Başlık: '+r.before?.title+' → '+r.after?.title+' · H1: '+(r.before?.h1||[]).join(' / ')+' → '+(r.after?.h1||[]).join(' / ')+' · Hash: '+r.before?.content_hash+' → '+r.after?.content_hash+' · Kaynak: '+r.source_hash;
  else if(r.source==='Google Ads Keyword Planner CSV arşivi')text='Keyword Planner · '+r.file+' · satır '+r.row_number+' · '+r.exported_at+' (kaynak saat dilimi bilinmiyor) · '+r.period+' · '+r.keyword+' · pazar hacmi '+r.avg_monthly_searches+' · SHA-256 '+r.sha256;
  else if(r.property)text='GA4 · '+r.property+' · '+r.kind+' · '+r.from+' — '+r.to+' · '+r.timezone+' · '+stamp(r.captured_at)+' · '+(r.hashes||[]).join(', ');
  else text='GSC · '+r.day+' · '+(r.scope==='page'?'Sayfa':'Görünür sorgu')+' · '+stamp(r.captured_at)+' · '+r.generation+' · '+(r.page_hashes||[]).join(', ');
  ul.append(node('li',text));
 }
 if(!ul.children.length)ul.append(node('li','Bu kapsamda kaynak referansı doğrulanmadı.'));
 return detail('Kaynaklar, tarihler ve kanıtlar',ul);
}
export function createIndependentPanel({api,notify}){
 document.querySelector('[data-view="products"]').setAttribute('aria-label','Ürün & Canlı Sayfa Analizi');
 document.querySelector('[data-view="products"] .nav-label').textContent='Ürün & Canlı Sayfa Analizi';
 $('leadersTitle').textContent='İlk 5 Lider Ürün';
 let current=[],previous=null,ga4=null,oldGa4=null,status=null,ga4Status=null,planner=null,changes=null,archive=null,catalog=null,workspace=null,workspacePromise=null,history=null,historyPromise=null,activeView='overview',errors=[],revision=0,queryPage=1,first=true,metric='clicks',sort={key:'clicks',direction:'desc'};
 const cache=new Map();
 const target=()=>$('month').value,device=()=>$('device').value;
 const selectedRows=raw=>(raw?.pages||[]).filter(r=>device()==='ALL'||r.device===device());
 const mappings=()=>catalog?.available?catalog.products:[...new Map(current.flatMap(r=>r.mappings||[]).map(p=>[p.id,p])).values()];
 function workspaceModule(){
  if(!workspacePromise){const css=node('link');css.rel='stylesheet';css.href='/seo/workspace.css';document.head.append(css);
   workspacePromise=import('./seo/workspace.js').then(({createInsightsWorkspace})=>workspace=createInsightsWorkspace({api,read,table,evidence,openProduct,ask,notify,scope:()=>({current,previous,ga4,oldGa4,status,ga4Status,changes,catalog,month:target(),device:device(),revision})})).catch(()=>{workspacePromise=null;throw Error('Analiz ekranı şu an yüklenemedi. Yenilemeyi deneyin.');});
  }return workspacePromise;
 }
 function historyModule(){if(!historyPromise)historyPromise=import('./seo/history.js').then(({createHistoryWorkspace})=>history=createHistoryWorkspace({read,notify,evidence,scope:()=>({catalog,month:target(),device:device(),revision})})).catch(()=>{historyPromise=null;throw Error('Geçmiş ekranı yüklenemedi.');});return historyPromise;}
 const complete=()=>current.length===Number($('rangeMonths').value)&&current.every(r=>r.available);
 const productsData=()=>mappings().map(p=>{
  const now=complete()?sum(current.flatMap(selectedRows).filter(r=>(p.urls||[p.canonical_url]).includes(r.page))):null;
  const before=previous?.available?sum(selectedRows(previous).filter(r=>(p.urls||[p.canonical_url]).includes(r.page))):null;
  return {...p,current:now,previous:before,delta:now&&before?now.clicks-before.clicks:null,decision:comparisonDecision(now,before)};
 });
 async function read(path,signal){
  const saved=cache.get(path);if(saved&&Date.now()-saved.at<(path.startsWith('seo-history')?60000:300000))return saved.value;
  const timeout=AbortSignal.timeout(30000),combined=signal?AbortSignal.any([signal,timeout]):timeout;const value=await api('/api/independent/'+path,{signal:combined});if(cache.size>=40)cache.delete(cache.keys().next().value);cache.set(path,{at:Date.now(),value});return value;
 }
 function coverage(){
  const days=current.reduce((n,r)=>n+(r.days_verified||0),0),expected=current.reduce((n,r)=>n+(r.expected_days||0),0);
  return 'GSC sayfa kapsamı '+days+'/'+expected+' gün. '+(complete()?'Seçili dönem doğrulandı.':'Eksik günler sıfır değildir; dönem toplamı ve SEO kararı üretilmez.');
 }
 function chart(next=metric){
  metric=next;const series=[];
  for(const raw of current){
   const count=new Date(Date.UTC(Number(raw.month.slice(0,4)),Number(raw.month.slice(5)),0)).getUTCDate();
   for(let i=1;i<=count;i++){
    const day=raw.month+'-'+String(i).padStart(2,'0'),observed=raw.daily?.find(r=>r.day===day&&r.verified);
    series.push({day,verified:!!observed,metrics:observed?sum(observed.devices.filter(r=>device()==='ALL'||r.device===device()),true):null,fetched_at:observed?.fetched_at});
   }
  }
  drawChart($('performanceChart'),$('chartTable'),{series},metric);sortableChart($('chartTable'));
  $('chartPeriod').textContent=current.map(r=>label(r.month)).join(' · ')+' · '+deviceName(device());
  $('chartCoverage').textContent=coverage();
 }
 function kpis(){
  const now=complete()?sum(current.flatMap(selectedRows),true):null,before=previous?.available?sum(selectedRows(previous),true):null;
  $('kpis').replaceChildren(...[['clicks','Toplam tıklama','click'],['impressions','Toplam gösterim','eye'],['ctr','Ortalama CTR','percent'],['position','Ortalama konum','rank']].map(([key,title,kind])=>{
   const card=node('article',null,'kpi-card'),head=node('div',null,'kpi-label');head.append(node('span',title),icon(kind));
   card.append(head,node('div',key==='ctr'?percent(now?.[key]):number(now?.[key]),'kpi-value'+(!now?' no-data':'')));
   const caption=node('div',null,'kpi-caption');
   if(now&&before&&before[key]>0){const rate=(now[key]-before[key])/before[key],change=now[key]-before[key],better=key==='position'?change<=0:change>=0;caption.append(node('span',key==='ctr'?number(change*100)+' puan':key==='position'?number(change)+' sıra':(rate>0?'+':'')+percent(rate),'delta'+(better?'':' down')),node('span','önceki aya göre'));}
   else caption.append(node('span','Karşılaştırılabilir dönem bekleniyor'));
   card.append(caption,node('p','Önceki dönem: '+(key==='ctr'?percent(before?.[key]):number(before?.[key])),'kpi-previous'),node('small',now?'GSC verisi doğrulandı':'GSC kapsamı bekleniyor','kpi-previous'));return card;
  }));
 }
 function productRows(items){return items.map(p=>{
  const button=node('button',p.name,'text-button');button.onclick=()=>openProduct(p);
  const page=node('div',null,'product-name');page.append(button,siteLink(p.canonical_url));
  return [page,number(p.current?.clicks),number(p.current?.impressions),percent(p.current?.ctr),number(p.current?.position),p.delta===null?'Doğrulanmadı':(p.delta>0?'+':'')+number(p.delta),badge(p.decision)];
 });}
 function products(next=sort){
  sort=next;const q=$('productSearch').value.toLocaleLowerCase('tr-TR'),decision=$('decisionFilter').value;
  document.querySelectorAll('[data-product-sort]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.productSort===sort.key)));
  const rows=productsData().filter(p=>(p.name+' '+p.canonical_url).toLocaleLowerCase('tr-TR').includes(q)&&(!decision||p.decision===decision));
  rows.sort((a,b)=>{const key=sort.key,av=key==='name'?a.name:key==='decision'?a.decision:key==='change'?Math.abs(a.delta??0):a.current?.[key]??-1,bv=key==='name'?b.name:key==='decision'?b.decision:key==='change'?Math.abs(b.delta??0):b.current?.[key]??-1;return (typeof av==='string'?av.localeCompare(bv,'tr'):av-bv)*(sort.direction==='asc'?1:-1);});
  table($('products'),['Ürün / doğrulanmış URL','Tıklama','Gösterim','CTR','Ort. konum','Önceki aya fark','Karar'],productRows(rows));
  $('productCount').textContent=number(rows.length);$('productPeriod').textContent=coverage();
  const leaders=productsData().filter(p=>p.current).sort((a,b)=>b.current.clicks-a.current.clicks).slice(0,5),total=complete()?sum(current.flatMap(selectedRows),true)?.clicks:null;
  $('leadersTable').replaceChildren();const leaderList=node('div',null,'leader-list');
  for(const p of leaders){const card=node('article',null,'leader-item'),button=node('button','Ürüne Git','button secondary');button.onclick=()=>openProduct(p);card.append(node('strong',p.name),node('small',p.category||'Kategori doğrulanmadı'),node('span',number(p.current.clicks)+' tıklama'),node('small','GSC sayfa tıklama payı: '+(total?percent(p.current.clicks/total):'Doğrulanmadı')),button);leaderList.append(card);}
  $('leadersTable').append(leaderList);$('leadersNote').textContent='Tıklamaya göre ilk 5 · pay, doğrulanmış GSC sayfa toplamına göredir.';
  const keep=productsData().filter(p=>p.decision==='Koru');$('protect').textContent=keep.length?keep.map(p=>p.name).join(', ')+': önemli olumsuz kanıt yok; çalışan sayfaları koruyun.':'Kapsam veya örneklem yeterli olmadan sayfa değişikliği önermiyoruz.';
  const review=productsData().filter(p=>p.decision==='İncele');$('attentionPanel').hidden=!review.length;$('priorities').textContent=review.map(p=>p.name).join(', ')+': inceleme adayı. İncele, sayfayı değiştir kararı değildir.';
  if(workspace&&activeView==='products')workspace.products(next);
 }
 function queries(page=1){queryPage=page;const at=revision;workspaceModule().then(w=>{if(at===revision&&!$('app').hidden)return w.queries(page);}).catch(e=>notify(e.message));}
 function organic(){
  $('organicPanel').hidden=false;
  const kind=$('organicFacet').value,rows=ga4?.[kind]||[],baseline=ga4?.closed&&oldGa4?.closed&&ga4.property?.id===oldGa4.property?.id&&ga4.property?.time_zone===oldGa4.property?.time_zone?oldGa4[kind]||[]:[];
  const key=r=>kind==='cities'?[r.country,r.region,r.city].join(' / '):kind==='devices'?deviceName(String(r.device).toUpperCase()):r.page;
  table($('organicTable'),[kind==='cities'?'Ülke / Bölge / Şehir':kind==='devices'?'Cihaz':'Açılış yolu','Aktif kullanıcı','Organik oturum','Etkileşimli oturum','Önceki ay oturum'],rows.map(r=>{const old=baseline.find(p=>key(p)===key(r));return [key(r),number(r.active_users),number(r.sessions),number(r.engaged_sessions),old?number(old.sessions):'Doğrulanmadı'];}),{initialSort:2});
  $('organicPeriod').textContent=ga4?.from?ga4.from+' — '+ga4.to+' · '+ga4.property?.time_zone+' · '+(ga4.closed?'Tam dönem':'Kısmi dönem'):'GA4 dönem verisi doğrulanmadı.';
  const total=ga4?.devices?.length?ga4.devices.reduce((n,r)=>n+r.sessions,0):null;
  $('organicSummary').replaceChildren(node('strong',total===null?'Organik oturum: doğrulanmadı':'Organik oturum: '+number(total)),node('p','Kaynak: GA4 Organic Search · '+target()+' · tüm cihazlar ve ülkeler. Üstteki GSC cihaz filtresi GA4 tablolarına uygulanmaz. Aktif kullanıcılar satırlar arasında toplanmaz.'),...(ga4?.thresholded?[node('p','Google gizlilik eşiği mevcut; kapsam sınırlı olabilir.')]:[]),...(ga4?.other_rows?[node('p','Bazı GA4 satırları (other) altında birleştirilmiş.')]:[]),evidence(ga4?.evidence));
 }
 function radar(){
  const root=$('radarResults');root.replaceChildren();
  const heading=node('section',null,'panel padded');heading.append(node('h2','SEO Fırsat Radarı'),node('p','Doğrulanmış GSC değişimleri inceleme önceliği belirler. İncele, içerik değişikliği önerisi değildir. Ürün grubu ile tek URL ve GA4 oturumu ile GSC tıklaması ayrı tutulur.'));root.append(heading);
  for(const decision of ['İncele','Koru','Veri bekle']){
   const items=productsData().filter(p=>p.decision===decision),section=node('section',null,'panel padded');section.append(node('h3',decision+' · '+items.length));
   for(const p of items){const button=node('button',p.name+' · '+(p.delta===null?'Karşılaştırma eksik':number(p.delta)+' GSC tıklama farkı'),'button secondary');button.onclick=()=>openProduct(p);section.append(button);}
   if(!items.length)section.append(node('p','Bu karar için kayıt yok.'));root.append(section);
  }
 }
 function calendar(day=null){const at=revision;historyModule().then(w=>{if(at===revision&&!$('app').hidden)return w.render('changes',day);}).catch(e=>notify(e.message));}
 function health(){
  const seen=new Set((status?.coverage||[]).map(r=>r.day+':'+r.scope));
  const root=$('dataAuditResults');root.replaceChildren(node('h3','Kaynaklar ve otomatik çalışma'),node('p','Günlük GSC: '+seen.size+'/14 kayıt · '+(status?.connected?'Google izni kayıtlı':'Bağlantı doğrulanmadı')),node('p',coverage()),node('p',current.map(r=>r.month+': '+(r.query_days_verified||0)+'/'+(r.expected_days||0)+' görünür sorgu günü').join(' · ')),node('p','Son Cron: '+stamp(status?.cron?.last?.scheduled_at)+' · '+(status?.cron?.last?.status||'Doğrulanmadı')),node('p','GA4: '+(ga4Status?.property?ga4Status.property.name+' · '+ga4Status.property.id:'Doğrulanmış mülk bekleniyor')+' · '+(ga4Status?.connected?'İzin kayıtlı':'İzin doğrulanmadı')),node('p','Keyword Planner: '+(planner?planner.files+' CSV / '+planner.rows+' kaynak satırı; D1 doğrulaması '+planner.d1_verified_rows+'/'+planner.rows:'Kaynak bekleniyor')+'. Pazar hacmi GSC tıklaması değildir.'),node('p','Haziran–Ağustos kuyruğu: '+(status?.catchup?status.catchup.completed_scopes+'/'+status.catchup.total_scopes+' kapsam işi':'Durum bekleniyor')+'. Eksik gün sıfır değildir.'),node('p','Son GA4 otomasyonu: '+stamp(ga4Status?.cron?.scheduled_at)),node('p','Değişiklik kaynağı: '+stamp(changes?.captured_at)+' · '+(changes?.source_hash||'Doğrulanmadı')),node('p','Veriler bağımsız kayıt deposundan okunur. Arşiv ve D1 koruması korunur. Eksik veri sıfır trafik değildir.'),...(status?.last_failure?[node('p','Son GSC hata kaydı: '+stamp(status.last_failure.at)+' · '+status.last_failure.code)]:[]),...errors.map(e=>node('p',e)),evidence(current.flatMap(r=>r.evidence||[])));
  $('health').textContent='GSC: '+(status?.connected?'Bağlı':'Doğrulanmadı')+' · GA4: '+(ga4Status?.connected?'Bağlı':'Doğrulanmadı')+' · Son kesinleşmiş kayıtlar otomatik okunur.';
  $('connectionSummary').textContent='Search Console ve Google Analytics izinleri birbirinden bağımsızdır. Yenile yalnız ekran kayıtlarını okur.';
  $('google').hidden=!!status?.connected&&!status?.reauthorization_required;
  $('analyticsConnections').hidden=false;$('analyticsConnect').textContent=ga4Status?.connected?'Google Analytics bağlantısını yenile':'Google Analytics’i bağla';
  $('summary').replaceChildren(node('p','Eski doğrulanmış aylık arşivler korunuyor.'));
  if(archive)$('summary').append(detail('Eski aylık arşiv · ayrı kaynak',node('p',(archive.source||'Arşiv')+' · '+archive.month+' · '+stamp(archive.captured_at)+' · '+(archive.stale?'Son doğrulanmış kayıt':'Doğrulanmış kayıt')+'. Günlük GSC yerine kullanılmaz.'),list((archive.products||[]).map(p=>p.title+': '+number(p.metrics?.clicks)+' tarihsel tıklama'))));
 }
 function view(name){
  activeView=name;
  $('export').hidden=['comparison','products','opportunities','impact'].includes(name);
  if(['comparison','products','opportunities','impact'].includes(name)){const at=revision;workspaceModule().then(w=>{if(at===revision&&activeView===name&&!$('app').hidden)return w.render(name);}).catch(e=>notify(e.message));}
  $('scopeLabel').textContent=name==='changes'?'Doğrulanmış tarama aralıkları · UTC':name==='health'?'GSC · GA4 · Arşiv sağlığı':'GSC arama performansı · GA4 ziyaret ölçümleri';
  if(name==='queries')queries();if(name==='radar')radar();if(name==='changes')calendar();if(name==='health'){
   health();const at=revision;historyModule().then(w=>{if(at===revision&&activeView==='health'&&!$('app').hidden)return w.render('health');}).catch(e=>notify(e.message));if(!archive){const at=revision,month=target();read('report?month='+month).then(value=>{if(at===revision){archive=value;health();}}).catch(e=>{if(at===revision)$('summary').textContent='Eski aylık arşiv şu an okunamadı: '+e.message+'. GSC/GA4 ölçümleri ayrı gösteriliyor.';});}
  }
 }
 async function ask(question=$('questionText').value,root=$('answer'),choice=$('questionSource').value){
  const at=revision,button=$('question').querySelector('button[type=submit]');button.disabled=true;root.hidden=false;root.replaceChildren(node('p','Kanıtlar inceleniyor…'));
  try{
   const suffix=device()==='ALL'?'':' '+deviceName(device());
   const result=await api('/api/independent/'+(choice==='gsc'?'gsc-questions':'questions'),{method:'POST',body:JSON.stringify({question:question+suffix,month:target(),include_source_context:true,...(['ga4','archive'].includes(choice)?{source:choice}:{})})});
   if(at!==revision)return;
   const priority=result.evaluation?.review_priority==='Öncelikli'?'Öncelikli incele':result.decision;
   root.replaceChildren(node('h2','Kanıta dayalı yanıt'),badge(priority),node('p',result.answer,'answer-text'),node('p','Dönem: '+result.month+' · Kaynak: '+result.source+'. Soru-cevap seçili bitiş ayını değerlendirir; grafikteki çok aylı aralık yanıt toplamı değildir.'),evidence(result.evidence_refs));
  }catch(e){if(at===revision&&e.name!=='AbortError')root.replaceChildren(node('p',e.message));}finally{button.disabled=false;}
 }
 async function openProduct(p){const at=revision;try{const w=await workspaceModule();if(at===revision&&!$('app').hidden)await w.openProduct(p);}catch(e){notify(e.message);}}
 async function connect(kind){
  try{const data=await api('/api/independent/'+kind+'-oauth/start',{method:'POST'}),url=new URL(data.authorization_url);if(url.origin!=='https://accounts.google.com')throw Error('Güvenli Google adresi doğrulanamadı.');location.assign(url.href);}catch(e){notify(e.message);}
 }
 async function load(signal){
  const at=++revision;if(first){first=false;if(target()>closedMonth())$('month').value=closedMonth();}
  const month=target(),n=Number($('rangeMonths').value),months=Array.from({length:n},(_,i)=>prior(month,n-i-1));
  workspace?.clear();history?.clear();current=[];previous=null;ga4=null;oldGa4=null;status=null;ga4Status=null;planner=null;changes=null;archive=null;catalog=null;errors=[];queryPage=1;
  $('groupFilter').hidden=true;$('groupFilter').value='';$('pilot').hidden=true;$('loadGscReview').closest('section').hidden=true;$('questionSourceLabel').hidden=false;
  $('freshness').replaceChildren(node('span',null,'status-dot'),node('span','Doğrulanmış kaynaklar okunuyor'));
  const jobs=[...months,...(n===1?[prior(month)]:[])],results=[];
  async function worker(){while(jobs.length){const m=jobs.shift();try{results.push(await read('gsc-month?month='+m,signal));}catch(e){if(e.name==='AbortError')throw e;results.push({month:m,available:false,pages:[],queries:[],daily:[],mappings:[],expected_days:new Date(Date.UTC(Number(m.slice(0,4)),Number(m.slice(5)),0)).getUTCDate()});if(at===revision)errors.push(m+' GSC: '+e.message);}}}
  const source=async(path,set)=>{try{const value=await read(path,signal);if(at===revision)set(value);}catch(e){if(e.name==='AbortError')throw e;if(at===revision)errors.push(path.split('?')[0]+': '+e.message);}};
  await Promise.all([worker(),worker(),source('gsc-status',v=>status=v),source('ga4-status',v=>ga4Status=v),source('ga4-report?month='+month,v=>ga4=v),source('ga4-report?month='+prior(month),v=>oldGa4=v),source('change-history?month='+month,v=>changes=v),source('catalog',v=>catalog=v),source('planner-status',v=>planner=v)]);
  if(at!==revision||signal?.aborted)return;
  current=months.map(m=>results.find(r=>r.month===m));previous=n===1?results.find(r=>r.month===prior(month)):null;
  const selected=$('queryProduct').value;$('queryProduct').replaceChildren(new Option('Tüm ürünler',''),...mappings().map(p=>new Option(p.name,p.id)));if(mappings().some(p=>p.id===selected))$('queryProduct').value=selected;
  $('freshness').className='freshness '+(complete()?'good':'wait');$('freshness').replaceChildren(node('span',null,'status-dot'),node('span',complete()?'GSC dönemi doğrulandı':'Kısmi veri · kapsamı incele'));
  $('dataError').hidden=!errors.length;$('dataError').textContent=errors.join(' · ');
  $('coverageText').textContent=coverage();$('dataExplanation').replaceChildren(node('p',coverage()),node('p','GSC tıklaması, GA4 organik oturumu ve tarihli SEO değişikliği ayrı kanıtlardır. Kesin neden doğrulanmadan içerik değişikliği önerilmez.'));
  $('export').hidden=false;$('export').href='#';$('exportLabel').textContent='GSC ölçümlerini indir';
  products();kpis();chart();organic();health();notify();
 }
 function clear(){revision++;workspace?.clear();history?.clear();cache.clear();current=[];previous=null;ga4=null;oldGa4=null;status=null;ga4Status=null;planner=null;changes=null;archive=null;catalog=null;$('organicTable').replaceChildren();$('organicSummary').replaceChildren();}
 $('organicFacet').addEventListener('change',organic);
 for(const [id,delta] of [['queryPrevious',-1],['queryNext',1]])$(id).addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();queries(Math.max(1,Number($('queryPage').dataset.page||queryPage)+delta));},true);
 for(const [id,handler] of [['showChanges',()=>calendar($('changeDay').value)],['runDataAudit',()=>{cache.clear();$('refresh').click();}]])$(id).addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();handler();},true);
 $('analyticsConnect').onclick=()=>connect('ga4');
 $('analyticsProperties').onclick=async()=>{try{const data=await api('/api/independent/ga4-properties');$('analyticsProperty').replaceChildren(...(data.properties||[]).map(p=>new Option(p.name+' ('+p.id+')',p.id)));$('analyticsSelect').hidden=false;}catch(e){notify(e.message);}};
 $('analyticsSelect').onsubmit=async e=>{e.preventDefault();const b=e.currentTarget.querySelector('button');b.disabled=true;try{await api('/api/independent/ga4-property',{method:'POST',body:JSON.stringify({property_id:$('analyticsProperty').value})});cache.clear();$('refresh').click();}catch(e){notify(e.message);}finally{b.disabled=false;}};
 $('export').addEventListener('click',e=>{
  e.preventDefault();const cells=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
  const rows=[['Kaynak','Dönem','Cihaz','Ürün','URL','Tıklama','Gösterim','CTR','Konum','Kapsam'],...productsData().map(p=>['GSC Search Analytics API',target(),device(),p.name,p.canonical_url,p.current?.clicks,p.current?.impressions,p.current?.ctr,p.current?.position,coverage()])];
  const url=URL.createObjectURL(new Blob(['\ufeff'+rows.map(r=>r.map(cells).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'})),a=node('a');a.href=url;a.download='mavi-basim-gsc-'+target()+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 },true);
 return {load,clear,view,products,queries,chart,ask,connect};
}
