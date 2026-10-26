import {it,expect,beforeEach} from 'vitest';
import {gscRowIssue,validateGscRow,GscRow} from '../src/providers';
import {init,connected,enqueue,env,fetcher} from './helpers';
import {claimJob,processJob} from '../src/sync';
const DAY='2026-08-18';
const good:GscRow={date:DAY,page:'https://mavibasim.com/brosur',country:'tur',device:'MOBILE',clicks:1,impressions:10,ctr:0.1,position:3};
beforeEach(init);
it.each([
 ['DATE',{date:'2026-08-17'}],['PAGE_ORIGIN',{page:'https://other.example/private'}],
 ['PAGE_ORIGIN',{page:'http://mavibasim.com.evil.example/private'}],['PAGE_ORIGIN',{page:'https://www.mavibasim.com.evil.example/private'}],
 ['COUNTRY',{country:'??'}],['DEVICE',{device:'UNKNOWN'}],['METRIC_NUMBER',{ctr:NaN}],
 ['COUNTS',{clicks:20}],['COUNTS',{impressions:1.5}],['METRIC_RANGE',{position:-1}],
 ['CTR_RATIO',{ctr:0.2}],['QUERY',{query:'   '}],
] as [string,Partial<GscRow>][])('records only %s, without leaking rejected values',async(category,patch)=>{
 const row={...good,...patch};expect(gscRowIssue(row,DAY)).toBe(category);
 try{validateGscRow(row,DAY);throw Error('expected rejection');}catch(e){
  expect((e as Error).message).toBe('INVALID_GSC_ROW_'+category);
  expect((e as Error).message).not.toContain(row.page);expect((e as {retryable:boolean}).retryable).toBe(false);
 }
});
it('accepts identical valid data, zero clicks and an explicit zero-impression row',()=>{
 expect(gscRowIssue(good,DAY)).toBeNull();
 expect(gscRowIssue({...good,clicks:0,ctr:0},DAY)).toBeNull();
 expect(gscRowIssue({...good,clicks:0,impressions:0,ctr:0},DAY)).toBeNull();
});
it('leaves invalid jobs blocked and the last complete dataset unchanged',async()=>{
 const cfg=await connected();await enqueue('gsc','page',DAY);
 await env.DB.prepare("INSERT INTO dataset_coverage VALUES('gsc',?,'page','previous-valid',1,0,1,?,'TEST previous evidence')").bind(DAY,new Date().toISOString()).run();
 const job=(await claimJob(cfg))!;
 await processJob(cfg,job,fetcher(async()=>Response.json({responseAggregationType:'byPage',rows:[{keys:[DAY,good.page,'tur','MOBILE'],clicks:1,impressions:10,ctr:0.4,position:3}]})));
 expect(await env.DB.prepare('SELECT status,error_code,attempts FROM sync_jobs').first()).toMatchObject({status:'blocked',error_code:'INVALID_GSC_ROW_CTR_RATIO',attempts:1});
 expect(await env.DB.prepare('SELECT dataset_id,complete FROM dataset_coverage').first()).toMatchObject({dataset_id:'previous-valid',complete:1});
 expect(await claimJob(cfg)).toBeNull();
});
