import {describe,it,expect,vi} from 'vitest';
import {configured} from './helpers';
import app from '../src/index';
describe('independent Drive routing never touches D1',()=>{
 function config(){
  const fetcher=vi.fn(async(request:Request)=>{expect(request.redirect).toBe('manual');return Response.json({connected:false,d1_requests:0});});
  const env={...configured({D1_READ_GUARD_ENABLED:'true'}),DRIVE_ARCHIVE_SERVICE:{fetch:fetcher} as any};
  Object.defineProperty(env,'DB',{get(){throw Error('FORBIDDEN_D1_ACCESS');}});return {env,fetcher};
 }
 it('serves health and owner status/start and routes the new callback with zero D1 reads or writes',async()=>{
  const {env}=config();
  for(const [path,method,authorized] of [['/api/drive-independent/health','GET',false],['/api/drive-independent/status','GET',true],['/api/drive-independent/start','POST',true],['/api/oauth/google/callback?state=drive2.fixture','GET',false]] as const){
   const headers:Record<string,string>={Origin:'https://app.example'};if(authorized)headers.Authorization='Bearer '+env.ADMIN_TOKEN;
   const response=await app.fetch(new Request('https://app.example'+path,{method,headers}),env);expect(response.status).toBe(200);
  }
 });
 it('preserves the owner session and CSRF boundary before forwarding to the private archive Worker',async()=>{
  const {env,fetcher}=config();
  expect((await app.fetch(new Request('https://app.example/api/drive-independent/status'),env)).status).toBe(401);
  expect((await app.fetch(new Request('https://app.example/api/drive-independent/start',{method:'POST',headers:{Authorization:'Bearer '+env.ADMIN_TOKEN,Origin:'https://other.example'}}),env)).status).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
 });
});
