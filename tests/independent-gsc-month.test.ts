import {describe,it,expect} from 'vitest';
import {verifiedGscMonth} from '../src/independent-gsc-report';
const storage=()=>{const m=new Map<string,unknown>();return {get:async<T>(key:string)=>m.get(key) as T|undefined,put:async(key:string,value:unknown)=>{m.set(key,value);}} as any;};
describe('independent monthly GSC evidence',()=>{
 it('does not manufacture totals from incomplete page coverage',async()=>{
  const result=await verifiedGscMonth(storage(),'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=','2026-09',new Date('2026-10-31T12:00:00Z'));
  expect(result).toMatchObject({available:false,days_verified:0,expected_days:30,d1_requests:0});
  expect(result.missing_days).toHaveLength(30);
 });
 it('rejects active and future periods',async()=>{
  await expect(verifiedGscMonth(storage(),'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=','2026-10',new Date('2026-10-31'))).rejects.toThrow('GSC_MONTH_NOT_CLOSED');
  await expect(verifiedGscMonth(storage(),'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=','invalid')).rejects.toThrow('INVALID_MONTH');
 });
});
