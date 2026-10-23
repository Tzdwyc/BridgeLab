import { chromium } from '@playwright/test';
import fs from 'node:fs';
const browser = await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const report=[];
const errors=[];
for(const [width,height] of [[360,800],[390,844],[844,390],[1280,800],[1440,900]]){
 const page=await browser.newPage({viewport:{width,height}});
 page.on('pageerror',error=>errors.push({width,height,error:error.message}));
 for(const route of ['deals','analysis']){
  await page.goto(`http://127.0.0.1:4178/#/${route}`,{waitUntil:"domcontentloaded",timeout:120000});
  const testid=route==='deals'?'deal-editor':'analysis-page';
  await page.getByTestId(testid).waitFor({timeout:120000});
  await page.waitForTimeout(700);
  const views=route==='deals'?['edit','library']:['board','tricks','candidates','dd','routes','auction','notes:0','notes:1','notes:2','notes:3','notes:4'];
  for(const view of views){
   if(route==='deals'&&view==='library') await page.getByRole('tab',{name:/保存库/}).click();
   if(route==='analysis') await page.getByTestId(`analysis-view-${view.split(":")[0]}`).click();
   if(route==='analysis'&&view.startsWith('notes:')) await page.getByRole('tablist',{name:'结果与说明分页'}).getByRole('tab').nth(Number(view.split(':')[1])).click();
   await page.waitForTimeout(100);
   const data=await page.evaluate(({testid,route,view})=>{
    const root=document.querySelector(`[data-testid="${testid}"]`);
    const panel=document.querySelector(`[data-testid="${route==='analysis'?'analysis-active-panel':view==='library'?'deal-library':'deal-editor-panel'}"]`);
    const rect=root.getBoundingClientRect();
    const overflow=[...root.querySelectorAll('*')].filter(e=>{const st=getComputedStyle(e);return st.display!=='none'&&e.clientHeight>0&&e.scrollHeight>e.clientHeight+2&& !['svg','path'].includes(e.tagName)&&st.position!=='absolute'}).map(e=>({tag:e.tagName,cls:e.className,h:e.clientHeight,sh:e.scrollHeight,overflow:getComputedStyle(e).overflow}));
    const outside=[...root.querySelectorAll('button,input,select,a')].filter(e=>e.getClientRects().length).map(e=>({e,r:e.getBoundingClientRect()})).filter(({r})=>r.left<-.5||r.right>innerWidth+.5||r.bottom>innerHeight+.5||r.top<-.5).map(({e,r})=>({text:e.textContent,top:r.top,bottom:r.bottom}));
    return {body:[document.documentElement.clientHeight,document.documentElement.scrollHeight],root:[rect.top,rect.bottom,root.clientHeight,root.scrollHeight],panel:panel?[panel.clientHeight,panel.scrollHeight]:null,overflow,outside};
   },{testid,route,view});
   report.push({width,height,route,view,...data});
   if(view==='board'||(route==='deals'&&view==='edit')) await page.screenshot({path:`artifacts/workbench-${route}-${width}x${height}.png`});
  }
 }
 await page.close();
}
fs.writeFileSync('artifacts/workbench-layout-report.json',JSON.stringify({report,errors},null,2));
console.log(JSON.stringify({errors,problems:report.filter(r=>r.outside.length||r.overflow.length||r.body[1]>r.body[0]+2)},null,2));
await browser.close();
if(errors.length||report.some(r=>r.outside.length||r.overflow.length||r.body[1]>r.body[0]+2)) process.exitCode=1;


