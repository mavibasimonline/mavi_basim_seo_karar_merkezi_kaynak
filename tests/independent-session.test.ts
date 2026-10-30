import {describe,it,expect,vi} from 'vitest';
import {independentSession} from '../src/independent-session';
import {authenticated} from '../src/security';
const token='long-independent-admin-key-with-fifty-six-characters-xxxxxxxxxxxxxxx';
function env(result:{allowed:boolean;locked:boolean}){
 const service={fetch:vi.fn(async()=>Response.json(result))};
 return {service,context:{ADMIN_TOKEN:token,DRIVE_ARCHIVE_SERVICE:service,DB:{prepare(){throw Error('D1_SHOULD_NEVER_BE_TOUCHED')}}} as any};
}
function request(input:string){
 return new Request('https://seo.example/api/session',{method:'POST',headers:{Origin:'https://seo.example','Content-Type':'application/json','CF-Connecting-IP':'203.0.113.4'},body:JSON.stringify({token:input})});
}
describe('D1-free login',()=>{
 it('issues the existing signed session cookie without D1 and validates it',async()=>{
  const setup=env({allowed:true,locked:false});
  const result=await independentSession(request(token),setup.context);
  expect(result.status).toBe(200);
  const cookie=result.headers.get('set-cookie')!;
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('SameSite=Strict');
  const forwarded=new Request('https://seo.example/api/report',{headers:{Cookie:cookie.split(';')[0]}});
  expect(await authenticated(forwarded,setup.context)).toBe(true);
  expect(setup.service.fetch).toHaveBeenCalledTimes(1);
 });
 it('never creates session for a wrong secret or locked client',async()=>{
  const wrong=env({allowed:false,locked:false});
  const denied=await independentSession(request('incorrect'),wrong.context);
  expect(denied.status).toBe(401);
  expect(denied.headers.get('set-cookie')).toBeNull();
  const locked=env({allowed:false,locked:true});
  expect((await independentSession(request(token),locked.context)).status).toBe(429);
 });
 it('fails closed if the private quota guard is unavailable',async()=>{
  const setup=env({allowed:true,locked:false});
  setup.service.fetch.mockRejectedValueOnce(new Error('down'));
  await expect(independentSession(request(token),setup.context)).rejects.toThrow('down');
 });
});