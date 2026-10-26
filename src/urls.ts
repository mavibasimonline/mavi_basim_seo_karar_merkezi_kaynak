export function siteURL(input: string, base = 'https://mavibasim.com'): string | null {
  try {
    const url = new URL(input, base);
    if (url.origin !== 'https://mavibasim.com' || url.username || url.password) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|gclid$|fbclid$)/i.test(key)) url.searchParams.delete(key);
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    url.searchParams.sort();
    return url.href;
  } catch { return null; }
}

// GSC observations are not crawl targets or proof that two URLs are canonical
// equivalents. Keep the observed protocol/host; never widen siteURL's network policy.
const GSC_ORIGINS = ['https://mavibasim.com','https://www.mavibasim.com','http://mavibasim.com','http://www.mavibasim.com'] as const;
function ownedGscURL(input: unknown): URL|null {
  if(typeof input!=='string'||/[\u0000-\u0020\u007f\\]/.test(input)
    ||!/^https?:\/\/(?:www\.)?mavibasim\.com(?:\/|$)/i.test(input))return null;
  try{
    const url=new URL(input);
    return !url.username&&!url.password&&!url.port&&(GSC_ORIGINS as readonly string[]).includes(url.origin)?url:null;
  }catch{return null;}
}
export function gscPageURL(input: unknown, property='sc-domain:mavibasim.com'): string|null {
  const url=ownedGscURL(input);
  if(!url)return null;
  if(property!=='sc-domain:mavibasim.com'){
    const prefix=ownedGscURL(property);
    if(!prefix||prefix.search||prefix.hash||!url.href.startsWith(prefix.href))return null;
  }
  return input as string;
}
// The same finite ownership rule for independent raw-record checks. d.page is a
// fixed internal column, not user SQL. Property scope is checked on API ingestion;
// historical domain observations remain valid if the current property changes.
export const GSC_PAGE_SQL_VALID = `((lower(d.page) IN (${GSC_ORIGINS.map(o=>`'${o}'`).join(',')})
  OR ${GSC_ORIGINS.map(o=>`lower(d.page) LIKE '${o}/%'`).join(' OR ')})
  AND instr(d.page,char(0))=0 AND instr(d.page,'\\')=0
  AND d.page NOT GLOB ('*['||char(1)||'-'||char(32)||char(127)||']*'))`;
export function variantFamily(input: string): string {
  return input.toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}
export function isBrand(query: string): boolean { return /\bmavi\s*basim\b/.test(variantFamily(query)); }
