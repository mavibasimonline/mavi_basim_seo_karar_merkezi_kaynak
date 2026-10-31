import {describe,it,expect,vi} from 'vitest';
import {independentRefreshDue,refreshIndependentSheets} from '../src/independent-refresh';

describe('independent scheduled Sheets refresh',()=>{
 it('runs on six-hour UTC slots only',()=>{
  expect(independentRefreshDue(new Date('2026-10-31T00:00:00Z'))).toBe(true);
  expect(independentRefreshDue(new Date('2026-10-31T06:00:00Z'))).toBe(true);
  expect(independentRefreshDue(new Date('2026-10-31T06:15:00Z'))).toBe(false);
  expect(independentRefreshDue(new Date('2026-10-31T07:00:00Z'))).toBe(false);
 });
 it('uses only the private service without D1 and requires fresh persisted proof',async()=>{
  const fetch=vi.fn(async()=>Response.json({ok:true,stale:false,source_hash:'a'.repeat(64),captured_at:'2026-10-31T06:00:00Z',records:1542,d1_requests:0}));
  const result=await refreshIndependentSheets({DRIVE_ARCHIVE_SERVICE:{fetch} as unknown as Fetcher},new Date('2026-10-31T06:00:00Z'));
  expect(result.d1_requests).toBe(0);
  expect(fetch).toHaveBeenCalledWith('https://archive.private/api/internal/independent-refresh',{method:'POST'});
 });
 it('rejects stale, empty, unverified and D1-dependent responses',async()=>{
  for(const record of [
   {ok:true,stale:true,source_hash:'a'.repeat(64),captured_at:'2026-10-31T06:00:00Z',records:1542,d1_requests:0},
   {ok:true,stale:false,source_hash:'a'.repeat(64),captured_at:'2026-10-31T06:00:00Z',records:0,d1_requests:0},
   {ok:true,stale:false,source_hash:'no',captured_at:'2026-10-31T06:00:00Z',records:1542,d1_requests:0},
   {ok:true,stale:false,source_hash:'a'.repeat(64),captured_at:'2026-10-29T06:00:00Z',records:1542,d1_requests:0},
   {ok:true,stale:false,source_hash:'a'.repeat(64),captured_at:'2026-10-31T06:00:00Z',records:1542,d1_requests:1}
  ])await expect(refreshIndependentSheets({DRIVE_ARCHIVE_SERVICE:{fetch:async()=>Response.json(record)} as unknown as Fetcher},new Date('2026-10-31T06:00:00Z'))).rejects.toThrow();
  await expect(refreshIndependentSheets({},new Date('2026-10-31T06:00:00Z'))).rejects.toThrow();
 });
});
