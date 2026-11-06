const groups=[
["Broşürler ve El İlanları","Broşür|El İlanı|Afiş"],
["Reklam Ürünleri","Magnet|Kitap Ayracı|Yağ Kartı|Etiket|Amerikan Servis|Oto Paspas|Kutu|Ambalaj"],
["Kurumsal Ürünler","Kartvizit|Zarf|Antetli Kağıt|Dosya|Katalog|Bloknot|Küp Bloknot|Karton Çanta"],
["Makbuz ve Formlar","Adisyon|Sipariş Fişi|Perakende Satış Fişi|Para Makbuzu|Sözleşme|Sigorta Poliçeleri|Tahsilat Makbuzu|Araç Kiralama|Gider Makbuzu|Giriş Bileti|Reçete|Tediye Makbuzu|Tüm Makbuz İşleri"]];
const root=document.getElementById("seoWorkApp");
if(root){
 const search=root.querySelector("#seoWorkSearch"),tabs=root.querySelector("#seoWorkCategories"),items=root.querySelector("#seoWorkProducts"),detail=root.querySelector("#seoWorkDetail");
 let selected="Tüm Kategoriler",product="";
 const norm=s=>s.toLocaleLowerCase("tr-TR");
 const button=(label,cls,active,action)=>{
  const b=document.createElement("button");
  b.type="button";b.className=cls;b.textContent=label;b.setAttribute("aria-pressed",String(active));b.onclick=action;return b;
 };
 function render(){
  tabs.replaceChildren(...["Tüm Kategoriler",...groups.map(g=>g[0])].map(n=>button(n,"seo-work-pill",selected===n,()=>{selected=n;product="";render()})));
  items.replaceChildren();
  const q=norm(search.value.trim());
  let count=0;
  for(const [group,values] of groups){
   if(selected!=="Tüm Kategoriler"&&selected!==group)continue;
   const matches=values.split("|").filter(p=>norm(p).includes(q)||norm(group).includes(q));
   if(!matches.length)continue;
   count+=matches.length;
   const section=document.createElement("section");section.className="seo-work-group";
   const h=document.createElement("h3");h.textContent=group;
   const chips=document.createElement("div");chips.className="seo-work-items";
   chips.replaceChildren(...matches.map(p=>button(p,"seo-work-product",product===p,()=>{product=p;render()})));
   section.append(h,chips);items.append(section);
  }
  if(!count){const p=document.createElement("p");p.textContent="Ürün bulunamadı.";items.append(p)}
  detail.replaceChildren();detail.hidden=!product;
  if(product){
   const h=document.createElement("h3");h.textContent=product+" · SEO";
   const p=document.createElement("p");p.textContent="SEO geçmişini Tayfun bölümünde inceleyin.";
   const a=document.createElement("a");a.href="#tayfun";a.className="button secondary seo-work-link";a.textContent="Tayfun'a git";
   a.onclick=e=>{e.preventDefault();document.querySelector('[data-view="tayfun"]')?.click()};
   detail.append(h,p,a);
  }
 }
 search.oninput=()=>{product="";render()};
 render();
}