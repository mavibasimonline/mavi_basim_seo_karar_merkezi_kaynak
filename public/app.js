const $ = (id) => document.getElementById(id);
const number = (value) => value == null ? 'Veri yok' : new Intl.NumberFormat('tr-TR', {maximumFractionDigits:2}).format(value);
const node = (tag, text, className) => { const e=document.createElement(tag); if(text!=null)e.textContent=text;if(className)e.className=className;return e; };
async function api(path, options={}) { const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers}});const data=response.status===204?null:await response.json();if(!response.ok){if(response.status===401)showLogin();throw new Error(data?.error||'İstek tamamlanamadı.');}return data; }
function showLogin(){ $('login').hidden=false;$('dashboard').hidden=true;$('logout').hidden=true; }
function detail(title,...contents){const e=node('details');e.append(node('summary',title),...contents);return e;}
const list=(values)=>{const ul=node('ul');values.forEach(value=>ul.append(node('li',value)));return ul;};
const deviceName=(value)=>({MOBILE:'Mobil',DESKTOP:'Masaüstü',TABLET:'Tablet'}[value]||value);
function evidenceView(p,report){
  return detail('Kanıt, hesaplama ve eksikler',
    node('p',`Dönem: ${report.period.start} – ${report.period.end}. Karşılaştırma: ${report.previous_period.start} – ${report.previous_period.end}. Ölçüm: ${report.created_at}.`),
    node('p',`Kanıt güveni: ${p.confidence}. Sayfa eşlemesi canlı taramada doğrulandı: ${p.url_verified?'Evet':'Hayır'}.`),
    node('p',p.risk),
    node('p',p.current&&p.previous?`Tıklama farkı: ${number(p.current.clicks-p.previous.clicks)}. Gösterim farkı: ${number(p.current.impressions-p.previous.impressions)}. CTR: toplam tıklama / toplam gösterim. Ortalama konum, gösterimlerle ağırlıklandırılır.`:'Hesaplama için iki dönemin de doğrulanmış ölçümleri gerekli.'),
    list(p.missing.length?p.missing:['Gerekli günlük kapsam mevcut. Mevsimsellik ve nedensellik ayrıca incelenmelidir.']),
    node('p',p.evidence.length?`Kaynak: Search Console. ${p.evidence.length} günlük veri kümesi. Filtre: bu ürünün kanonik sayfası, web araması; sorgu, ülke ve cihaz ayrı boyutlardır. Sorgular anonimleştirme nedeniyle eksik olabilir.`:'Search Console kaynak kanıtı yok.'),
    list(p.evidence.slice(-3).map(e=>`Kaynak kaydı: ${e.ref}. Alınma zamanı: ${e.fetched_at}.`)));
}
function performanceView(p){
  const parts=[...p.devices.map(d=>node('p',`${deviceName(d.device)} · ${d.decision}: ${number(d.current?.clicks)} tıklama (önceki: ${number(d.previous?.clicks)}). ${d.reason}`)),
    node('p',`Görünür marka sorgusu tıklamaları: ${number(p.brand.brand?.clicks)}; markasız: ${number(p.brand.non_brand?.clicks)}. ${p.brand.note}`),
    node('p','Kelime koruma denetimi'),list(p.queries.slice(0,20).map(q=>`${q.query}: ${number(q.clicks)} tıklama; önceki ${number(q.previous_clicks)}.${q.protect?' Koru: başlık/URL değişikliğinde zarar riski.':''}${q.missing_current?' Güncel sorgu kaydı eksik; sıfır sayılmadı.':''}`)),
    ...Object.entries(p.comparisons).map(([key,value])=>node('p',`${key==='year_over_year'?'Geçen yılın aynı dönemi':key.replace('_months',' aylık geçmiş')}: ${value.complete?'doğrulanmış kapsam var':'veri kapsamı eksik; karşılaştırma yapılmadı'}.`))];
  return detail('Cihaz, sorgu ve dönem karşılaştırmaları',...parts);
}
function answerView(answer){
  const parts=[node('p',`Kaynak: ${answer.source}. Ölçüm: ${answer.measured_at}. Dönem: ${answer.period.start} – ${answer.period.end}.`),node('p',`Sayfa: ${answer.url||'Bu soru için doğrulanmış sayfa ölçümü yok'}. Cihaz: ${deviceName(answer.device)||'Soru kapsamı'}.`),
    node('p',`Tıklama: ${number(answer.current?.clicks)}; önceki dönem: ${number(answer.previous?.clicks)}.`),list(answer.missing||[]),list(answer.limitations||[])];
  if(answer.products)parts.push(list(answer.products.map(p=>`${p.name}: ${p.queries.map(q=>q.query).join(', ')||'Mevcut çalışma korunmalı'}. ${p.risk}`)));
  if(answer.rows)parts.push(list(answer.rows.map(r=>`${r.city} / ${r.device}: ${number(r.sessions)} organik oturum.`)));
  return detail('Kaynak, tarih ve ölçüm',...parts);
}
function render(report,status){
  $('login').hidden=true;$('dashboard').hidden=false;$('logout').hidden=false;
  $('status').textContent=report.missing.length?report.missing.join(' '):`Rapor doğrulandı. Ölçüm: ${report.created_at}. Veriler gözlemseldir; kesin neden açıklamaz.`;
  $('summary').replaceChildren(...[['Kaynak dosya',report.sources.csv_files],['Kaynak satır',report.sources.csv_rows],['Ürün',report.products.length]].map(([label,value])=>{const e=node('div',null,'stat');e.append(node('strong',number(value)),node('span',label));return e;}));
  const priorities=report.products.filter(p=>p.decision==='İncele'||p.decision==='İyileştir').slice(0,3);
  $('priorities').replaceChildren(...(priorities.length?priorities.map(p=>node('p',`${p.name}: ${p.reason}`)):[node('p','Kanıtla desteklenen öncelikli SEO değişikliği yok. Eksik veride mevcut çalışmayı koruyun.')]));
  $('protect').textContent='Dokunma listesi: '+(report.products.filter(p=>p.decision==='Koru').map(p=>p.name).join(', ')||'Başarılı kelimeleri doğrulamak için yeterli Google verisi yok.');
  $('products').replaceChildren(...report.products.map(p=>{
    const card=node('article',null,'product');const top=node('div',null,'product-top');top.append(node('h3',p.name),node('span',p.decision,'badge '+(p.decision==='Koru'?'koru':p.decision==='İncele'?'incele':'')));card.append(top,node('p',p.group_name));
    const m=node('div',null,'metrics');for(const [label,value] of [['Tıklama',p.current?.clicks],['Gösterim',p.current?.impressions],['Önceki tıklama',p.previous?.clicks]]){const e=node('div');e.append(node('strong',number(value)),node('span',label));m.append(e);}card.append(m,node('p',p.reason));
    if(p.url){const a=node('a',p.url);a.href=p.url;a.rel='noopener noreferrer';a.target='_blank';card.append(a);}else card.append(node('p','Sayfa URL eşlemesi henüz doğrulanmadı.'));
    card.append(evidenceView(p,report),performanceView(p));
    if(p.url){const history=node('details');history.append(node('summary','SEO değişiklik geçmişi'));history.addEventListener('toggle',async()=>{if(!history.open||history.dataset.loaded)return;try{const data=await api('/api/history?url='+encodeURIComponent(p.url));history.append(node('p',data.note),...data.rows.map(row=>{const changes=JSON.parse(row.diff_json);return node('p',`Tespit aralığı: ${row.observed_from} – ${row.observed_to}. Kesin yayın tarihi: ${row.published_at||'bilinmiyor'}. ${Object.entries(changes).map(([field,value])=>`${({title:'Başlık',description:'Meta açıklama',body_hash:'İçerik özeti',canonical:'Kanonik URL',robots:'Robots',status:'HTTP durumu',headings:'Başlık hiyerarşisi',links:'İç bağlantılar'}[field]||'Sayfa öğesi')}: ${JSON.stringify(value.old)} → ${JSON.stringify(value.new)}`).join(' · ')}`);}));if(!data.rows.length)history.append(node('p','Doğrulanmış tarama değişikliği yok.'));history.dataset.loaded='true';}catch(e){$('message').textContent=e.message;}});card.append(history);}
    const keywords=node('details');keywords.append(node('summary',`Keyword Planner kaynakları · ${p.keyword_sources} dosya / ${p.keyword_rows} satır`));keywords.addEventListener('toggle',async()=>{if(!keywords.open||keywords.dataset.loaded)return;try{const data=await api('/api/keywords?product='+encodeURIComponent(p.id));keywords.append(list(data.notes));const sources=node('div',null,'source-list');sources.append(...data.rows.map(r=>node('p',`${r.keyword} · Yaklaşık aylık arama: ${number(r.avg_monthly_searches)}. Kaynak: ${r.path}, satır ${r.row_number}. Dışa aktarım: ${r.exported_at}. Kapsam: ${r.period_label}.`)));keywords.append(sources);if(data.next)keywords.append(node('p','İlk 50 kelimenin son gözlemi gösteriliyor. Tam kaynak arşivi veritabanında korunur.'));keywords.dataset.loaded='true';}catch(e){$('message').textContent=e.message;}});card.append(keywords);return card;
  }));
  $('health').textContent=[`Google izni: ${status.google_connected?'kayıtlı (API sağlığını ayrıca kontrol edin)':'bağlı değil'}`,`GA4 ayarı: ${status.ga4_configured?'var':'yok'}`,`Site taraması: ${status.crawl_enabled?'etkin':'etkin değil'}`,...status.health.map(h=>`${h.provider} · ${h.day} · ${h.status} ${h.code||''}`),...status.coverage.map(c=>`${c.provider}: ${c.earliest} – ${c.latest}, ${c.days} doğrulanmış gün.`),status.note].join('\n');$('export').href='/api/export?month='+encodeURIComponent(report.month);
}
async function load(){ $('message').textContent='Veri kapsamı kontrol ediliyor…';try{const month=$('month').value;const [report,status]=await Promise.all([api('/api/report?month='+encodeURIComponent(month)),api('/api/status')]);render(report,status);$('message').textContent='';}catch(e){$('message').textContent=e.message;} }
const last=new Date();last.setUTCDate(1);last.setUTCMonth(last.getUTCMonth()-1);$('month').value=last.toISOString().slice(0,7);$('month').max=new Date().toISOString().slice(0,7);
$('login').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/session',{method:'POST',body:JSON.stringify({token:$('token').value})});$('token').value='';await load();}catch(e){$('message').textContent=e.message;}});
$('refresh').addEventListener('click',load);
$('logout').addEventListener('click',async()=>{try{await api('/api/session',{method:'DELETE'});showLogin();}catch(e){$('message').textContent=e.message;}});
$('question').addEventListener('submit',async e=>{e.preventDefault();const button=e.currentTarget.querySelector('button');button.disabled=true;try{const answer=await api('/api/questions',{method:'POST',body:JSON.stringify({question:$('questionText').value,month:$('month').value})});$('answer').replaceChildren(node('h2','Kanıta dayalı yanıt'),node('p',answer.text),answerView(answer));$('answer').hidden=false;}catch(e){$('message').textContent=e.message;}finally{button.disabled=false;}});
$('google').addEventListener('click',async()=>{try{const data=await api('/api/oauth/google/start',{method:'POST'});const url=new URL(data.authorization_url);if(url.origin==='https://accounts.google.com')location.assign(url.href);}catch(e){$('message').textContent=e.message;}});
load();
