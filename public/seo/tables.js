// Sort the whole filtered result before pagination; retain real row actions.
const states=new WeakMap(),collator=new Intl.Collator('tr',{numeric:true,sensitivity:'base'});
const missing=v=>v===null||v===undefined||typeof v==='number'&&!Number.isFinite(v);
export const cell=(display,sort)=>({display,sort});
function value(v,header){
 if(v&&typeof v==='object'&&'display'in v)return v.sort;
 const text=(v instanceof Node?v.textContent:String(v??'')).trim();
 if(!text||/doğrulanmadı|veri bekle|veri yok|eksik kayıt|^—$|^–$/i.test(text))return null;
 if(/karar|durum/i.test(header)){if(/öncelikli.*incele/i.test(text))return 4;if(/incele|gerileme/i.test(text))return 3;if(/koru/i.test(text))return 2;return 1;}
 if(/tıklama|gösterim|ctr|konum|sıra|fark|değişim|oturum|kullanıcı/i.test(header)&&!/(sorgu|fırsat|tür|sayfa)/i.test(header)){
  const raw=text.replace(/\./g,'').replace(',','.').replace(/[^\d+\-.]/g,'');const n=raw?Number(raw):NaN;return Number.isFinite(n)?n:null;
 }
 return text;
}
export function table(root,headers,rows,options={}){
 let state=states.get(root);const identity=headers.join('|');
 if(!state||state.identity!==identity)state={identity,index:options.initialSort??Math.max(0,headers.findIndex(h=>/tıklama/i.test(h)&&!/fark|değişim/i.test(h))),direction:options.initialDirection||'desc',page:1};
 if(options.sort){state.index=options.sort.index;state.direction=options.sort.direction;}
 if(options.page)state.page=options.page;states.set(root,state);
 const t=document.createElement('table'),head=t.createTHead(),tr=head.insertRow(),body=t.createTBody(),pageSize=options.pageSize??40;
 const prepared=rows.map((cells,index)=>({cells,index,values:cells.map((v,i)=>value(v,headers[i]))}));
 const controls=[];
 function draw(){
  const sorted=[...prepared].sort((a,b)=>{const av=a.values[state.index],bv=b.values[state.index];if(missing(av)||missing(bv))return missing(av)===missing(bv)?a.index-b.index:missing(av)?1:-1;const order=typeof av==='number'&&typeof bv==='number'?av-bv:collator.compare(String(av),String(bv));return order*(state.direction==='asc'?1:-1)||a.index-b.index;});
  state.page=Math.min(Math.max(1,state.page),Math.max(1,Math.ceil(sorted.length/pageSize)));body.replaceChildren();
  for(const {cells} of sorted.slice((state.page-1)*pageSize,state.page*pageSize)){const row=body.insertRow();for(const v of cells){const td=row.insertCell(),display=v&&typeof v==='object'&&'display'in v?v.display:v;td.append(display instanceof Node?display:document.createTextNode(display??'—'));}}
  if(!sorted.length){const td=body.insertRow().insertCell();td.colSpan=headers.length;td.textContent=options.empty||'Bu kapsamda doğrulanmış kayıt yok; eksik kayıt sıfır değildir.';}
  controls.forEach((b,i)=>{b.textContent=headers[i]+(i===state.index?(state.direction==='desc'?' ↓':' ↑'):'');b.parentElement.setAttribute('aria-sort',i===state.index?(state.direction==='desc'?'descending':'ascending'):'none');});
  const old=root.querySelector('.table-pagination');old?.remove();
  if(sorted.length>pageSize&&!options.externalPager){const bar=document.createElement('div');bar.className='table-pagination';for(const [text,offset]of[['Önceki',-1],['Sonraki',1]]){const button=document.createElement('button');button.type='button';button.className='button secondary';button.textContent=text;button.disabled=offset<0?state.page===1:state.page*pageSize>=sorted.length;button.onclick=()=>{state.page+=offset;draw();};bar.append(button);if(offset<0){const label=document.createElement('span');label.textContent=state.page+' / '+Math.ceil(sorted.length/pageSize)+' · '+sorted.length+' kayıt';bar.append(label);}}root.append(bar);}
  options.onPage?.(state.page,sorted.length,pageSize);
 }
 headers.forEach((h,i)=>{const th=document.createElement('th');th.scope='col';const button=document.createElement('button');button.type='button';button.className='table-sort';button.title=/konum|sıra/i.test(h)?'Ortalama konum: 1 en iyi sıradır. Sıralama yönünü değiştir.':'Sıralama yönünü değiştir';button.onclick=()=>{if(state.index===i)state.direction=state.direction==='desc'?'asc':'desc';else{state.index=i;state.direction='desc';}state.page=1;draw();};th.append(button);tr.append(th);controls.push(button);});
 root.replaceChildren(t);draw();return state;
}
export function resetTable(root){states.delete(root);}
export function sortableChart(root){
 const t=root.querySelector('table');if(!t)return;
 const headers=[...t.querySelectorAll('thead th')].map(e=>e.textContent),rows=[...t.querySelectorAll('tbody tr')].map(tr=>[...tr.cells].map(td=>td.textContent));
 if(headers.length&&rows.length)table(root,headers,rows,{pageSize:40,initialSort:headers.findIndex(h=>/tıklama/i.test(h))>=0?headers.findIndex(h=>/tıklama/i.test(h)):0});
}
