import {describe,it,expect} from 'vitest';
import {monthlyGscHealth} from '../src/gsc-monthly-health';
import type {DailyProof} from '../src/independent-gsc';

function storage(){
 const map=new Map<string,unknown>();
 return {map,get:async<T>(key:string)=>map.get(key) as T|undefined};
}
function proof(day:string):DailyProof{
 return {day,scope:'page',generation:'fixture',captured_at:day+'T23:00:00.000Z',
  rows:1,pages:1,query_partial:false,source:'GSC Search Analytics API',d1_requests:0,collection_complete:true,
  page_proofs:[{index:0,count:1,bytes:250,chunks:1,sha256:'a'.repeat(64)}]};
}
function fillMonth(db:ReturnType<typeof storage>,month:string,upto:number){
 for(let i=1;i<=upto;i++){
  const day=month+'-'+String(i).padStart(2,'0');
  db.map.set('gsc:daily:'+day+':page',proof(day));
 }
}
describe('automatic GSC monthly health',()=>{
 it('only expects Google-finalized eligible days and never counts future days as missing',async()=>{
  const db=storage();fillMonth(db,'2026-11',3);fillMonth(db,'2026-10',31);fillMonth(db,'2026-09',30);
  const report=await monthlyGscHealth(db,new Date('2026-11-07T10:00:00Z'));
  expect(report.latest_eligible_day).toBe('2026-11-04');
  expect(report.months[0]).toMatchObject({month:'2026-11',month_closed:false,eligible_days:4,verified_page_days:3,state:'kismi',missing_page_days:['2026-11-04'],overdue_page_days:[]});
  expect(report.months[1]).toMatchObject({month:'2026-10',month_closed:true,eligible_days:31,verified_page_days:31,state:'tam'});
  expect(report.months[2]).toMatchObject({month:'2026-09',state:'tam'});
  expect(report.overdue_count).toBe(0);
 });
 it('alarms on old uncollected days without fabricating zero traffic',async()=>{
  const db=storage();fillMonth(db,'2026-11',1);
  const report=await monthlyGscHealth(db,new Date('2026-11-07T10:00:00Z'),1);
  expect(report.months[0].overdue_page_days).toEqual(['2026-11-02','2026-11-03']);
  expect(report.months[0].missing_page_days).toContain('2026-11-04');
  expect(report.months[0].state).toBe('eksik');expect(report.overdue_count).toBe(2);
 });
 it('automatically recognizes November as complete once all finalized November daily proofs exist',async()=>{
  const db=storage();fillMonth(db,'2026-11',30);
  const report=await monthlyGscHealth(db,new Date('2026-12-04T12:00:00Z'),2);
  expect(report.months[1]).toMatchObject({month:'2026-11',month_closed:true,eligible_days:30,verified_page_days:30,state:'tam'});
 });
 it('ignores malformed or incomplete manifest pointers',async()=>{
  const db=storage();fillMonth(db,'2026-11',4);
  const broken=proof('2026-11-02');broken.query_partial=true;
  db.map.set('gsc:daily:2026-11-02:page',broken);
  const report=await monthlyGscHealth(db,new Date('2026-11-07T10:00:00Z'),1);
  expect(report.months[0].verified_page_days).toBe(3);
  expect(report.months[0].overdue_page_days).toContain('2026-11-02');
 });
});
