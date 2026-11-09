import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const root=process.cwd(), dist=path.join(root,'dist'), out=path.join(root,'artifacts/v330-systems-drury-20261109');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const index=fs.readFileSync(path.join(dist,'index.html'),'utf8');
const asset=index.match(/src="([^"]+\.js)"/)?.[1];assert.ok(asset);
const assetHash=sha(path.resolve(dist,asset.replace(/^\.?\//,'')));
assert.equal(assetHash,process.env.EXPECTED_MAIN_SHA,'Only the final root-frozen bundle may be tested');
const generation=process.env.UI_GENERATION??'001', report=path.join(out,`product-ui-${generation}.json`);
assert.ok(!fs.existsSync(report),'Preserve earlier generations');
const photos=path.join(out,`product-ui-${generation}`);fs.mkdirSync(photos,{recursive:true});
const sourcePath=path.join(out,'existing-board940.json'), original=JSON.parse(fs.readFileSync(sourcePath,'utf8'));
const record={...original.record,biddingSystem:'two-over-one',agreementVersion:'natural-v3.0-drury',actions:[
 {kind:'call',seat:'N',call:{kind:'pass'}},{kind:'call',seat:'E',call:{kind:'pass'}},
 {kind:'call',seat:'S',call:{kind:'bid',level:1,strain:'H'}},{kind:'call',seat:'W',call:{kind:'pass'}}]};
const base={version:1,systemSchema:'v330-natural-default',current:record,undo:[],history:[],delay:1100,biddingSystem:'two-over-one',gameSystem:'two-over-one',playStrength:'basic',activeMatch:null};
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.wasm':'application/wasm','.woff2':'font/woff2'};
const server=http.createServer((req,res)=>{const relative=new URL(req.url,'http://local').pathname;const file=path.resolve(dist,relative==='/'?'index.html':'.'+relative);if(!file.startsWith(dist+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--no-proxy-server']});
const url=`http://127.0.0.1:${server.address().port}`,results=[],failures=[];
const wanted=['标准（SAYC）','自然（Natural）','精确（Precise）'];
const banned=/第\s*8\s*轮|权重|SHA-?256|seed101|epoch08/i;
try {
 for (const mobile of [false,true]) {
  const label=mobile?'phone':'desktop';const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:960},serviceWorkers:'block'});
  await context.addInitScript(raw=>localStorage.setItem('bridgelab.session.v3.6',raw),JSON.stringify(base));
  const page=await context.newPage();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try {
   await page.goto(`${url}/#/table`);
   if(mobile)await page.addStyleTag({path:path.resolve(root,'../v3.3.0-mobile/mobile-overrides/mobile.css')});
   await page.waitForFunction(()=>Number(document.querySelector('[data-testid="app"]')?.getAttribute('data-actions'))>=5,{},{timeout:40000});
   const state5=await page.evaluate(()=>({session:JSON.parse(localStorage.getItem('bridgelab.session.v3.6')),route:document.querySelector('[data-testid="app"]')?.getAttribute('data-sl-last-route'),weights:document.querySelector('[data-testid="app"]')?.getAttribute('data-sl-loaded-sha')}));
   assert.deepEqual(state5.session.current.actions[4],{kind:'call',seat:'N',call:{kind:'bid',level:2,strain:'C'}});
   assert.equal(state5.session.playStrength,'challenge');
   assert.equal(state5.weights,'41556ff0f83ced20eeea66a853b87269f3de0ac62b1aca75abce4bf9a63275e3');
   await page.waitForFunction(()=>document.querySelector('[data-testid="app"]')?.getAttribute('data-turn')==='S',{}, {timeout:20000});
   const druryCell=page.getByTestId('table-auction-history').locator('[data-explanation]').nth(4);
   await druryCell.focus();await page.getByRole('tooltip').waitFor();
   const druryText=await page.getByRole('tooltip').innerText();assert.match(druryText,/Drury/);assert.match(druryText,/3张以上红心/);assert.match(druryText,/不承诺梅花/);
   await page.screenshot({path:path.join(photos,`${label}-drury-history.png`),fullPage:true});
   await page.mouse.move(0,0);await page.getByText('牌局工具',{exact:true}).click();await page.getByRole('button',{name:'◇ 提示',exact:true}).click();
   await page.getByText('建议 4♥',{exact:true}).waitFor();await page.getByText('牌局工具',{exact:true}).click();
   await page.getByRole('button',{name:'选择 4 阶',exact:true}).click();
   const gameCall=page.getByRole('button',{name:'叫 4H',exact:true});assert.equal(await gameCall.getAttribute('data-recommended'),'true');
   await gameCall.hover();const answerText=await page.getByRole('tooltip').innerText();assert.match(answerText,/Drury/);assert.match(answerText,/成局止叫/);
   await page.screenshot({path:path.join(photos,`${label}-drury-game-hint.png`),fullPage:true});
   await gameCall.click();
   const final=await page.evaluate(()=>JSON.parse(localStorage.getItem('bridgelab.session.v3.6')));
   assert.deepEqual(final.current.actions[6],{kind:'call',seat:'S',call:{kind:'bid',level:4,strain:'H'}});
   assert.deepEqual(final.current.customSetup,record.customSetup);await page.goto(`${url}/#/setup`);await page.getByTestId('setup-page').waitFor();
   if(mobile)await page.addStyleTag({path:path.resolve(root,'../v3.3.0-mobile/mobile-overrides/mobile.css')});
   await page.getByRole('button',{name:'设置',exact:true}).click();
   let choices=[],engineOptions=[];const settingsPages=[];
   const dialog=page.getByRole('dialog');
   for(let step=0;step<16;step++) {
    const settingsText=await dialog.innerText();settingsPages.push(settingsText);assert.ok(!banned.test(settingsText),settingsText);
    assert.equal(await dialog.getByRole('group',{name:'打牌强度',exact:true}).count(),0);
    const group=dialog.getByRole('group',{name:'叫牌体系',exact:true});if(await group.count())choices=await group.getByRole('button').allTextContents();
    const engine=dialog.getByRole('combobox',{name:'叫牌引擎',exact:true});
    if(await engine.count()){engineOptions=await engine.locator('option').allTextContents();await page.screenshot({path:path.join(photos,`${label}-settings.png`),fullPage:true});}
    const next=dialog.getByRole('button',{name:'下一页游戏设置',exact:true});if(!await next.count()||await next.isDisabled())break;await next.click();
   }
   assert.deepEqual(choices,wanted);assert.deepEqual(engineOptions,['默认','备用']);await dialog.getByRole('button',{name:'关闭',exact:true}).click();await dialog.waitFor({state:'hidden'});
   // Setup only: do not start a new game or generate any additional deal.
   await page.goto(`${url}/#/setup`);await page.getByTestId('setup-page').waitFor();
   if(mobile)await page.addStyleTag({path:path.resolve(root,'../v3.3.0-mobile/mobile-overrides/mobile.css')});
   assert.deepEqual(await page.locator('[aria-label="本场叫牌体系"] button').allTextContents(),wanted);
   const setupText=await page.getByTestId('setup-page').innerText();assert.ok(!setupText.includes('打牌强度'));assert.ok(!banned.test(setupText));
   await page.screenshot({path:path.join(photos,`${label}-setup.png`),fullPage:true});
   assert.deepEqual(errors,[]);
   results.push({viewport:label,passed:true,druryText,answerText,actualCalls:final.current.actions.slice(4,7),loadedWeightsSHA256:state5.weights,druryAppliedRoute:state5.route,storedPlayStrength:final.playStrength,settingsChoices:choices,engineOptions:['默认','备用'],noStrengthSelector:true,noTrainingTermsInVisibleSettings:true,setupDidNotStartANewDeal:true,inputHandsUnchanged:true,browserErrors:errors});
  } catch(error) {await page.screenshot({path:path.join(photos,`${label}-failure.png`),fullPage:true}).catch(()=>{});failures.push({viewport:label,error:String(error),stack:error.stack});break;}
  finally {await context.close();}
 }
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
const result={scope:'Production dist with the previously frozen board940 hands. Same public Drury prefix on two viewports; no new mother deals, play experiment or training. Mobile CSS is the actual override injected for responsive inspection, not a phone installation.',valid:results.length===2&&!failures.length,results,failures,productionBundleSHA256:assetHash,inputSHA256:sha(sourcePath),mobileCSSSHA256:sha(path.resolve(root,'../v3.3.0-mobile/mobile-overrides/mobile.css')),newMotherDeals:0,training:0,wholeBoardPerformanceClaim:false};
fs.writeFileSync(report,JSON.stringify(result,null,2));console.log(JSON.stringify({valid:result.valid,groups:results.length,failures,report}));if(!result.valid)process.exitCode=1;
