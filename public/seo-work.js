// SEO İşleri: ürün filtreleme arayüzü. Mevcut kanıt geçmişini değiştirmez.
const groups = [
  {name:"Broşürler ve El İlanları",products:["Broşür","El İlanı","Afiş"]},
  {name:"Reklam Ürünleri",products:["Magnet","Kitap Ayracı","Yağ Kartı","Etiket","Amerikan Servis","Oto Paspas","Kutu","Ambalaj"]},
  {name:"Kurumsal Ürünler",products:["Kartvizit","Zarf","Antetli Kağıt","Dosya","Katalog","Bloknot","Küp Bloknot","Karton Çanta"]},
  {name:"Makbuz ve Formlar",products:["Adisyon","Sipariş Fişi","Perakende Satış Fişi","Para Makbuzu","Sözleşme","Sigorta Poliçeleri","Tahsilat Makbuzu","Araç Kiralama","Gider Makbuzu","Giriş Bileti","Reçete","Tediye Makbuzu","Tüm Makbuz İşleri"]}
];
const root=document.getElementById("seoWorkApp");
if(root){
  const search=root.querySelector("#seoWorkSearch");
  const tabs=root.querySelector("#seoWorkCategories");
  const items=root.querySelector("#seoWorkProducts");
  const detail=root.querySelector("#seoWorkDetail");
  let selected="Tüm Kategoriler", product="";
  const normalize=s=>s.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  function render(){
    tabs.replaceChildren();
    for(const name of ["Tüm Kategoriler",...groups.map(g=>g.name)]){
      const b=document.createElement("button");b.type="button";b.className="seo-work-pill";b.textContent=name;b.setAttribute("aria-pressed",String(selected===name));
      b.addEventListener("click",()=>{selected=name;product="";render();});tabs.append(b);
    }
    items.replaceChildren();
    const q=normalize(search.value.trim());
    let count=0;
    for(const group of groups){
      if(selected!=="Tüm Kategoriler"&&selected!==group.name)continue;
      const matches=group.products.filter(p=>normalize(p).includes(q)||normalize(group.name).includes(q));
      if(!matches.length)continue;
      count+=matches.length;
      const section=document.createElement("section");section.className="seo-work-group";
      const h=document.createElement("h3");h.textContent=group.name;section.append(h);
      const chips=document.createElement("div");chips.className="seo-work-items";
      matches.forEach(p=>{const b=document.createElement("button");b.type="button";b.className="seo-work-product";b.textContent=p;b.setAttribute("aria-pressed",String(product===p));b.addEventListener("click",()=>{product=p;render();});chips.append(b);});
      section.append(chips);items.append(section);
    }
    if(!count){const p=document.createElement("p");p.textContent="Aramayla eşleşen ürün bulunamadı.";items.append(p);}
    detail.replaceChildren();
    if(product){
      const h=document.createElement("h3");h.textContent=product+" · SEO çalışması";
      const p=document.createElement("p");p.textContent="Bu seçim yalnız görüntüleme amaçlıdır; önceki SEO kayıtları ve tarihleri değiştirilmez. Kanıtlı SEO geçmişini Tayfun bölümünden inceleyin.";
      const a=document.createElement("a");a.href="#tayfun";a.className="button secondary seo-work-link";a.textContent="Tayfun kayıtlarına git";a.addEventListener("click",()=>document.querySelector('[data-view="tayfun"]')?.click());
      detail.append(h,p,a);detail.hidden=false;
    }else detail.hidden=true;
  }
  search.addEventListener("input",()=>{product="";render();});
  render();
}
