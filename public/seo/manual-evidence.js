// User-imported GSC/GA4 evidence stays in this browser's IndexedDB.
// Never sends uploaded data to the Worker, GitHub, or mavibasim.com.
const DATABASE='mavi-basim-private-manual-evidence',STORE='archives';
const $=id=>document.getElementById(id);
const el=(tag,value,css)=>{const n=document.createElement(tag);if(value!==undefined&&value!==null)n.textContent=String(value);if(css)n.className=css;return n;};
const fmt=new Intl.NumberFormat('tr-TR',{maximumFractionDigits:2});
const num=n=>Number.isFinite(n)?fmt.format(n):'—';
const day=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const finite=(n,min=0)=>typeof n==='number'&&Number.isFinite(n)&&n>=min;
function metric(r){return r&&Number.isSafeInteger(r.clicks)&&r.clicks>=0&&Number.isSafeInteger(r.impressions)&&r.impressions>=r.clicks&&finite(r.ctr)&&r.ctr<=1&&finite(r.position);}
function validate(p){
 if(!p||p.format!=='mavi-basim-manual-evidence-v1'||p.property!=='mavibasim.com'||!day(p.period?.start)||!day(p.period?.end)||p.period.start>p.period.end)throw Error('Geçerli Mavi Basım veri paketi değil.');
 const days=Math.round((Date.parse(p.period.end)-Date.parse(p.period.start))/86400000)+1;
 if(days<1||days>400)throw Error('Dönem uzunluğu geçersiz.');
 const g=p.gsc,a=p.ga4,expected=['daily','queries','pages','countries','devices','search_appearance'];
 if(!g||!a||!expected.every(k=>Array.isArray(g[k]))||!Array.isArray(a.channels))throw Error('GSC veya GA4 tabloları eksik.');
 if(g.daily.length!==days||g.daily.length>400||g.queries.length>5000||g.pages.length>5000||g.countries.length>500||g.devices.length>10||g.search_appearance.length>100||a.channels.length>100)throw Error('Veri kapsamı uygun değil.');
 const seen=new Set();
 for(let i=0;i<g.daily.length;i++){const r=g.daily[i];if(!metric(r)||!day(r.day)||r.day!==new Date(Date.parse(p.period.start)+i*86400000).toISOString().slice(0,10))throw Error('GSC günlük kayıtları sıralı ve eksiksiz değil.');}
 for(const k of ['queries','pages','countries','devices','search_appearance']){
  const field={queries:'query',pages:'page',countries:'country',devices:'device',search_appearance:'appearance'}[k];
  seen.clear();
  for(const r of g[k]){
   if(!metric(r)||typeof r[field]!=='string'||!r[field]||r[field].length>2100||seen.has(r[field]))throw Error('GSC '+k+' satırları geçersiz.');
   if(k==='pages'){let u;try{u=new URL(r.page);}catch{throw Error('GSC sayfa URL biçimi geçersiz.');}if(!['mavibasim.com','www.mavibasim.com'].includes(u.hostname)||!['http:','https:'].includes(u.protocol))throw Error('Yabancı alan adı algılandı.');}
   seen.add(r[field]);
  }
 }
 seen.clear();
 for(const r of a.channels){if(typeof r.channel!=='string'||!r.channel||r.channel.length>150||seen.has(r.channel)||!Number.isSafeInteger(r.sessions)||r.sessions<0||!Number.isSafeInteger(r.engaged_sessions)||r.engaged_sessions<0||r.engaged_sessions>r.sessions||!finite(r.engagement_rate)||r.engagement_rate>1)throw Error('GA4 kanal satırı geçersiz.');seen.add(r.channel);}
 const bytes=new Blob([JSON.stringify(p)]).size;if(bytes>8_000_000)throw Error('Dosya boyutu sınırı aşıldı.');
 return p;
}
function db(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DATABASE,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE,{keyPath:'id'});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function transaction(mode,action){const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction(STORE,mode),s=tx.objectStore(STORE),r=action(s);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);tx.oncomplete=()=>d.close();tx.onerror=()=>{d.close();reject(tx.error);};});}
const all=()=>transaction('readonly',s=>s.getAll());
const get=id=>transaction('readonly',s=>s.get(id));
const put=value=>transaction('readwrite',s=>s.add(value));
async function digest(raw){const bytes=new TextEncoder().encode(raw);return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
function saveFile(name,text){const u=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'})),link=el('a');link.href=u;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function td(s){return el('td',s);}
function renderTable(host,head,items){
 const wrap=el('div',null,'table-scroll'),t=el('table'),thead=el('thead'),tr=el('tr');
 for(const h of head)tr.append(el('th',h));thead.append(tr);t.append(thead);
 const body=el('tbody');for(const cells of items){const row=el('tr');for(const cell of cells)row.append(td(cell));body.append(row);}t.append(body);wrap.append(t);host.replaceChildren(wrap);
}
function mount(){
 const host=$('manualEvidencePanel');if(!host)return;
 host.replaceChildren();
 const title=el('h2','GSC + GA4 Manuel Veri Arşivi');
 const note=el('p','Dosya yalnızca bu tarayıcıdaki IndexedDB belleğine kaydedilir. Canlı Google kayıtları, eski SEO sürümleri ve site içeriği değiştirilmez. Google dışa aktarım tablolarındaki 92 günlük toplamlar aylara yapay olarak dağıtılmaz.','source-note');
 const bar=el('div',null,'report-actions');
 const pick=el('input');pick.type='file';pick.accept='.json,application/json';pick.id='manualEvidenceFile';pick.setAttribute('aria-label','ChatGPT veri paketi seç');pick.hidden=true;
 const upload=el('button','GSC + GA4 Veri Dosyasını Yükle','button primary');upload.type='button';upload.id='manualEvidenceUpload';upload.addEventListener('click',()=>pick.click());
 const select=el('select');select.id='manualEvidenceSelect';select.setAttribute('aria-label','Arşiv dönemi seç');
 const exportButton=el('button','Seçili arşivi yedekle','button secondary');exportButton.type='button';
 const status=el('p','Yerel arşiv okunuyor…');status.id='manualEvidenceStatus';status.setAttribute('role','status');
 bar.append(upload,pick,select,exportButton);host.append(title,note,bar,status);
 const stats=el('div',null,'archive-stats'),tabs=el('div',null,'report-actions'),filter=el('input'),results=el('div');
 filter.type='search';filter.placeholder='Sorgu veya URL ara';filter.setAttribute('aria-label','Yerel GSC tablolarında ara');filter.maxLength=200;
 const tabNames=[['pages','Sayfalar'],['queries','Arama sorguları'],['daily','Günlük toplamlar'],['devices','Cihazlar'],['channels','GA4 kanalları']];
 let current=null,tab='pages';
 for(const [key,name]of tabNames){const b=el('button',name,'button secondary');b.type='button';b.addEventListener('click',()=>{tab=key;filter.value='';show();});tabs.append(b);}
 host.append(stats,tabs,filter,results);
 const qa=el('form'),query=el('input'),ask=el('button','Yerel verilere sor','button primary'),reply=el('div');
 query.type='search';query.placeholder='Örnek: broşür, magnet, hangi sorgu, organik trafik';query.maxLength=160;query.setAttribute('aria-label','Yerel arşivle ilgili SEO sorusu');query.required=true;
 ask.type='submit';reply.setAttribute('role','status');qa.append(query,ask);host.append(el('h3','Tayfun · Manuel veri soruları'),qa,reply);
 qa.addEventListener('submit',event=>{
  event.preventDefault();reply.replaceChildren();if(!current){reply.append(el('p','Önce bir veri paketi içe aktarın.'));return;}
  const p=current.payload,q=query.value.toLocaleLowerCase('tr').trim(),box=el('div');
  const organic=p.ga4.channels.find(r=>r.channel==='Organic Search');
  const add=txt=>box.append(el('p',txt));
  add('Kaynak: '+p.period.start+' — '+p.period.end+' · Manuel GSC/GA4 dışa aktarımı; gerçek zamanlı veri değildir.');
  if(/organik|oturum|ga4|analytics|ziyaret/.test(q)){
   add(organic?'GA4 Organic Search: '+num(organic.sessions)+' oturum, '+num(organic.engaged_sessions)+' etkileşimli oturum.':'Bu pakette GA4 organik oturum kaydı yok.');
  }else if(/şehir|ilçe|bölge|il\b/.test(q)){
   add('GA4 şehir kırılımı bu dosyada yok. Şehir bazlı ziyaretçi veya yükseliş sonucu çıkarılamaz.');
  }else{
   const stop=['hangi','sayfa','sorgu','kelime','durumu','kaç','tıklama','performans','nedir','seo','bana','göster','en','çok','ençok','var','mı','ile','için','nasıl','ne','bu','ay','geçen','düştü','yükseldi','sonuç','sonuçları','ürün','ürünün','yaz'];
   const words=q.split(/\s+/).filter(w=>w.length>=3&&!stop.includes(w));
   const matches=(records,field)=>records.filter(r=>words.length&&words.every(w=>r[field].toLocaleLowerCase('tr').includes(w))).sort((a,b)=>b.clicks-a.clicks||b.impressions-a.impressions).slice(0,5);
   let pages=matches(p.gsc.pages,'page'),queries=matches(p.gsc.queries,'query');
   if(!words.length||(!pages.length&&!queries.length)){pages=[...p.gsc.pages].sort((a,b)=>b.clicks-a.clicks).slice(0,5);queries=[...p.gsc.queries].sort((a,b)=>b.clicks-a.clicks).slice(0,5);}
   if(pages.length){add('Dönem boyunca eşleşen sayfalar:');for(const v of pages)add(v.page+' · '+num(v.clicks)+' tıklama · '+num(v.impressions)+' gösterim · '+num(v.position)+' ortalama konum.');}
   if(queries.length){add('Dönem boyunca eşleşen sorgular:');for(const v of queries)add(v.query+' · '+num(v.clicks)+' tıklama · '+num(v.impressions)+' gösterim · '+num(v.position)+' ortalama konum.');}
   add('Bu dışa aktarımdaki sorgu/sayfa satırları tüm dönemi kapsar. Aylık artış, düşüş veya SEO değişikliğinin etkisi bu tek dosyadan kanıtlanamaz.');
  }
  reply.append(box);
 });
 function show(){
  results.replaceChildren();stats.replaceChildren();if(!current)return;
  const p=current.payload,gs=p.gsc,ga=p.ga4;
  const clicks=gs.daily.reduce((n,r)=>n+r.clicks,0),impressions=gs.daily.reduce((n,r)=>n+r.impressions,0);
  const organic=ga.channels.find(r=>r.channel==='Organic Search');
  const heading=el('p','Kaynak dönemi: '+p.period.start+' — '+p.period.end+' · GSC: '+num(clicks)+' tıklama / '+num(impressions)+' gösterim · GA4 organik: '+(organic?num(organic.sessions):'Yok')+' oturum. GA4 ile GSC farklı ölçümlerdir.');
  stats.append(heading);
  const data=tab==='channels'?ga.channels:gs[tab];
  const label={pages:'page',queries:'query',daily:'day',devices:'device',channels:'channel'}[tab];
  const needle=filter.value.trim().toLocaleLowerCase('tr');
  const rows=data.filter(r=>!needle||String(r[label]).toLocaleLowerCase('tr').includes(needle));
  if(rows.length>200)results.append(el('p','İlk 200 kayıt gösteriliyor. Daraltmak için arama kutusunu kullanın.'));
  const displayed=rows.slice(0,200);
  if(tab==='channels')renderTable(results,['Kanal','Oturum','Etkileşimli oturum','Etkileşim oranı'],displayed.map(r=>[r.channel,num(r.sessions),num(r.engaged_sessions),num(100*r.engagement_rate)+'%']));
  else renderTable(results,[tab==='pages'?'Sayfa':tab==='queries'?'Sorgu':tab==='daily'?'Tarih':'Cihaz','Tıklama','Gösterim','TO','Konum'],displayed.map(r=>[r[label],num(r.clicks),num(r.impressions),num(100*r.ctr)+'%',num(r.position)]));
  if(tab==='pages'||tab==='queries')results.append(el('p','Bu satırlar dosyanın tüm dönemine aittir; tek aylık veri olduğu iddia edilmez.','source-note'));
 }
 filter.addEventListener('input',show);
 async function refresh(id){
  const values=(await all()).sort((a,b)=>b.imported_at.localeCompare(a.imported_at));
  select.replaceChildren(...values.map(r=>{const o=el('option',r.period.start+' — '+r.period.end+' · '+r.id.slice(-8));o.value=r.id;return o;}));
  if(id&&values.some(r=>r.id===id))select.value=id;
  current=values.find(r=>r.id===select.value)||null;
  status.textContent=values.length?'Bu tarayıcıda '+values.length+' değiştirilemez arşiv sürümü var. Önemli: Yedekle düğmesini kullanın.':'Henüz yerel arşiv yok. ChatGPT tarafından hazırlanan JSON paketini seçin.';
  show();
 }
 pick.addEventListener('change',async()=>{
  const file=pick.files?.[0];if(!file)return;
  try{
   if(file.size>8_000_000)throw Error('Dosya 8 MB sınırını aşıyor.');
   const raw=await file.text(),p=validate(JSON.parse(raw)),hash=await digest(JSON.stringify(p));
   const id=p.property+'|'+p.period.start+'|'+p.period.end+'|'+hash;
   if(await get(id)){status.textContent='Bu arşiv zaten kayıtlı. Aynı kayıt yeniden yazılmadı.';await refresh(id);return;}
   await put({id,period:p.period,imported_at:new Date().toISOString(),payload:p});
   await refresh(id);status.textContent='Arşiv bu tarayıcıya kaydedildi. Eski tarihler ve sürümler korunuyor.';
  }catch(e){status.textContent='İçe aktarılamadı: '+(e.message||'Geçersiz dosya');}
  finally{pick.value='';}
 });
 select.addEventListener('change',async()=>{current=await get(select.value);show();});
 exportButton.addEventListener('click',()=>{if(!current){status.textContent='Yedeklenecek kayıt yok.';return;}saveFile('mavi-basim-yerel-arsiv-'+current.period.start+'-'+current.period.end+'.json',JSON.stringify(current.payload));});
 refresh().catch(e=>{status.textContent='Tarayıcı yerel arşive erişemiyor: '+e.message;});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
