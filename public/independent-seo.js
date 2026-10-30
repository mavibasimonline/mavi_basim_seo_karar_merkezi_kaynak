const $=id=>document.getElementById(id),month=$('month'),state=$('state'),source=$('source'),products=$('products'),answer=$('answer');
async function request(url,init){const r=await fetch(url,{credentials:'same-origin',...init});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(r.status===401?'Oturum açık değil. Ana panelden giriş yapın.':data.error||data.code||'Veri alınamadı');return data;}
async function load(){state.textContent='Doğrulanıyor';state.className='tag';try{
const current=month.value;const data=await request('/api/independent/report'+(current?'?month='+encodeURIComponent(current):''));
month.replaceChildren();for(const m of data.months||[]){const option=document.createElement('option');option.value=m;option.textContent=m;option.selected=m===data.month;month.appendChild(option);}
state.textContent=data.stale?'Arşiv eski — son doğrulanmış kayıt':'D1 bağımsız · doğrulanmış';
source.textContent='Kaynak: '+data.source+' · Kayıt: '+new Date(data.captured_at).toLocaleString('tr-TR')+' · Eksik kırılımlar hesaplanmaz';
products.replaceChildren();
if(!data.available){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=5;td.textContent=data.message;tr.appendChild(td);products.appendChild(tr);return;}
for(const p of data.products||[]){const tr=document.createElement('tr');for(const value of [p.title,String(p.metrics.clicks),p.previous?String(p.previous.clicks):'Yok',p.delta===null?'—':String(p.delta),p.decision]){const td=document.createElement('td');td.textContent=value;tr.appendChild(td);}products.appendChild(tr);}
}catch(e){state.textContent='Kaynak kullanılamıyor';state.className='tag error';source.textContent=String(e.message||e);}}
$('reload').addEventListener('click',load);
$('ask').addEventListener('submit',async e=>{e.preventDefault();answer.textContent='Kanıtlar inceleniyor';try{const data=await request('/api/independent/questions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:$('question').value,month:month.value})});answer.textContent=data.answer+'\nKarar: '+data.decision+' · Kanıt: '+(data.evidence||[]).join(', ')+' · D1 istekleri: '+data.d1_requests;}catch(error){answer.textContent=String(error.message||error);}});
load();