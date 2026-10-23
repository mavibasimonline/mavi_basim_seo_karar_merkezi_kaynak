import {beforeEach,it,expect} from 'vitest';
import {init,env} from './helpers';
import {analyze,saveAnalysis,lastCompleteMonth} from '../src/analysis';
import {recordAppliedChange,measureOneOutcome} from '../src/outcomes';
import {insertRows} from '../src/sync';

beforeEach(init);
it('records an attested change and all follow-up windows without publishing to site',async()=>{
  const report=await analyze(env,lastCompleteMonth());await saveAnalysis(env,report);
  const id=await recordAppliedChange(env,{recommendation_id:report.id+':brosur',applied_at:'2026-01-10T12:00:00Z',evidence:'Operatörün CMS değişiklik kaydı',old:{title:'Eski'},new:{title:'Yeni'}});
  const windows=await env.DB.prepare('SELECT days,status FROM outcome_windows WHERE applied_change_id=? ORDER BY days').bind(id).all();expect(windows.results.map(r=>r.days)).toEqual([7,28,60,90]);
  const stored=await env.DB.prepare('SELECT evidence FROM applied_changes WHERE id=?').bind(id).first<{evidence:string}>();expect(JSON.parse(stored!.evidence).publication_time_independently_verified).toBe(false);
  await measureOneOutcome(env,new Date('2026-03-01T00:00:00Z'));expect((await env.DB.prepare("SELECT count(*) AS n FROM outcome_windows WHERE status='measured'").first<{n:number}>())?.n).toBe(0);
});
it('measures complete windows against other pages, excludes application day and avoids causal claims',async()=>{
  const report=await analyze(env,lastCompleteMonth());await saveAnalysis(env,report);
  const id=await recordAppliedChange(env,{recommendation_id:report.id+':brosur',applied_at:'2026-01-10T12:00:00Z',evidence:'Operatörün CMS değişiklik kaydı',old:{},new:{}});
  const rows=[];const cover=[];
  for(let i=-7;i<=7;i++){
    if(i===0)continue;
    const day=new Date(Date.UTC(2026,0,10+i)).toISOString().slice(0,10);
    cover.push({provider:'gsc',day,scope:'page',dataset_id:day,complete:1,query_partial:0,row_count:2,fetched_at:'2026-02-01T00:00:00Z',notes:'TEST FIXTURE'});
    for(const page of ['https://mavibasim.com/brosur','https://mavibasim.com/el-ilani'])rows.push({dataset_id:day,date:day,page,country:'tur',device:'MOBILE',clicks:i<0?10:20,impressions:100,ctr:i<0?0.1:0.2,position:2});
  }
  await env.DB.batch([...insertRows(env.DB,'dataset_coverage',cover),...insertRows(env.DB,'gsc_daily_by_page',rows)]);
  await measureOneOutcome(env,new Date('2026-02-01T00:00:00Z'));
  const measured=await env.DB.prepare('SELECT status,result_json FROM outcome_windows WHERE applied_change_id=? AND days=7').bind(id).first<{status:string;result_json:string}>();
  expect(measured?.status).toBe('measured');const result=JSON.parse(measured!.result_json);expect(result.before).toEqual(expect.arrayContaining([expect.objectContaining({cohort:'target',clicks:70})]));expect(result.after).toEqual(expect.arrayContaining([expect.objectContaining({cohort:'target',clicks:140})]));expect(result.limitation).toContain('nedensellik');
});
