import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const origin = process.env.TEST_ORIGIN || 'http://localhost:3000';
const browser = await chromium.launch({headless:true});
const context = await browser.newContext({viewport:{width:1280,height:900},colorScheme:'dark'});
const page = await context.newPage(); const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await mkdir('artifacts',{recursive:true});
try {
 for(const path of ['/','/blogs','/drawings','/project','/credits']) {
   const response=await page.goto(origin+path,{waitUntil:'networkidle'});assert.equal(response.status(),200);
   await page.screenshot({path:'artifacts/'+(path.slice(1)||'home')+'.png',fullPage:true});
   assert.equal(await page.locator('a[href$=".html"]').count(),0);
 }
 await page.goto(origin+'/blogs'); const post=await page.locator('.blog-list a').first().getAttribute('href');await page.goto(origin+post,{waitUntil:'networkidle'});
 await page.screenshot({path:'artifacts/blog-post.png',fullPage:true});
 assert.equal(await page.locator('.blog-body').count(),1);
 await page.goto(origin+'/:3');await page.locator('[name=username]').fill(process.env.ADMIN_USERNAME);await page.locator('[name=password]').fill(process.env.ADMIN_PASSWORD);await page.getByRole('button',{name:'Log in',exact:true}).click();await page.waitForURL(origin+'/admin');
 await page.goto(origin+'/admin/blogs/new');await page.locator('[name=title]').fill('Browser preview');await page.locator('#bbcode').fill('[b]Safe preview[/b][img]/media/star.png[/img]');await page.getByRole('button',{name:'Preview',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#preview-frame').hidden===false);
 assert.equal(await page.frameLocator('#preview-frame').locator('strong').textContent(),'Safe preview');
 await page.screenshot({path:'artifacts/admin-editor.png',fullPage:true});
 await page.getByRole('button',{name:'Logout',exact:true}).click();await page.waitForURL(origin+'/:3');
 await page.setViewportSize({width:390,height:844});await page.goto(origin+'/blogs',{waitUntil:'networkidle'});await page.screenshot({path:'artifacts/mobile-blogs.png',fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 const report={origin,passed:true,consoleErrors:[...new Set(errors)]};await writeFile('artifacts/browser-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {await browser.close();}
