// Only a direct, authenticated user form submission can persist a mapping.
// Never infer or silently assign products; source GSC evidence is checked server-side.
document.addEventListener('submit',async event=>{
 const form=event.target;
 if(!(form instanceof HTMLFormElement)||form.id!=='catalogDraftForm')return;
 event.preventDefault();event.stopImmediatePropagation();
 const message=document.getElementById('catalogDraftError'),button=form.querySelector('[type="submit"]');
 const urls=document.getElementById('draftProductUrls').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
 if(urls.length!==1){message.textContent='Kalıcı eşleme için bir doğrulanmış GSC sayfası seçin.';return;}
 if(!confirm('Bu URL’yi doğrulanmış ürün kataloğuna kalıcı olarak eklemek istiyor musunuz?'))return;
 button.disabled=true;message.textContent='Ürün eşlemesi kaydediliyor…';
 try{
  const catalogResponse=await fetch('/api/independent/catalog',{credentials:'same-origin',cache:'no-store'});
  if(!catalogResponse.ok)throw Error('Katalog şu an okunamıyor.');
  const catalog=await catalogResponse.json();
  if(!catalog.available||typeof catalog.source_hash!=='string')throw Error('Doğrulanmış katalog bulunamadı.');
  const response=await fetch('/api/independent/catalog',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({
   base_hash:catalog.source_hash,month:document.getElementById('month').value,
   name:document.getElementById('draftProductName').value.trim(),
   category:document.getElementById('draftProductCategory').value,url:urls[0]
  })});
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw Error(result.code==='CATALOG_MAPPING_INVALID'?'URL zaten eşlenmiş, doğrulanmamış veya katalog yenilenmiş.':'Ürün eşlemesi kaydedilemedi.');
  message.textContent='Ürün kataloğa kalıcı kaydedildi. Görünüm güncelleniyor…';
  location.reload();
 }catch(error){message.textContent=error.message||'Eşleme kaydedilemedi.';}
 finally{button.disabled=false;}
},true);
