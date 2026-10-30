import {beforeEach,it,expect} from 'vitest';
import {init,env} from './helpers';
import worker from '../src/index';
beforeEach(init);
it('authenticated cached analysis/status/performance/questions paths touch no D1 even when every DB access throws',async()=>{
 const calls:string[]=[];const cfg={...env,MONTHLY_ANALYSES:{fetch:async(request:Request)=>{calls.push(new URL(request.url).pathname);return Response.json({snapshot:{verified:true,d1_requests:0},month:'2026-09'});}}};
 Object.defineProperty(cfg,'DB',{get(){throw Error('FORBIDDEN_D1_ACCESS');}});
 for(const path of ['/api/report?month=2026-09','/api/status','/api/performance?month=2026-09','/api/questions']){
  const request=new Request('https://app.example'+path,{method:path==='/api/questions'?'POST':'GET',headers:{Authorization:'Bearer '+env.ADMIN_TOKEN,Origin:'https://app.example'},body:path==='/api/questions'?JSON.stringify({question:'Broşür Eylül performansı nedir?',month:'2026-09'}):undefined});
  expect((await worker.fetch(request,cfg)).status).toBe(200);
 }
 expect(calls).toEqual(['/report','/status','/performance','/questions']);
});
it('cached evidence is never exposed to anonymous or cross-origin callers',async()=>{
 let calls=0;const cfg={...env,MONTHLY_ANALYSES:{fetch:async()=>{calls++;return Response.json({});}}};
 expect((await worker.fetch(new Request('https://app.example/api/report?month=2026-09'),cfg)).status).toBe(401);
 expect((await worker.fetch(new Request('https://app.example/api/questions',{method:'POST',headers:{Authorization:'Bearer '+env.ADMIN_TOKEN,Origin:'https://wrong.example'},body:'{}'}),cfg)).status).toBe(403);expect(calls).toBe(0);
});
