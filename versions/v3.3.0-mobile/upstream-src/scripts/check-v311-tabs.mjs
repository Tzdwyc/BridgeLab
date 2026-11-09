import {chromium} from '@playwright/test';
import {writeFileSync} from 'node:fs';
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:412,height:635}});
const current={board:1,seed:'v3-ui-precision-7:board:1',actions:[{kind:'call',seat:'N',call:{kind:'bid',level:1,strain:'NT'}},{kind:'call',seat:'E',call:{kind:'pass'}}],biddingSystem:'precision',agreementVersion:'precision-v3.1-natural-continuation'};
const raw=JSON.stringify({version:1,current,undo:[],history:[],delay:1100,biddingSystem:'precision',gameSystem:'precision',playStrength:'basic'});
await page.addInitScript(value=>{if(!localStorage.getItem('bridgelab.session.v3.6'))localStorage.setItem('bridgelab.session.v3.6',value);},raw);
try{
 await page.goto('http://127.0.0.1:5205/#/table');await page.getByTestId('bridge-table').waitFor();
 const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('bridgelab.session.v3.6')).current);
 const visited=[];
 for(const name of ['历史牌局','分析室','联机游戏']){
  await page.getByRole('link',{name,exact:true}).click();
  await page.getByRole('link',{name:'单机游戏',exact:true}).click();
  await page.getByTestId('bridge-table').waitFor();
  const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('bridgelab.session.v3.6')).current);
  if(JSON.stringify(after)!==JSON.stringify(before)||!page.url().endsWith('#/table'))throw Error('Tab return changed current game');
  visited.push(name);
 }
 writeFileSync('artifacts/v311-ui/tab-return.json',JSON.stringify({passed:true,visited,currentUnchanged:true,returnedDirectlyToTable:true},null,2));
 console.log('tab navigation retained current table and actions');
}finally{await browser.close();}
