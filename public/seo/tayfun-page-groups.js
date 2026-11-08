// Sitemap URL path classification for Tayfun's grouped SEO evidence browser.
// Keep product identity separate: product catalog entries take precedence.
export const PRODUCT_GROUPS = Object.freeze([
 'Broşürler ve El İlanları','Reklam Ürünleri','Kurumsal Ürünler','Makbuz ve Formlar'
]);
export const OTHER_GROUPS = Object.freeze([
 'Şehir Sayfaları','Blog Sayfaları','Sektörel Sayfalar',
 'Matbaa ve Hizmet Sayfaları','Kurumsal ve Bilgi Sayfaları','Ana Sayfa','Diğer Sayfalar'
]);
const CITY_NAMES = [
 'adana','adiyaman','afyonkarahisar','agri','amasya','ankara','antalya','artvin','aydin',
 'balikesir','bilecik','bingol','bitlis','bolu','burdur','bursa','canakkale','cankiri',
 'corum','denizli','diyarbakir','edirne','elazig','erzincan','erzurum','eskisehir','gaziantep',
 'giresun','gumushane','hakkari','hatay','isparta','mersin','istanbul','izmir','kars',
 'kastamonu','kayseri','kirklareli','kirsehir','kocaeli','konya','kutahya','malatya',
 'manisa','kahramanmaras','mardin','mugla','mus','nevsehir','nigde','ordu','rize','sakarya',
 'samsun','siirt','sinop','sivas','tekirdag','tokat','trabzon','tunceli','sanliurfa',
 'usak','van','yozgat','zonguldak','aksaray','bayburt','karaman','kirikkale','batman',
 'sirnak','bartin','ardahan','igdir','yalova','karabuk','kilis','osmaniye','duzce'
];
const cities=new Set(CITY_NAMES);
const infoPages=new Set([
 'hakkimizda','hakkimizda-biz','iletisim','iletisim-bilgileri','kvkk','kvkk-aydinlatma-metni',
 'gizlilik-politikasi','gizlilik','cerez-politikasi','kullanim-sartlari','sikca-sorulan-sorular',
 'sss','mesafeli-satis-sozlesmesi','iptal-iade','iade-kosullari','teslimat-kosullari',
 'uyelik-sozlesmesi','hizmet-sartlari','odeme-secenekleri'
]);
const services=new Set(['matbaa','ofset-baski','dijital-baski','online-matbaa','matbaa-fiyatlari','baski-fiyatlari']);
function normalize(value) {
 return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replaceAll('ı','i').toLowerCase();
}
export function pageGroupFor(url) {
 let path;
 try {
  const parsed=new URL(url);
  if(!['mavibasim.com','www.mavibasim.com'].includes(parsed.hostname.toLowerCase()))
   return 'Diğer Sayfalar';
  path=normalize(decodeURIComponent(parsed.pathname)).replace(/\/+$/,'')||'/';
 } catch {return 'Diğer Sayfalar';}
 if(path==='/')return 'Ana Sayfa';
 if(/^\/(?:blog|bloglar|yazi|yazilar|rehber|makaleler)(?:\/|$)/.test(path))return 'Blog Sayfaları';
 if(/^\/(?:sektor|sektorel|sektorler)(?:\/|$)/.test(path))return 'Sektörel Sayfalar';
 if(/^\/(?:sehir|sehirler|il|iller)(?:\/|$)/.test(path))return 'Şehir Sayfaları';
 const leaf=path.slice(1);
 // City names must be known provinces, not a generic print-product slug ending in -baski.
 const city=leaf.match(/^([a-z-]+)-(?:matbaa|baski|matbaa-baski|baski-hizmetleri)$/);
 if(city&&cities.has(city[1]))return 'Şehir Sayfaları';
 if(cities.has(leaf))return 'Şehir Sayfaları';
 if(infoPages.has(leaf)||/^(?:hakkimizda|iletisim|kvkk|gizlilik|cerez|sozlesme)(?:\/|$)/.test(leaf))
  return 'Kurumsal ve Bilgi Sayfaları';
 if(services.has(leaf)||/^(?:matbaa|ofset|dijital-baski)(?:\/|$)/.test(leaf))
  return 'Matbaa ve Hizmet Sayfaları';
 return 'Diğer Sayfalar';
}
export function groupOrder(groups) {
 const main=[...PRODUCT_GROUPS,...OTHER_GROUPS];
 return [...groups].sort((a,b)=>{
  const ai=main.indexOf(a),bi=main.indexOf(b);
  if(ai!==-1||bi!==-1)return (ai===-1?1:bi===-1?-1:ai-bi);
  return a.localeCompare(b,'tr');
 });
}
