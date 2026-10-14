import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../..', import.meta.url)));
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const origin = process.env.TEST_ORIGIN || 'http://localhost:3000';
const browser = await chromium.launch({headless:true});
const context = await browser.newContext({viewport:{width:1280,height:900},colorScheme:'dark'});
const page = await context.newPage(); const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await mkdir('systems/artifacts',{recursive:true});
try {
 for(const path of ['/','/blogs','/all_blog','/drawings','/project','/credits']) {
   const response=await page.goto(origin+path,{waitUntil:'networkidle'});assert.equal(response.status(),200);
   await page.screenshot({path:'systems/artifacts/'+(path.slice(1)||'home')+'.png',fullPage:true});
   assert.equal(await page.locator('a[href$=".html"]').count(),0);
 }
 await page.goto(origin+'/blogs');assert.equal(await page.locator('user').count(),1);
 await page.getByRole('link',{name:'|Click here to see all post.|',exact:true}).click();await page.waitForURL(origin+'/all_blog');
 assert.equal(await page.locator('user').count(),35);
 assert.equal(await page.locator('.comment-form, .blog-list').count(),0);
 for(const path of ['/:3','/admin','/admin/drawings','/admin/uploads','/api/admin/uploads','/admin.js','/cms.css']) assert.equal((await context.request.get(origin+path)).status(),404);
 await page.setViewportSize({width:390,height:844});await page.goto(origin+'/blogs',{waitUntil:'networkidle'});await page.screenshot({path:'systems/artifacts/mobile-blogs.png',fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 const report={origin,passed:true,consoleErrors:[...new Set(errors)]};await writeFile('systems/artifacts/browser-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {await browser.close();}
