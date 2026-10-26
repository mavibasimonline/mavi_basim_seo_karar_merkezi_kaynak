import {describe,it,expect} from 'vitest';
import {reviewPerformance} from '../src/gsc-review-performance';
const now=new Date('2026-10-27T00:00:00Z');
const product={url:'https://mavibasim.com/perakende-satis-fisi',name:'Perakende Satış Fişi',decision:'Koru',
 current:{clicks:15,impressions:500,ctr:0.03,position:10},previous:{clicks:12,impressions:400,ctr:0.03,position:11},
 missing:[],evidence:[{id:'gsc'}],queries:[{protect:true}]};
const report={month:'2026-09',created_at:'2026-10-26T23:00:00Z',engine_version:'1.2.2',
 period:{start:'2026-09-01',end:'2026-09-30'},previous_period:{start:'2026-08-01',end:'2026-08-31'},missing:[],products:[product]};
describe('GSC cohort performance safety',()=>{
 it('rejects no report, incomplete coverage and old cache',()=>{
  expect(reviewPerformance(null,'2026-09',now).available).toBe(false);
  expect(reviewPerformance({...report,missing:['GSC gap']},'2026-09',now).available).toBe(false);
  expect(reviewPerformance({...report,created_at:'2026-10-20T00:00:00Z'},'2026-09',now).available).toBe(false);
 });
 it('preserves measured performance without calling link counts proof of failure',()=>{
  const result=reviewPerformance(report,'2026-09',now);
  expect(result.available).toBe(true);
  if(!('rows' in result))throw Error('missing rows');
  expect(result.rows.find(r=>r.path==='/perakende-satis-fisi')).toMatchObject({available:true,decision:'Koru',protected_queries:1});
  expect(result.rows.find(r=>r.path==='/ardahan-matbaa')).toMatchObject({available:false});
 });
 it('rejects incomplete per-page evidence',()=>{
  const result=reviewPerformance({...report,products:[{...product,evidence:[]}]},'2026-09',now);
  if(!('rows' in result))throw Error('missing rows');
  expect(result.rows[0].available).toBe(false);
 });
});
