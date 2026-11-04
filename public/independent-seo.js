const $=id=>document.getElementById(id),month=$('month'),state=$('state'),source=$('source'),products=$('products'),answer=$('answer');
const numbers=new Intl.NumberFormat('tr-TR',{maximumFractionDigits:2});
const facets={products:'Ürün',pages:'Sayfa',queries:'Görünür sorgu',devices:'Cihaz',countries:'Ülke'};
const deviceNames={MOBILE:'Mobil',DESKTOP:'Masaüstü',TABLET:'Tablet'};
let monthlyGsc=null,loadVersion=0;
const text=(id,value)=>{$(id).textContent=value;};
const numeric=value=>typeof value==='number'&&Number.isFinite(value)?numbers.format(value):'—';
function dateTime(value){const date=new Date(value);return value&&Number.isFinite(date.getTime())?date.toLocaleString('tr-TR',{timeZone:'Europe/Istanbul'}):'Tarih doğrulanamadı';}
function lastClosedMonth(){const date=new Date(Date.now()-3*86400000);date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()-1);return date.toISOString().slice(0,7);}
function setMonths(extra=[],selected=month.value||lastClosedMonth()){
 const choices=new Set([selected,...extra.filter(m=>typeof m==='string'&&/^20\d\d-(0[1-9]|1[0-2])$/.test(m))]);
 const latest=new Date(lastClosedMonth()+'-01T00:00:00Z');
 for(let i=0;i<12;i++){const day=new Date(latest);day.setUTCMonth(day.getUTCMonth()-i);choices.add(day.toISOString().slice(0,7));}
 month.replaceChildren();
 for(const value of [...choices].sort().reverse()){
  const option=document.createElement('option');option.value=value;
  option.textContent=new Date(value+'-01T00:00:00Z').toLocaleDateString('tr-TR',{month:'long',year:'numeric',timeZone:'UTC'});
  option.selected=value===selected;month.appendChild(option);
 }
}
async function request(url,init){
 const response=await fetch(url,{credentials:'same-origin',...init}),data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(response.status===401?'Oturum açık değil. Ana panelden giriş yapın.':data.error||data.code||'Veri alınamadı');
 return data;
}
function emptyRow(tbody,message){tbody.replaceChildren();const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=5;cell.textContent=message;row.appendChild(cell);tbody.appendChild(row);}
function showArchive(data,target){
 setMonths(data.months||[],target);state.textContent=data.stale?'Aylık arşiv · son doğrulanmış kayıt':'Aylık arşiv doğrulandı';state.className='tag';
 source.textContent='Kaynak: '+(data.source||'Doğrulanmış aylık arşiv')+' · Kayıt: '+dateTime(data.captured_at)+' · Dönem: '+(data.month||target);
 products.replaceChildren();
 if(!data.available){emptyRow(products,data.message||'Bu dönem için doğrulanmış aylık arşiv yok. Eksik kayıt sıfır trafik değildir.');return;}
 for(const product of data.products||[]){
  const row=document.createElement('tr');
  for(const value of [product.title,numeric(product.metrics?.clicks),product.previous?numeric(product.previous.clicks):'Yok',product.delta===null?'—':numeric(product.delta),product.decision]){
   const cell=document.createElement('td');cell.textContent=value??'—';row.appendChild(cell);
  }
  products.appendChild(row);
 }
 if(!products.children.length)emptyRow(products,'Bu dönemde doğrulanmış ürün kaydı bulunamadı.');
}
function scopeName(scope){return scope==='page'?'sayfa':scope==='query'?'görünür sorgu':'kapsam belirtilmedi';}
function failureDescription(code){
 const descriptions={GSC_ROW_REJECTED:'Kaynak satırı doğrulamayı geçemedi.',GSC_DUPLICATE_ROW:'Kaynakta yinelenen kayıt bulundu.',GSC_HTTP_400:'Google veri isteğini kabul etmedi.',GSC_HTTP_401:'Google erişimi doğrulanamadı.',GSC_HTTP_403:'Google erişim izni doğrulanamadı.',GSC_HTTP_429:'Google istek sınırı nedeniyle toplama ertelendi.',GSC_OAUTH_RECONNECT_REQUIRED:'Google bağlantısı yenilenmeli.',GSC_RETRY_BACKOFF:'Yeni deneme için bekleniyor.',GSC_STORAGE_DAILY_LIMIT:'Günlük saklama sınırı nedeniyle toplama ertelendi.',GSC_STORAGE_TOTAL_LIMIT:'Saklama sınırı nedeniyle toplama durakladı.',GSC_NETWORK_TIMEOUT:'Google yanıtı zamanında alınamadı.'};
 return descriptions[code]||'Toplama denemesi tamamlanamadı.';
}
function showStatus(status){
 const coverage=Array.isArray(status.coverage)?status.coverage:[],unique=new Set(coverage.filter(r=>r&&/^20\d\d-\d\d-\d\d$/.test(r.day)&&['page','query'].includes(r.scope)).map(r=>r.day+':'+r.scope));
 text('daily-coverage','Günlük kapsam: '+unique.size+'/14 kayıt');
 const connected=status.connected===true,reconnect=status.reauthorization_required===true;
 text('gsc-note',(reconnect?'Google bağlantısı yenilenmeli.':connected?'Google bağlantısı kayıtlı.':'Google bağlantısı gerekli.')+' Son 7 sonuçlanmış gün için sayfa ve görünür sorgu kayıtları izlenir. Eksik günler sıfır trafik değildir. Sorgular anonimleştirme nedeniyle eksik olabilir.');
 $('reconnect').hidden=connected&&!reconnect;
 const failure=status.last_failure||(status.last_attempt?.code?status.last_attempt:null);
 text('gsc-failure',failure?'Son hata: '+dateTime(failure.at)+' · '+failureDescription(failure.code)+' '+(failure.code||'')+(failure.day?' · '+failure.day+' / '+scopeName(failure.scope):''):'Son hata kaydı yok; bu bilgi geçmişte hiç hata olmadığı anlamına gelmez.');
 const complete=status.last_complete;
 text('gsc-complete',complete?'Son tamamlanan toplama: '+dateTime(complete.at)+' · '+(complete.day||'Gün belirtilmedi')+' / '+scopeName(complete.scope)+' · '+numeric(complete.rows)+' kayıt.':'Tamamlanan günlük toplama kaydı henüz doğrulanmadı.');
 const last=status.cron?.last,states={complete:'toplama tamamlandı',partial:'toplama sürüyor',held:'toplama ertelendi',idle:'yeni kayıt bekleniyor'};
 const days=Array.isArray(status.cron?.days)?status.cron.days.filter(d=>d&&d.attempts>0&&typeof d.day==='string'):[];
 text('gsc-cron',last?'Son otomatik çalışma: '+dateTime(last.scheduled_at)+' · '+(states[last.status]||'sonuç doğrulanamadı')+'. '+(days.length>1?'Farklı günlerde çalışma kayıtları: '+days.map(d=>d.day).join(', ')+'.':'Ertesi gün yeniden çalışma kaydı henüz yok.'):'Otomatik çalışma sonucu henüz doğrulanmadı. Önceki kaydın bulunmaması bir hata kanıtı değildir.');
}
function renderEvidence(list,records,fallback=[]){
 list.replaceChildren();
 const refs=Array.isArray(records)?records:[];
 if(refs.length){
  for(const record of refs){
   const item=document.createElement('li');
   const hashes=Array.isArray(record.page_hashes)?record.page_hashes:[];
   item.textContent=(record.day||'Gün belirtilmedi')+' · '+scopeName(record.scope)+' · '+numeric(record.rows)+' kayıt · '+dateTime(record.captured_at)+' · Kaynak: gsc:history:'+record.day+':'+record.scope+':'+record.generation+(hashes.length?' · İçerik özeti: '+hashes.slice(0,3).join(', ')+(hashes.length>3?' (+'+(hashes.length-3)+' doğrulama özeti)':''):'');
   list.appendChild(item);
  }
 }else for(const value of Array.isArray(fallback)?fallback:[]){const item=document.createElement('li');item.textContent=String(value);list.appendChild(item);}
 if(!list.children.length){const item=document.createElement('li');item.textContent='Bu sonuç için doğrulanmış kaynak referansı yok.';list.appendChild(item);}
}
function showFacet(){
 const type=$('gsc-facet').value,body=$('gsc-rows');text('gsc-dimension',facets[type]||'Kırılım');
 if(!monthlyGsc){emptyRow(body,'Günlük kaynak sonucu şu anda doğrulanamadı.');return;}
 const rows=Array.isArray(monthlyGsc[type])?monthlyGsc[type]:[];
 text('gsc-table-caption',monthlyGsc.available?'Doğrulanmış günlük kayıtlarda gözlenen değerler':'Kısmi günlük kapsam · yalnızca doğrulanmış kayıtlarda gözlenenler');
 body.replaceChildren();
 for(const observation of rows){
  const row=document.createElement('tr'),label=type==='devices'?(deviceNames[observation.id]||observation.label||observation.id):(observation.label||observation.id);
  const values=[label,numeric(observation.clicks),numeric(observation.impressions),typeof observation.ctr==='number'&&Number.isFinite(observation.ctr)?'%'+numeric(observation.ctr*100):'—',numeric(observation.position)];
  for(const value of values){const cell=document.createElement('td');cell.textContent=value??'—';row.appendChild(cell);}body.appendChild(row);
 }
 if(!rows.length)emptyRow(body,type==='products'?'Doğrulanmış sayfa–ürün eşlemesiyle sonuç bulunamadı. Sayfa kırılımını kullanın.':'Bu kırılımda doğrulanmış kayıt yok; sıfır trafik anlamına gelmez.');
 if(type==='queries')$('gsc-table-caption').textContent+=' · Görünür sorgular site toplamı değildir.';
}
function showAnalysis(data,target){
 monthlyGsc=data;const coverage=data.coverage||{},pages=numeric(coverage.days_verified),expected=numeric(coverage.expected_days),queries=numeric(coverage.query_days_verified);
 text('gsc-month-note',(data.month||target)+' · Günlük sayfa kapsamı '+pages+'/'+expected+' gün; görünür sorgu kaydı '+queries+'/'+expected+' gün. '+(data.available?'Sayfa günlerinin tamamı içerik doğrulamasından geçti.':'Ayın tamamı doğrulanmadı. Eksik günler sıfır trafik değildir; aylık toplam hesaplanmadı.')+' Sorgu kapsamı anonimleştirme nedeniyle kısmi kalabilir.');
 renderEvidence($('gsc-evidence'),data.evidence);showFacet();
}
async function load(){
 const version=++loadVersion,target=month.value||lastClosedMonth(),fresh=()=>version===loadVersion;
 $('reload').disabled=true;state.textContent='Aylık arşiv kontrol ediliyor';state.className='tag';
 source.textContent=target+' dönemi için arşiv kaynağı kontrol ediliyor.';
 emptyRow(products,'Seçilen dönemin aylık arşivi kontrol ediliyor.');
 monthlyGsc=null;showFacet();text('gsc-month-note',target+' dönemi için günlük kaynaklar inceleniyor.');$('gsc-evidence').replaceChildren();
 answer.textContent='';$('answer-evidence').replaceChildren();
 const archive=request('/api/independent/report?month='+encodeURIComponent(target)).then(data=>{if(fresh())showArchive(data,target);}).catch(error=>{
  if(!fresh())return;state.textContent='Aylık arşiv kullanılamıyor';state.className='tag error';source.textContent=String(error.message||'Aylık kaynak alınamadı.');emptyRow(products,'Aylık arşiv sonucu doğrulanamadı. Günlük GSC kanıtları ayrıca kontrol edilir.');
 });
 const status=request('/api/independent/gsc-status').then(data=>{if(fresh())showStatus(data);}).catch(error=>{
  if(!fresh())return;text('daily-coverage','Günlük kapsam doğrulanamadı');text('gsc-note',String(error.message||'Google bağlantı durumu alınamadı.'));text('gsc-failure','Son hata kaydı doğrulanamadı.');text('gsc-complete','Son toplama sonucu doğrulanamadı.');text('gsc-cron','Otomatik çalışma kaydı doğrulanamadı.');$('reconnect').hidden=true;
 });
 const analysis=request('/api/independent/gsc-analysis?month='+encodeURIComponent(target)).then(data=>{if(fresh())showAnalysis(data,target);}).catch(error=>{
  if(!fresh())return;monthlyGsc=null;text('gsc-month-note','Seçilen dönemin günlük kanıtları doğrulanamadı: '+String(error.message||'Veri alınamadı.'));renderEvidence($('gsc-evidence'),[]);showFacet();
 });
 await Promise.allSettled([archive,status,analysis]);if(fresh())$('reload').disabled=false;
}
$('reload').addEventListener('click',load);month.addEventListener('change',load);$('gsc-facet').addEventListener('change',showFacet);
$('reconnect').addEventListener('click',async()=>{
 const button=$('reconnect');button.disabled=true;
 try{const data=await request('/api/independent/gsc-oauth/start',{method:'POST'}),destination=new URL(data.authorization_url);if(destination.origin!=='https://accounts.google.com')throw Error('Güvenli Google yetki adresi doğrulanamadı.');location.assign(destination.href);}
 catch(error){text('gsc-note',String(error.message||error));button.disabled=false;}
});
$('ask').addEventListener('submit',async event=>{
 event.preventDefault();const version=loadVersion,askedMonth=month.value;answer.textContent='Kanıtlar inceleniyor';$('answer-evidence').replaceChildren();const button=$('ask').querySelector('button[type="submit"]');button.disabled=true;
 try{const choice=$('question-source').value,body={question:$('question').value,month:month.value,...(choice==='archive'?{source:'archive'}:{})};
  const data=await request('/api/independent/'+(choice==='gsc'?'gsc-questions':'questions'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(version!==loadVersion)return;
  answer.textContent=data.answer+'\nDönem: '+(data.month||askedMonth)+' · Karar: '+data.decision+(data.source?' · Kaynak: '+data.source:'');renderEvidence($('answer-evidence'),data.evidence_refs,data.evidence);
 }catch(error){if(version===loadVersion)answer.textContent=String(error.message||error);}finally{button.disabled=false;}
});
setMonths();load();
