import {describe,it,expect} from 'vitest';
import {requestBodyLimit,DEFAULT_REQUEST_BODY_LIMIT,TAYFUN_AI_REQUEST_BODY_LIMIT} from '../src/request-body-limit';
const make=(path:string,method='POST')=>({url:'https://mavi-basim-seo-prod.mavibasimonline.workers.dev'+path,method});
describe('Main Worker route scoped request body limits',()=>{
 it('accepts the observed 27 KB Afiş SEO import on the exact protected API path',()=>{
  expect(requestBodyLimit(make('/api/independent/tayfun-ai'))).toBe(TAYFUN_AI_REQUEST_BODY_LIMIT);
  expect(TAYFUN_AI_REQUEST_BODY_LIMIT).toBeGreaterThan(27_278);
 });
 it('retains the 16 KB guard for other routes including other archive routes',()=>{
  for(const path of ['/api/session','/api/independent/tayfun','/api/independent/tayfun-ai/context','/api/independent/tayfun-ai/monitor','/api/independent/tayfun/verified-baseline'])
   expect(requestBodyLimit(make(path))).toBe(DEFAULT_REQUEST_BODY_LIMIT);
  expect(requestBodyLimit(make('/api/independent/tayfun-ai','GET'))).toBe(DEFAULT_REQUEST_BODY_LIMIT);
  expect(requestBodyLimit(make('/api/independent/tayfun-ai/extra'))).toBe(DEFAULT_REQUEST_BODY_LIMIT);
 });
});
