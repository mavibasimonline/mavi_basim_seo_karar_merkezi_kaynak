const $ = (id) => document.getElementById(id);
const number = (value) => value == null ? 'Veri yok' : new Intl.NumberFormat('tr-TR', {maximumFractionDigits:2}).format(value);
const node = (tag, text, className) => { const e=document.createElement(tag); if(text!=null)e.textContent=text;if(className)e.className=className;return e; };
async function api(path, options={}) { const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers}});const data=response.status===204?null:await response.json();if(!response.ok){if(response.status===401)showLogin();throw new Error(data?.error||'İstek tamamlanamadı.');}return data; }
function showLogin(){ $('login').hidden=false;$('dashboard').hidden=true;$('logout').hidden=true; }
function detail(title,value){const e=node('details');e.append(node('summary',title),node('pre',JSON.stringify(value,null,2)));return e;}
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
    card.append(detail('Kanıt, hesaplama ve eksikler',{period:report.period,previous:report.previous_period,url:p.url,url_verified:p.url_verified,missing:p.missing,calculation:p.calculation,risk:p.risk,evidence:p.evidence}),detail('Cihaz, sorgu ve dönem karşılaştırmaları',{devices:p.devices,queries:p.queries,brand:p.brand,comparisons:p.comparisons}));
    const keywords=node('details');keywords.append(node('summary',`Keyword Planner kaynakları · ${p.keyword_sources} dosya / ${p.keyword_rows} satır`));keywords.addEventListener('toggle',async()=>{if(!keywords.open||keywords.dataset.loaded)return;try{const data=await api('/api/keywords?product='+encodeURIComponent(p.id));keywords.append(node('pre',JSON.stringify(data,null,2)));keywords.dataset.loaded='true';}catch(e){$('message').textContent=e.message;}});card.append(keywords);return card;
  }));
  $('health').textContent=JSON.stringify(status,null,2);$('export').href='/api/export?month='+encodeURIComponent(report.month);
}
async function load(){ $('message').textContent='Veri kapsamı kontrol ediliyor…';try{const month=$('month').value;const [report,status]=await Promise.all([api('/api/report?month='+encodeURIComponent(month)),api('/api/status')]);render(report,status);$('message').textContent='';}catch(e){$('message').textContent=e.message;} }
const last=new Date();last.setUTCDate(1);last.setUTCMonth(last.getUTCMonth()-1);$('month').value=last.toISOString().slice(0,7);$('month').max=new Date().toISOString().slice(0,7);
$('login').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/session',{method:'POST',body:JSON.stringify({token:$('token').value})});$('token').value='';await load();}catch(e){$('message').textContent=e.message;}});
$('refresh').addEventListener('click',load);
$('logout').addEventListener('click',async()=>{try{await api('/api/session',{method:'DELETE'});showLogin();}catch(e){$('message').textContent=e.message;}});
$('question').addEventListener('submit',async e=>{e.preventDefault();const button=e.currentTarget.querySelector('button');button.disabled=true;try{const answer=await api('/api/questions',{method:'POST',body:JSON.stringify({question:$('questionText').value,month:$('month').value})});$('answer').replaceChildren(node('h2','Kanıta dayalı yanıt'),node('p',answer.text),detail('Kaynak, tarih ve ölçüm',answer));$('answer').hidden=false;}catch(e){$('message').textContent=e.message;}finally{button.disabled=false;}});
$('google').addEventListener('click',async()=>{try{const data=await api('/api/oauth/google/start',{method:'POST'});const url=new URL(data.authorization_url);if(url.origin==='https://accounts.google.com')location.assign(url.href);}catch(e){$('message').textContent=e.message;}});
load();
