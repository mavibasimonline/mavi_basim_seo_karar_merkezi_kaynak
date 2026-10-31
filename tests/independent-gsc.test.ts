import {describe,it,expect} from 'vitest';
import {validateGscPage,selectGscDay} from '../src/independent-gsc';
const row={keys:['2026-10-20','https://mavibasim.com/brosur','tur','DESKTOP'],clicks:1,impressions:10,ctr:0.1,position:4};
describe('independent GSC validation',()=>{
 it('validates a real byPage dimension set without changing the query scope',()=>{
  expect(validateGscPage({responseAggregationType:'byPage',rows:[row]},'2026-10-20','page',0).rows).toHaveLength(1);
  expect(validateGscPage({responseAggregationType:'byPage',rows:[{...row,keys:[row.keys[0],row.keys[1],'broşür baskı',row.keys[2],row.keys[3]]}]},'2026-10-20','query',0).rows[0].query).toBe('broşür baskı');
 });
 it('rejects wrong scopes, invalid metrics and duplicate source identities',()=>{
  expect(()=>validateGscPage({responseAggregationType:'byProperty',rows:[row]},'2026-10-20','page',0)).toThrow();
  expect(()=>validateGscPage({responseAggregationType:'byPage',rows:[{...row,clicks:20}]},'2026-10-20','page',0)).toThrow();
  expect(()=>validateGscPage({responseAggregationType:'byPage',rows:[row,row]},'2026-10-20','page',0)).toThrow();
 });
 it('does not infer incomplete query coverage as zero',()=>{
  expect(validateGscPage({responseAggregationType:'byPage',rows:[]},'2026-10-20','query',0)).toMatchObject({rows:[],next:null});
  expect(selectGscDay(new Date('2026-10-31T12:00:00Z'))).toBe('2026-10-28');
 });
});