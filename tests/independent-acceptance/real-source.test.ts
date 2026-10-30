import {it,expect,vi} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import type {IndependentDriveEnv} from '../../src/drive-independent';
it('accepts real Sheets through the actual D1-free report, persisted readback and SEO question',async()=>{
 const cfg=env as IndependentDriveEnv&{REAL_SHEETS_FIXTURE:Fetcher};
 expect('DB' in cfg).toBe(false);
 const spy=vi.spyOn(globalThis,'fetch').mockImplementation(async(input)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  if(url.hostname!=='docs.google.com'||!url.pathname.endsWith('/gviz/tq'))throw Error('UNEXPECTED_EXTERNAL_REQUEST');
  return cfg.REAL_SHEETS_FIXTURE.fetch(url.href);
 });
 try{
  const stub=cfg.DRIVE_ARCHIVE_STORE.get(cfg.DRIVE_ARCHIVE_STORE.idFromName('real-source-acceptance'));
  const response=await stub.fetch('https://archive.private/api/independent/report');
  const report=await response.json<any>();
  expect(response.status,report.code).toBe(200);expect(report.available).toBe(true);
  expect(report.products.length).toBeGreaterThan(0);expect(report.d1_requests).toBe(0);expect(report.stale).toBe(false);
  expect(report.source_hash).toMatch(/^[a-f0-9]{64}$/);
  const manifest=await runInDurableObject(stub,async(_instance,state)=>state.storage.get<any>('independent:snapshot:v2'));
  expect(manifest.record_count).toBeGreaterThan(0);expect(manifest.chunks).toBeGreaterThan(0);
  const readback=await (await stub.fetch('https://archive.private/api/independent/report?month='+report.month)).json<any>();
  expect(readback).toEqual(report);expect(spy).toHaveBeenCalledTimes(4);
  const answerResponse=await stub.fetch('https://archive.private/api/independent/questions',{method:'POST',body:JSON.stringify({month:report.month,question:report.products[0].title+' neden düştü?'})});
  const answer=await answerResponse.json<any>();
  expect(answerResponse.status).toBe(200);expect(answer.source_hash).toBe(report.source_hash);
  expect(answer.evidence.length).toBeGreaterThan(0);expect(answer.d1_requests).toBe(0);expect(answer.stale).toBe(false);
  console.log(JSON.stringify({real_data_acceptance:true,month:report.month,products:report.products.length,records:manifest.record_count,bytes:manifest.bytes,chunks:manifest.chunks,source_hash:report.source_hash,d1_requests:0}));
 }finally{spy.mockRestore();}
});
