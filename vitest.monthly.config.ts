import {defineConfig} from 'vitest/config';
import {cloudflareTest} from '@cloudflare/vitest-plugin';
export default defineConfig({plugins:[cloudflareTest({wrangler:{configPath:'./deploy/wrangler.monthly-store.jsonc'},miniflare:{bindings:{STORE_ENABLED:'true'},serviceBindings:{SOURCE:async()=>Response.json({held:true,code:'D1_READ_BUDGET_WAIT',reason:'LOCAL_READ_LIMIT'},{status:429})}}})],test:{include:['tests/monthly-store/*.test.ts']}});
