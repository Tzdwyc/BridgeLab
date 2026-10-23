import { test, expect, type Page } from '@playwright/test';
import { applyCall, replay } from '../../src/core/game';
import { PASS } from '../../src/core/types';
import { appendBoard, createMatch, updateMatchTable, type Match } from '../../src/match/engine';
import { emptySession, encodeSession, STORAGE_KEY } from '../../src/persistence/session';

const dimensions = [{width:1440,height:900},{width:1280,height:800},{width:390,height:844},{width:360,height:800},{width:844,height:390}];
function completed(id:string, boards=1) {
  let match = createMatch(id,{mode:'imp',boardCount:8,seed:id},{biddingSystem:'sayc',playStrength:'basic'});
  for(let i=0;i<boards;i++){
    let g=replay(match.boards[i].main);
    for(let j=0;j<4;j++)g=applyCall(g,g.turn,PASS);
    match=updateMatchTable(updateMatchTable(match,'main',g),'reference',g);
    if(i+1<boards)match=appendBoard(match);
  }
  match.softwareVersion='0.3.6';
  return match;
}
async function seed(page:Page, match:Match) {
 const raw=encodeSession({...emptySession(),game:replay(match.boards.at(-1)!.main),history:match.boards.slice(0,-1).map(b=>replay(b.main)),activeMatch:match,gameSystem:'sayc',playStrength:'basic'});
 const archive=Array.from({length:12},(_,i)=>({...completed('archive-'+i),status:'unfinished' as const}));
 await page.addInitScript(({raw,key,archive})=>{
   if(!localStorage.getItem(key))localStorage.setItem(key,raw);
   for(const m of archive)localStorage.setItem('bridgelab.library.v3.6.match.'+encodeURIComponent(m.id),JSON.stringify(m));
 },{raw,key:STORAGE_KEY,archive});
}
async function bounded(page:Page,label:string) {
 const result=await page.evaluate(()=>{
   const bad:string[]=[];
   for(const el of document.querySelectorAll<HTMLElement>('button,a,input:not([type=hidden]),[data-testid$="-page"],[data-testid="bridge-table"]')){
     if(!el.getClientRects().length||getComputedStyle(el).visibility==='hidden')continue;
     const r=el.getBoundingClientRect();
     if(r.left < -1 ||r.top < -1 ||r.right>innerWidth+1||r.bottom>innerHeight+1)bad.push((el.getAttribute('aria-label')||el.textContent?.trim()||el.tagName).slice(0,65)+':'+JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height}));
   }
   return {bad,rootX:document.documentElement.scrollWidth-innerWidth,rootY:document.documentElement.scrollHeight-innerHeight,scrollbars:[...document.querySelectorAll<HTMLElement>('*')].filter(el=>el.clientHeight>0&&['auto','scroll'].includes(getComputedStyle(el).overflowY)&&el.scrollHeight>el.clientHeight+1).map(el=>el.className)};
 });
 expect(result.bad,label).toEqual([]);
 expect(result.rootX,label).toBeLessThanOrEqual(1);expect(result.rootY,label).toBeLessThanOrEqual(1);
 expect(result.scrollbars,label).toEqual([]);
}
for(const size of dimensions){
 test(`single screen home/setup/history ${size.width}x${size.height}`,async({page})=>{
  const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize(size);const match=completed('history-preview',8);await seed(page,match);
  await page.goto('/#/home');await expect(page.getByTestId('home-page')).toBeVisible();await bounded(page,'home');
  await page.goto('/#/setup');await page.getByRole('button',{name:/双桌 IMP/}).click();await expect(page.getByRole('button',{name:'16 副',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'挑战',exact:true}).click();await expect(page.locator('select')).toHaveCount(0);
  await expect(page.getByTestId('setup-page')).not.toContainText('精确');await bounded(page,'setup');
  await page.getByRole('button',{name:/复现发牌/}).click();await page.getByLabel('随机种子').fill('v037-ui');await bounded(page,'seed dialog');await page.getByRole('button',{name:'完成',exact:true}).click();
  await page.screenshot({path:`artifacts/preview/setup-${size.width}x${size.height}.png`});
  await page.goto('/#/history');await expect(page.getByTestId('history-page').getByRole('link',{name:/双桌 IMP/}).first()).toBeVisible();await bounded(page,'history list');await page.getByRole('button',{name:'下一页',exact:true}).click();await bounded(page,'history page 2');
  await page.goto('/#/history/history-preview');await expect(page.getByTestId('history-board')).toBeVisible();await bounded(page,'history detail result');
  await page.getByRole('button',{name:'主桌叫牌',exact:true}).click();await page.getByLabel('历史叫牌记录').getByRole('button',{name:'北 Pass',exact:true}).click();await expect(page.getByRole('tooltip')).toContainText('不叫');await bounded(page,'historical auction');
  await page.getByRole('button',{name:'比赛信息',exact:true}).click();await expect(page.getByTestId('history-page')).toContainText('软件 v0.3.6');await bounded(page,'historical info');
  await page.getByRole('button',{name:'下一副',exact:true}).click();await expect(page.getByTestId('history-page').getByRole('heading',{name:/第 2 副/})).toBeVisible();await bounded(page,'history next board');
  await page.screenshot({path:`artifacts/preview/history-${size.width}x${size.height}.png`});expect(errors).toEqual([]);
 });
}
test('old Precision save preserved while new match defaults to natural system',async({page})=>{
 const raw=encodeSession({...emptySession(),biddingSystem:'precision',gameSystem:'precision'});
 await page.addInitScript(({key,raw})=>localStorage.setItem(key,raw),{key:STORAGE_KEY,raw});
 await page.goto('/#/setup');await expect(page.getByRole('button',{name:'SAYC＋2/1＋RKCB',exact:true})).toHaveAttribute('aria-pressed','true');
 expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).biddingSystem,STORAGE_KEY)).toBe('precision');
});
