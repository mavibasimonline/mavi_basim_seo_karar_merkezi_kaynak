import {test,expect,Route} from '@playwright/test';
import {readFileSync} from 'node:fs';
const token=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(s=>s.startsWith('ADMIN_TOKEN='))!.slice(12);
test('a delayed anonymous startup response cannot cancel a successful new login',async({page})=>{
 let initial:Route|undefined,seen!:()=>void;const started=new Promise<void>(r=>seen=r);
 await page.route('**/api/status',async route=>{if(!initial){initial=route;seen();}else await route.continue();});
 await page.route('**/api/session',async route=>{
  const response=await route.fetch();
  await initial!.fulfill({status:401,json:{error:'TEST delayed anonymous startup'}}).catch(()=>{});
  await new Promise(resolve=>setTimeout(resolve,200));
  await route.fulfill({response});
 });
 await page.goto('/');await started;
 await page.getByLabel('Erişim anahtarı').fill(token);
 await page.getByRole('button',{name:'Giriş yap',exact:true}).click();
 await expect(page.locator('#app')).toBeVisible();
 await expect(page.locator('#loginScreen')).toBeHidden();
});
