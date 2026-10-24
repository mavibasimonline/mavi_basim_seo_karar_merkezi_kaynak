export function sameOriginURL(input:string,base:string,origin:string):string|null {
  try {
    const url = new URL(input, base);
    if (url.origin !== origin || url.username || url.password) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|gclid$|fbclid$)/i.test(key)) url.searchParams.delete(key);
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    url.searchParams.sort();
    return url.href;
  } catch { return null; }
}
export function siteURL(input:string,base='https://mavibasim.com'):string|null{return sameOriginURL(input,base,'https://mavibasim.com');}
export function variantFamily(input: string): string {
  return input.toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}
export function isBrand(query: string): boolean { return /\bmavi\s*basim\b/.test(variantFamily(query)); }
