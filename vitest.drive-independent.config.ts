import {defineConfig} from 'vitest/config';
import {cloudflareTest} from '@cloudflare/vitest-plugin';
export default defineConfig({
 plugins:[cloudflareTest({wrangler:{configPath:'./deploy/wrangler.drive-archive.jsonc'},miniflare:{
  bindings:{ARCHIVE_ENCRYPTION_KEY:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',ARCHIVE_ENABLED:'true'},
  serviceBindings:{OAUTH_BROKER:async(request:Request)=>{
   const path=new URL(request.url).pathname;
   if(path==='/config')return Response.json({client_id:'fixture-drive-client',redirect_uri:'https://app.example/api/oauth/google/callback'});
   if(path==='/refresh-gsc')return Response.json({access_token:'fixture-gsc-valid-access-token',expires_in:3600,scope:'https://www.googleapis.com/auth/webmasters.readonly'});
   return Response.json({access_token:'fixture-drive-access',refresh_token:'fixture-drive-refresh',expires_in:3600,scope:'https://www.googleapis.com/auth/drive.file'});
  }},
 }})],
 test:{include:['tests/drive-independent/*.test.ts']},
});
