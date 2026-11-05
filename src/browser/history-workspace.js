// One history workspace, mounted in the existing calendar and data health views.
import {$,node,number,percent,siteLink,detail,badge} from '../../public/ui.js';
import {drawChart} from '../../public/chart.js';
import {table,cell,sortableChart} from '../../public/seo/tables.js';
const labels={title:'Title',description:'Meta description',headings:'Başlıklar / H1–H6',canonical:'Canonical',body_hash:'İçerik hash',excerpt:'Kayıtlı içerik özeti',links:'Bağlantılar',status:'HTTP durumu',robots:'Robots',redirect:'Yönlendirme',x_robots:'X-Robots',hreflang:'Hreflang',images:'Görseller',structured_data:'Yapılandırılmış veri',viewport:'Viewport',lang:'Dil',rendering:'Tarama türü'};
const stamp=s=>s?new Date(s).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul'})+' (TSİ)':'Kaynakta yok';
const button=(text,run)=>{const b=node('button',text,'button secondary');b.type='button';b.onclick=run;return b;};
const show=v=>v===null||v===undefined?'Kaynakta yok / veri bekle':typeof v==='string'?(v||'Boş değer (kayıtlı)'):JSON.stringify(v,null,2);
const signed=v=>v===null||v===undefined?'Veri bekle':(v>0?'+':'')+number(v);
export function createHistoryWorkspace({scope,read,notify,evidence}){
 let epoch=0,detailEpoch=0;const surfaces=new Map();
 const health=node('section',null,'panel');health.id='historyHealth';$('view-health').insertBefore(health,$('summary'));
 const css=node('link');css.rel='stylesheet';css.href='/seo/history.css';document.head.append(css);
 function statusBlock(value){const block=node('div',null,'history-status');block.append(node('h3','SEO geçmişinin arşiv kapsamı'),node('p',number(value.events)+' değişiklik · '+number(value.snapshots)+' tarama sürümü · '+(value.caught_up?'Kaynakta son kontrol sırasında bulunan kayıtlar aktarıldı.':'Aktarım sürüyor / veri bekle. Tam geçmiş henüz doğrulanmadı.')),node('p','Kaynak: seo_change_events + seo_snapshots · Son aktarım: '+stamp(value.captured_at)),node('p','Kayıt aralığı: '+stamp(value.earliest)+' — '+stamp(value.latest)),node('p','İmleç: olay '+value.events_after+' / tarama '+value.snapshots_after+'. Her sayfa ayrı doğrulanır; panel okumaları D1 kullanmaz.'));
  if(value.held)block.append(node('p','Aktarım bekliyor: '+value.held.code+(value.held.reason?' · '+value.held.reason:'')+'. Mevcut arşiv korunur.','history-warning'));
  block.append(node('p','Son doğal görev: '+stamp(value.last_natural?.scheduled_at)+'. İlk kayıttan önceki geçmiş bilinmiyor; kayıt yokluğu değişiklik yapılmadığını kanıtlamaz.'));return block;
 }
 function create(name){const root=name==='changes'?$('changeResults'):health,form=node('form',null,'history-controls'),fields={};
  const add=(key,title,el)=>{const label=node('label',title);el.id='history-'+name+'-'+key;label.append(el);form.append(label);fields[key]=el;return el;};
  const kind=add('kind','Kayıt türü',node('select'));kind.append(new Option('SEO değişiklikleri','event'),new Option('Bütün tarama sürümleri','snapshot'));
  add('product','Ürün',node('select'));const url=add('url','Doğrulanmış tam URL',node('input'));url.type='url';url.placeholder='https://mavibasim.com/...';
  for(const [key,title]of[['from','Başlangıç günü (TSİ)'],['to','Bitiş günü (TSİ)']])add(key,title,node('input')).type='date';
  const type=add('type','Değişiklik türü',node('select'));type.append(new Option('Bütün alanlar',''),...Object.entries(labels).map(([key,label])=>new Option(label,key)));
  const actions=node('div',null,'history-actions'),submit=node('button','Geçmişi göster','button primary');submit.type='submit';actions.append(submit,button('Filtreleri temizle',()=>{for(const [key,el]of Object.entries(fields))el.value=key==='kind'?'event':'';state.cursors=[];state.cursor='';kind.onchange();load(state);}));form.append(actions);
  const coverage=node('div'),note=node('p',null,'source-note'),results=node('div'),paging=node('div',null,'history-actions');results.setAttribute('aria-live','polite');
  root.replaceChildren(node('h2','Gerçek SEO değişiklik geçmişi'),form,coverage,note,results,paging);
  const state={name,root,form,fields,coverage,note,results,paging,cursors:[],cursor:'',request:0,catalogRevision:-1};
  form.onsubmit=e=>{e.preventDefault();state.cursor='';state.cursors=[];load(state);};kind.onchange=()=>{type.disabled=kind.value==='snapshot';if(type.disabled)type.value='';};surfaces.set(name,state);return state;
 }
 async function load(state){const at=++state.request,revision=scope().revision,startEpoch=epoch;state.results.textContent='Doğrulanmış arşiv sayfası okunuyor…';state.form.setAttribute('aria-busy','true');state.paging.replaceChildren();
  try{const values=Object.fromEntries(Object.entries(state.fields).map(([key,el])=>[key,el.value]));if(values.from&&values.to&&values.from>values.to)throw Error('Başlangıç günü bitiş gününden sonra olamaz.');
   if(values.url){const u=new URL(values.url);if(!['https:','http:'].includes(u.protocol)||!['mavibasim.com','www.mavibasim.com'].includes(u.hostname)||u.username||u.password||u.port)throw Error('Yalnız mavibasim.com tam URL’siyle filtreleyin.');}
   const query=new URLSearchParams(Object.entries({...values,...(state.cursor?{cursor:state.cursor}:{})}).filter(([,v])=>v));
   const data=await read('seo-history?'+query);if(at!==state.request||revision!==scope().revision||startEpoch!==epoch)return;
   state.coverage.replaceChildren(statusBlock(data.coverage));state.note.textContent=Object.entries(values).filter(([,v])=>v).map(([key,v])=>key+': '+v).join(' · ')+' · Tarama aralığı TSİ takvim günleriyle süzülür. Kayıtlar sonraki tarama zamanına göre yeniden eskiye sıralıdır.';
   state.results.replaceChildren();if(!data.items.length)state.results.append(node('p',data.message));
   for(const row of data.items){const card=node('article',null,'history-record'),title=values.kind==='snapshot'?stamp(row.observed_at):stamp(row.observed_to);card.append(node('h3',title),node('p',row.url));
    if(values.kind==='event'){card.append(node('p','Önceki tarama: '+stamp(row.observed_from)+' · Sonraki tarama: '+stamp(row.observed_to)),node('p',row.publication_evidence?'Kanıtlı yayın: '+stamp(row.published_at)+' · '+row.publication_evidence.source+' · '+row.publication_evidence.ref:'Gerçek yayın tarihi kanıtlanmadı. Tarih, iki tarama arasındaki gözlem aralığıdır.'),node('p',row.changed_fields.map(f=>labels[f]||f).join(' · ')||'Kaynakta değişen alan listesi bulunmuyor'));}
    const actions=node('div',null,'history-actions');actions.append(button(values.kind==='event'?'Eski / yeni ve GSC sonucu':'Tarama kaydını aç',()=>open(row,values.kind)),siteLink(row.url,'Satış sayfasını aç'));card.append(actions,node('small','Kayıt: '+row.id+' · SHA-256 '+row.record_hash));state.results.append(card);}
   const previous=button('Önceki sayfa',()=>{state.cursor=state.cursors.pop()||'';load(state);});previous.disabled=!state.cursors.length;
   const next=button('Sonraki sayfa',()=>{state.cursors.push(state.cursor);state.cursor=data.next_cursor;load(state);});next.disabled=!data.next_cursor;
   state.paging.append(previous,node('span',(state.cursors.length+1)+'. sayfa · '+data.items.length+' kayıt · '+data.scanned+' aday kontrol edildi'),next);
  }catch(error){if(at===state.request&&startEpoch===epoch)state.results.replaceChildren(node('p',error.message+' Mevcut kayıtlar silinmedi.'));}finally{if(at===state.request)state.form.removeAttribute('aria-busy');}
 }
 function fieldTable(before,after){const target=node('div',null,'table-scroll');table(target,['Kanıt alanı','Önceki kayıt','Sonraki kayıt'],Object.entries(labels).filter(([key])=>['title','description','headings','canonical','body_hash','excerpt','links','status'].includes(key)).map(([key,label])=>{const old=key==='headings'&&Array.isArray(before?.[key])?before[key].filter(h=>h.level===1):before?.[key],next=key==='headings'&&Array.isArray(after?.[key])?after[key].filter(h=>h.level===1):after?.[key];return [key==='headings'?'H1':label,node('pre',show(old)),node('pre',show(next))];}),{initialSort:0});return target;}
 async function open(row,kind){const at=++detailEpoch,revision=scope().revision,dialog=$('productDialog'),root=$('productDetail');$('dialogTitle').textContent='SEO geçmişi · '+row.url;root.textContent='Kaynak hashleri ve tarama sürümleri okunuyor…';if(!dialog.open)dialog.showModal();
  try{const value=await read('seo-history/detail?'+new URLSearchParams({kind,id:row.id}));if(at!==detailEpoch||revision!==scope().revision||!dialog.open)return;
   root.replaceChildren(node('p','Kaynak: '+value.source+' · Kayıt '+value.id+' · SHA-256 '+value.record_hash),siteLink(value.url,'Satış sayfasını ayrıca aç'));
   root.append(button('Analizi kopyala',async()=>{try{await navigator.clipboard.writeText(root.innerText);notify('Tarih, URL, filtre, kaynak ve sayısal kanıtlar kopyalandı.');}catch{notify('Tarayıcı panoya erişemedi; metni seçerek kopyalayabilirsiniz.');}}));
   if(kind==='snapshot'){root.append(node('h3',stamp(value.observed_at)),node('p','Kaynak snapshot hash: '+value.content_hash),fieldTable(null,value.fields),node('p','İçerik özeti kaynakta saklanan metindir; tam CMS sürümü veya yayın zamanı değildir.'));return;}
   root.append(node('p','Önceki tarama: '+stamp(value.observed_from)+' · Sonraki tarama: '+stamp(value.observed_to)),node('p',value.publication_evidence?'Kanıtlı yayın: '+stamp(value.published_at)+' · '+value.publication_evidence.ref:'Kesin yayın tarihi bilinmiyor. Tarama aralığı tek bir yayın günü olarak yorumlanamaz.'),node('p','Değişen alanlar: '+value.changed_fields.map(k=>labels[k]||k).join(', ')));
   if(value.details_available){if(!value.content_comparable)root.append(node('p','İki başarılı HTML kaydı yok; hata veya yönlendirme içeriği SEO içerik değişikliği sayılmaz.'));root.append(fieldTable(value.before.fields,value.after.fields),node('p','Önceki snapshot '+value.before.id+' · '+value.before.record_hash+' / Sonraki snapshot '+value.after.id+' · '+value.after.record_hash));
    const oldLinks=value.before.fields.links,newLinks=value.after.fields.links;if(Array.isArray(oldLinks)&&Array.isArray(newLinks)){const old=new Set(oldLinks),now=new Set(newLinks);root.append(detail('Eklenen / kaldırılan bağlantılar',node('pre','Eklenen:\n'+newLinks.filter(u=>!old.has(u)).join('\n')+'\n\nKaldırılan:\n'+oldLinks.filter(u=>!now.has(u)).join('\n'))));}
   }else root.append(node('p','Eski/yeni tarama sürümlerinin aktarımı henüz tamamlanmadı; farklar uydurulmadı.'));
   root.append(node('p',value.content_limit));const result=node('section');root.append(result);await impact(value,result,at,revision);
  }catch(error){if(at===detailEpoch&&dialog.open)root.append(node('p',error.message));}
 }
 async function impact(value,root,at,revision){root.textContent='Aynı URL ve cihaz kapsamındaki GSC ayları okunuyor…';
  const s=scope(),data=await read('seo-history/impact?'+new URLSearchParams({id:value.id,month:s.month,device:s.device}));if(at!==detailEpoch||revision!==scope().revision||!$('productDialog').open)return;
  root.replaceChildren(node('h3','GSC aylık performansı · ayrı gözlemsel kanıt'),node('p',data.url+' · '+data.device+' · tüm ülkeler · '+data.timezone),badge(data.decision),node('p','İncele, sayfayı değiştir demek değildir. Korelasyon kesin neden değildir.'));
  const t=node('div',null,'table-scroll');table(t,['Ay','Dönemin zaman çizelgesindeki yeri','Tıklama','Gösterim','CTR','Ortalama konum'],data.observations.map(r=>[cell(r.month,r.month),r.role,...['clicks','impressions','ctr','position'].map(key=>cell(!r.verified||!r.metrics||(['ctr','position'].includes(key)&&!r.metrics.impressions)?'Veri bekle':key==='ctr'?percent(r.metrics[key]):number(r.metrics[key]),r.verified?r.metrics?.[key]??null:null))]));root.append(t,node('p','Önceki tam ay → sonraki ilk tam ay tıklama farkı: '+signed(data.comparison?.click_delta)));
  const chart=node('div',null,'chart-container'),chartTable=node('div',null,'table-scroll');drawChart(chart,chartTable,{granularity:'month',series:data.observations.map(r=>({day:r.month+'-01',verified:r.verified,metrics:r.verified?r.metrics:null,fetched_at:r.evidence?.[0]?.captured_at}))},'clicks');sortableChart(chartTable);root.append(chart,detail('Grafik verileri',chartTable),...data.limitations.map(text=>node('p',text)),evidence(data.observations.flatMap(r=>r.evidence)));
 }
 async function render(name,day=null){let state=surfaces.get(name)||create(name);const s=scope();
  if(state.catalogRevision!==s.revision){const before=state.fields.product.value;state.fields.product.replaceChildren(new Option('Bütün ürünler',''),...(s.catalog?.products||[]).map(p=>new Option(p.name,p.id)));if([...state.fields.product.options].some(o=>o.value===before))state.fields.product.value=before;state.catalogRevision=s.revision;state.cursor='';state.cursors=[];}
  if(day){state.fields.from.value=day;state.fields.to.value=day;state.cursor='';state.cursors=[];}
  if(name==='changes')$('changeDay').closest('.inline-controls').hidden=true;
  return load(state);
 }
 $('productDialog').addEventListener('close',()=>detailEpoch++);
 return {render,clear(){epoch++;detailEpoch++;for(const state of surfaces.values()){state.request++;state.results.replaceChildren();state.coverage.replaceChildren();state.paging.replaceChildren();}health.replaceChildren();surfaces.clear();}};
}
