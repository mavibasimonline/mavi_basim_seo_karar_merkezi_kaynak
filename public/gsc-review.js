// Read-only UI for the dated GSC review cohort. No HTML interpolation of source values.
export function renderGscReview(container, report) {
  container.replaceChildren();
  const note=document.createElement('p');
  note.className='muted';
  note.textContent=report.limitation || 'İnceleme kanıtı sınırlı.';
  container.append(note);
  if (report.performance?.reason) {
    const warning=document.createElement('p');warning.className='muted';
    warning.textContent='Performans karşılaştırması bekliyor: '+report.performance.reason;
    container.append(warning);
  }
  for(const group of ['product-links','city-content']){
    const rows=(Array.isArray(report.rows)?report.rows:[]).filter(x=>x.group===group);
    const section=document.createElement('section');
    const heading=document.createElement('h3');
    heading.textContent=group==='product-links'?'Ürün sayfaları (8)':'Şehir sayfaları (18)';
    section.append(heading);
    const list=document.createElement('ul');
    for(const item of rows){
      const li=document.createElement('li');
      const link=document.createElement('a');
      const path=typeof item.path==='string'&&/^\/[a-z0-9/-]+$/.test(item.path)?item.path:null;
      link.textContent=String(item.name||item.path||'Sayfa');
      if(path){link.href='https://mavibasim.com'+path;link.target='_blank';link.rel='noopener noreferrer';}
      const detail=document.createElement('span');
      detail.className='muted';
      detail.textContent=' · GSC örneklem: '+String(item.sampled_gsc_internal_links)+' bağlantı · '+String(item.status||'Veri bekle')+
        ' · Son tarama: '+String(item.observed_at||'yok')+
        (item.http_status===null?'':' · HTTP '+String(item.http_status));
      li.append(link,detail);
      if (item.performance?.available && item.performance.current && item.performance.previous) {
        const comparison=document.createElement('p');
        comparison.className='muted';
        comparison.textContent='GSC doğrulanmış dönem: '+String(item.performance.previous.clicks)+' → '+String(item.performance.current.clicks)+' tıklama · '+String(item.performance.decision)+' · Korunan sorgu: '+String(item.performance.protected_queries);
        li.append(comparison);
      }
      list.append(li);
    }
    section.append(list);container.append(section);
  }
}
