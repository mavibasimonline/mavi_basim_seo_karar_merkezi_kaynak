import {describe,it,expect} from 'vitest';
import {tayfunList,tayfunSave} from '../src/tayfun-ledger';
const secret=btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
function store(){
 const data=new Map<string,unknown>();
 return {data,get:async<T=unknown>(key:string)=>data.get(key) as T|undefined,put:async(key:string,value:unknown)=>{data.set(key,value);}};
}
const initial={month:'2026-10',url:'https://mavibasim.com/brosur',title:'Broşür fiyatları',description:'A5 / A4 broşür',h1:'Broşür baskı',canonical:'https://mavibasim.com/brosur',robots:'index,follow',headings:'A5, A4',internal_links:'/etiket',structured_data:'{}',notes:'GSC karşılaştırma hipotezi',keywords:['broşür fiyatları'],status:'aktif'};
describe('Tayfun immutable monthly ledger',()=>{
 it('stores encrypted version per record, independently across months, without deletion',async()=>{
  const s=store(),one=await tayfunSave(s,secret,initial,new Date('2026-11-06T12:00:00Z'));
  expect(one.ok).toBe(true);
  expect(one.site_mutations).toBe(0);
  expect([...s.data.values()].join('')).not.toContain('Broşür fiyatları');
  const oct=await tayfunList(s,secret,'2026-10');
  expect(oct.entries).toHaveLength(1);
  expect(oct.entries[0].title).toBe('Broşür fiyatları');
  const two=await tayfunSave(s,secret,{...initial,month:'2026-11',title:'Yeni sürüm',status:'pasif',supersedes:one.entry.id},new Date('2026-11-06T13:00:00Z'));
  expect(two.entry.supersedes).toBe(one.entry.id);
  expect((await tayfunList(s,secret,'2026-10')).entries[0].status).toBe('aktif');
  expect((await tayfunList(s,secret,'2026-11')).entries[0].status).toBe('pasif');
  expect(s.data.size).toBe(4);
 });
 it('rejects external URL and untrusted future months and unsupported statuses',async()=>{
  const s=store();
  await expect(tayfunSave(s,secret,{...initial,url:'https://example.org/'},new Date('2026-11-06'))).rejects.toThrow('TAYFUN_INPUT_INVALID');
  await expect(tayfunSave(s,secret,{...initial,month:'2027-01'},new Date('2026-11-06'))).rejects.toThrow('TAYFUN_INPUT_INVALID');
  await expect(tayfunSave(s,secret,{...initial,status:'deleted'},new Date('2026-11-06'))).rejects.toThrow('TAYFUN_INPUT_INVALID');
  expect(s.data.size).toBe(0);
 });
 it('cannot supersede another page or a nonexisting version',async()=>{
  const s=store(),one=await tayfunSave(s,secret,initial,new Date('2026-11-06'));
  await expect(tayfunSave(s,secret,{...initial,url:'https://mavibasim.com/magnet',supersedes:one.entry.id},new Date('2026-11-06'))).rejects.toThrow('TAYFUN_INPUT_INVALID');
  await expect(tayfunSave(s,secret,{...initial,supersedes:'made-up'},new Date('2026-11-06'))).rejects.toThrow('TAYFUN_INPUT_INVALID');
  expect((await tayfunList(s,secret,'2026-10')).entries).toHaveLength(1);
 });
 it('stores a changed December Title and H1 as a new dated row while preserving October and November SEO and all keywords',async()=>{
  const s=store(),oct=await tayfunSave(s,secret,initial,new Date('2026-11-07T12:00:00Z'));
  const november=await tayfunSave(s,secret,{...initial,month:'2026-11',title:'Kasım Broşür SEO Title',
   description:'Kasım meta',h1:'Kasım H1',headings:'H2 Kasım',
   keywords:['broşür yeni sorgu'],supersedes:oct.entry.id},new Date('2026-11-07T15:49:48Z'));
  const december=await tayfunSave(s,secret,{...initial,month:'2026-12',title:'Aralık 2026 Yeni Başlık',
   description:'Aralık meta',h1:'Aralık yeni H1',headings:'H2 Aralık',
   keywords:['aralık broşür kelimesi'],supersedes:november.entry.id},new Date('2026-12-05T09:20:00Z'));
  const old=(await tayfunList(s,secret,'2026-10')).entries;
  const middle=(await tayfunList(s,secret,'2026-11')).entries;
  const newer=(await tayfunList(s,secret,'2026-12')).entries;
  expect(old).toHaveLength(1);expect(middle).toHaveLength(1);expect(newer).toHaveLength(1);
  expect(old[0].title).toBe('Broşür fiyatları');
  expect(middle[0]).toMatchObject({title:'Kasım Broşür SEO Title',h1:'Kasım H1',
   created_at:'2026-11-07T15:49:48.000Z'});
  expect(newer[0]).toMatchObject({title:'Aralık 2026 Yeni Başlık',h1:'Aralık yeni H1',
   created_at:'2026-12-05T09:20:00.000Z',supersedes:november.entry.id});
  expect(newer[0].keywords).toEqual(['broşür fiyatları','broşür yeni sorgu','aralık broşür kelimesi']);
  expect(middle[0].keywords).toEqual(['broşür fiyatları','broşür yeni sorgu']);
  expect(old[0].keywords).toEqual(['broşür fiyatları']);
  expect(s.data.size).toBe(6);
 });

});
