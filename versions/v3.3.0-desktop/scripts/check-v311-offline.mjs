import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const out='artifacts/v311-ui';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({serviceWorkers:'allow',viewport:{width:390,height:844}});
const page=await context.newPage();const errors=[],external=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(!new URL(r.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/))external.push(r.url());});
try{
 await page.goto('http://127.0.0.1:5205/#/home');
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;await document.fonts.load('16px BridgeHan','桥牌分析');await document.fonts.load('600 20px BridgeSerif','AKQJ109');await document.fonts.load('16px Inter','123IMP');await document.fonts.ready;});
 await page.waitForFunction(async()=>{const keys=await caches.keys();for(const k of keys){const urls=(await(await caches.open(k)).keys()).map(x=>x.url);if(urls.some(x=>x.includes('SourceHanSansCN-VF.woff2'))&&urls.some(x=>x.includes('InterVariable.woff2'))&&urls.some(x=>x.includes('SourceSerif4-Roman.woff2')))return true;}return false;},{timeout:60000});
 await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 await context.setOffline(true);await page.reload();
 await page.getByRole('link',{name:'单机游戏',exact:true}).waitFor();
 const fonts=await page.evaluate(async()=>{await document.fonts.load('16px BridgeHan','桥牌分析');await document.fonts.load('600 20px BridgeSerif','AKQJ109');await document.fonts.load('16px Inter','123IMP');return {han:document.fonts.check('16px BridgeHan','桥牌分析'),serif:document.fonts.check('600 20px BridgeSerif','AKQJ109'),inter:document.fonts.check('16px Inter','123IMP'),controlled:!!navigator.serviceWorker.controller};});
 if(!Object.values(fonts).every(Boolean)||errors.length||external.length)throw Error(JSON.stringify({fonts,errors,external}));
 await page.screenshot({path:out+'/offline-local-fonts.png',fullPage:true});
 const html=readFileSync('dist/index.html','utf8'),bundle=html.match(/assets\/(index-[\w-]+\.js)/)[1],stylesheet=html.match(/assets\/(index-[\w-]+\.css)/)[1];
 const css=await page.evaluate(async name=>{const href=[...document.styleSheets].map(x=>x.href).find(x=>x?.endsWith(name));if(!href)throw Error('Final stylesheet not loaded');const bytes=await(await fetch(href)).arrayBuffer();return{href,sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('')};},stylesheet);
 if(css.sha256!==createHash('sha256').update(readFileSync('dist/assets/'+stylesheet)).digest('hex'))throw Error('Offline CSS differs from final distribution');
 const report={passed:true,fonts,errors,externalRequests:external,bundle,bundleSHA256:createHash('sha256').update(readFileSync('dist/assets/'+bundle)).digest('hex'),stylesheet,css};
 writeFileSync(out+'/offline.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
