import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {env} from 'cloudflare:workers';
import {reset,runInDurableObject} from 'cloudflare:test';
import type {IndependentDriveEnv,IndependentDriveStore} from '../../src/drive-independent';
import {decrypt} from '../../src/security';
import {verifiedDriveRecords} from '../../src/drive-records';

const cfg=env as IndependentDriveEnv;
const stub=()=>cfg.DRIVE_ARCHIVE_STORE.get(cfg.DRIVE_ARCHIVE_STORE.idFromName('mavi-basim-sheets-drive-v2'));
beforeEach(async()=>{await reset();});
afterEach(()=>vi.restoreAllMocks());
async function consent(){
 const start=await stub().fetch('https://app.example/api/drive-independent/start',{method:'POST'});
 const data=await start.json() as any,url=new URL(data.authorization_url);
 const callback=new Request('https://app.example/api/oauth/google/callback?code=fixture&state='+url.searchParams.get('state'),{redirect:'manual',headers:{Cookie:start.headers.get('Set-Cookie')!}});
 const result=await stub().fetch(callback);const alarm=await runInDurableObject(stub(),async(_instance,state)=>{const value=await state.storage.getAlarm();await state.storage.deleteAlarm();return value;});
 return {start,url,callback,result,alarm};
}
const metric={'Tıklama':'1','Gösterim':'10','TO (%)':'10','Ortalama Konum':'2'};
function sheets(){return {
 OZET:[{...metric,'Dönem Kodu':'previous','Başlangıç Tarihi':'2026-09-01','Bitiş Tarihi':'2026-09-30'}],
 GSC_GUNLUK:[{...metric,Tarih:'2026-07-01'}],URUNLER:[{...metric,'Dönem Kodu':'previous','Ürün ID':'fixture-product'}],
 SORGULAR:[{...metric,'Dönem Kodu':'previous','Ürün ID':'fixture-product',Sorgu:'fixture-query',manuel_karar_notu:'fixture preserve'}],
};}
describe('independent Drive without a D1 binding',()=>{
 it('stores a new offline grant encrypted in SQLite DO, consumes state once and starts automatically',async()=>{
  expect('DB' in cfg).toBe(false);
  const {start,url,callback,result,alarm}=await consent();
  expect(start.status).toBe(200);expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');expect(url.searchParams.get('access_type')).toBe('offline');expect(result.status).toBe(303);
  expect(alarm).toBeGreaterThan(Date.now()-1000);
  await runInDurableObject(stub(),async(_instance,state)=>{const saved=await state.storage.get<string>('oauth');expect(saved).not.toContain('fixture-drive-refresh');expect((await decrypt<any>(saved!,cfg.ARCHIVE_ENCRYPTION_KEY!)).refresh_token).toBe('fixture-drive-refresh');});
  expect((await stub().fetch(callback)).status).toBe(400);
 });
 it('rejects a callback without its browser cookie and never creates a token record',async()=>{
  const start=await stub().fetch('https://app.example/api/drive-independent/start',{method:'POST'}),url=new URL((await start.json() as any).authorization_url);
  expect((await stub().fetch('https://app.example/api/oauth/google/callback?code=fixture&state='+url.searchParams.get('state'))).status).toBe(400);
  await runInDurableObject(stub(),async(_instance,state)=>expect(await state.storage.get('oauth')).toBeUndefined());
 });
 it('keeps user fields, deduplicates records and quarantines ambiguous daily-detail substitutes',async()=>{
  const input=sheets();input.SORGULAR.push({...input.SORGULAR[0]});
  expect((await verifiedDriveRecords(input,new Date('2026-10-30'))).record_count).toBe(4);
  input.SORGULAR.push({...input.SORGULAR[0],'Tıklama':'2','TO (%)':'20'});
  const result=await verifiedDriveRecords(input,new Date('2026-10-30'));expect(result.record_count).toBe(3);expect(result.quarantined_records).toBe(2);expect(result.daily_gsc_jobs_completed).toBe(0);
  input.GSC_GUNLUK[0]['TO (%)']='90';await expect(verifiedDriveRecords(input,new Date('2026-10-30'))).rejects.toThrow('SOURCE_METRIC_INVALID');
 });
 it('writes both archives, verifies real readback, and recovers a lost upload reply without duplicates',async()=>{
  await consent();
  const files=new Map<string,{meta:any;data:Uint8Array}>(),input=sheets();let uploads=0,lost=true;
  vi.spyOn(globalThis,'fetch').mockImplementation(async(inputUrl,init)=>{
   const url=String(inputUrl),u=new URL(url);
   if(u.hostname==='docs.google.com'){
    if(u.pathname.endsWith('/export'))return new Response(new Uint8Array([80,75,3,4,1,2,3,4]));
    const rows=(input as any)[u.searchParams.get('sheet')!],labels=[...new Set(rows.flatMap((r:any)=>Object.keys(r)))];
    return new Response('google.visualization.Query.setResponse('+JSON.stringify({status:'ok',table:{cols:labels.map(label=>({label})),rows:rows.map((r:any)=>({c:labels.map(label=>r[label]===undefined?null:{v:r[label]})}))}})+');');
   }
   if(url.includes('/about?'))return Response.json({storageQuota:{limit:'15000000000',usage:'0'}});
   if(url.includes('/files/generateIds?'))return Response.json({ids:['fixture_archive_xlsx','fixture_archive_json']});
   if(url.includes('/upload/drive/')){
    uploads++;const blob=init!.body as Blob,raw=new Uint8Array(await blob.arrayBuffer()),text=new TextDecoder().decode(raw),meta=JSON.parse(text.split('\r\n\r\n')[1].split('\r\n--')[0]);
    const marker=new TextEncoder().encode('Content-Type: '+meta.mimeType+'\r\n\r\n');let start=-1;
    for(let i=0;i<raw.length-marker.length;i++)if(marker.every((b,j)=>raw[i+j]===b)){start=i+marker.length;break;}
    const boundary=/boundary=(.*)/.exec((init!.headers as any)['Content-Type'])![1],tail=new TextEncoder().encode('\r\n--'+boundary+'--\r\n');
    const data=raw.slice(start,raw.length-tail.length);files.set(meta.id,{meta:{...meta,size:String(data.length)},data});
    if(lost){lost=false;throw Error('fixture lost upload reply');}return Response.json({id:meta.id});
   }
   const id=/\/files\/([^?]+)/.exec(url)?.[1],file=files.get(id||'');
   if(u.searchParams.get('alt')==='media')return file?new Response(file.data):new Response(null,{status:404});
   return file?Response.json(file.meta):new Response(null,{status:404});
  });
  await expect(runInDurableObject(stub(),async(instance)=>{await (instance as IndependentDriveStore).archive(new Date('2026-10-30'));})).rejects.toThrow();
  const result=await runInDurableObject(stub(),async(instance)=>{return (instance as IndependentDriveStore).archive(new Date('2026-10-30'));});
  expect(result).toMatchObject({files:2,records:4,d1_requests:0});expect(uploads).toBe(2);expect(files.size).toBe(2);
  await runInDurableObject(stub(),async(instance)=>{expect(await (instance as IndependentDriveStore).archive(new Date('2026-10-30'))).toMatchObject({already_archived:true});});expect(uploads).toBe(2);
 });
});
