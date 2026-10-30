// Release-only: data was read from the fixed live Sheets source by the Python gate.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {defineConfig} from 'vitest/config';
import {cloudflareTest} from '@cloudflare/vitest-plugin';
const folder=process.env.INDEPENDENT_REAL_SOURCE_DIR;
if(!folder)throw Error('INDEPENDENT_REAL_SOURCE_REQUIRED');
export default defineConfig({
 plugins:[cloudflareTest({wrangler:{configPath:'./deploy/wrangler.drive-archive.jsonc'},miniflare:{
  bindings:{ARCHIVE_ENABLED:'true'},
  serviceBindings:{OAUTH_BROKER:async()=>{throw Error('OAUTH_FORBIDDEN_IN_READ_ONLY_ACCEPTANCE');},REAL_SHEETS_FIXTURE:async(request:Request)=>{
   const section=new URL(request.url).searchParams.get('sheet');
   if(!['GSC_GUNLUK','OZET','URUNLER','SORGULAR'].includes(section||''))return new Response(null,{status:404});
   return new Response(readFileSync(resolve(folder,section+'.gviz')));
  }},
 }})],
 test:{include:['tests/independent-acceptance/*.test.ts']},
});
