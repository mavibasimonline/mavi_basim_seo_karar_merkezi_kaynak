import {describe,it,expect,vi} from 'vitest';
import {gscReviewOverview} from '../src/gsc-review-overview';
import type {Env} from '../src/types';

describe('read-only 26-page GSC overview',()=>{
  it('marks all 26 pages as awaiting evidence if crawl and GSC records are absent',async()=>{
    const queries:string[]=[];
    const db={
      prepare:(sql:string)=>{queries.push(sql);return {
        bind:()=>({first:async()=>null,all:async()=>({results:[]})}),
        all:async()=>({results:[]}),
      };}
    };
    const report=await gscReviewOverview({DB:db} as unknown as Env,'2026-09');
    expect(report.rows).toHaveLength(26);
    expect(report.totals).toMatchObject({products:8,cities:18,observed_target_snapshots:0});
    expect(report.rows.every(x=>x.status==='Veri bekle')).toBe(true);
    expect(report.rows.every(x=>x.observed_inbound_sources.length===0)).toBe(true);
    expect(report.rows.every(x=>x.recommendation.includes('otomatik değişiklik yapma'))).toBe(true);
    expect(queries.every(q=>/^SELECT\b/i.test(q.trim()))).toBe(true);
  });
  it('does not mistake one observed source for a complete site-wide count',async()=>{
    const source={url:'https://mavibasim.com/',snapshot_json:JSON.stringify({status:200,links:['https://mavibasim.com/perakende-satis-fisi']})};
    const db={prepare:(sql:string)=>({bind:()=>({first:async()=>null,all:async()=>({results:sql.includes('MAX(rowid)')?[source]:[]})}),all:async()=>({results:sql.includes('MAX(rowid)')?[source]:[]})})};
    const result=await gscReviewOverview({DB:db} as unknown as Env);
    const page=result.rows.find(x=>x.path==='/perakende-satis-fisi');
    expect(page?.observed_inbound_sources).toEqual(['https://mavibasim.com']);
    expect(page?.status).toBe('Veri bekle');
    expect(page?.inbound_source_scope).toMatch(/100 farklı URL/);
  });
});
