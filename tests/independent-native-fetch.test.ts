import {it,expect} from 'vitest';
import {IndependentGscCollector} from '../src/independent-gsc';

it('uses the real Workers fetch receiver correctly before any network request',async()=>{
 const native=globalThis.fetch;
 await expect(native.call({},'ftp://fixture.invalid/path')).rejects.toThrow('Illegal invocation');
 // An unsupported protocol exercises the real runtime receiver check with no
 // external request. Only its normal URL rejection unlocks the GSC fixture.
 const nativeCheckedTransport=async function(this:unknown){
  try{await native.call(this,'ftp://fixture.invalid/path');}
  catch(error){
   if(error instanceof TypeError&&error.message==='Fetch API cannot load: ftp://fixture.invalid/path')return Response.json({responseAggregationType:'byPage',rows:[{keys:['2026-11-01','https://mavibasim.com/brosur','tur','DESKTOP'],clicks:1,impressions:10,ctr:.1,position:4}]});
   throw error;
  }
  throw Error('TEST native protocol unexpectedly accepted');
 } as typeof fetch;
 const values=new Map<string,unknown>();
 const store={get:async<T>(key:string)=>values.get(key) as T|undefined,put:async(key:string,value:unknown)=>{values.set(key,structuredClone(value));}} as any;
 const result=await new IndependentGscCollector(store,'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',async()=> 'fixture-native-fetch-token',nativeCheckedTransport).tick(new Date('2026-11-04T08:00:00Z'));
 expect(result).toMatchObject({status:'complete',rows:1,d1_requests:0});
 expect(values.has('gsc:daily:2026-11-01:page')).toBe(true);
});
