import { test, expect, type Page } from '@playwright/test';
import { newGame, applyCall, playCard, applyClaim, controllerFor, replay } from '../../src/core/game';
import { legalCards } from '../../src/core/play';
import { PASS, type GameState } from '../../src/core/types';
import { openDocument } from '../../src/analysis/model';
import { WORKSPACE_KEY } from '../../src/analysis/persistence';
import { CACHE_KEY } from '../../src/analysis/client';
import { createMatch, updateMatchTable } from '../../src/match/engine';
import { emptySession, encodeSession, STORAGE_KEY } from '../../src/persistence/session';

function playComplete(source: GameState, reverse = false) {
  let game = applyCall(source, source.turn, {kind:'bid',level:1,strain:'NT'});
  for (let i=0;i<3;i++) game=applyCall(game,game.turn,PASS);
  while(game.phase==='play') {
    const cards=legalCards(game.hands[game.turn],game.currentTrick);
    game=playCard(game,game.turn,(reverse?cards.at(-1)!:cards[0]).id);
  }
  return game;
}
async function bounded(page: Page) {
  const result=await page.evaluate(()=>{
    const root=document.querySelector('[data-testid="analysis-page"]')!;
    const bad=[...root.querySelectorAll<HTMLElement>('*')].filter(element=>{
      const st=getComputedStyle(element);
      return st.display!=='none'&&element.clientHeight>0&&element.scrollHeight>element.clientHeight+2&&st.position!=='absolute'&&!['svg','path'].includes(element.tagName);
    }).map(element=>`${element.tagName}.${element.className}: ${element.scrollHeight}/${element.clientHeight}`);
    const outside=[...root.querySelectorAll<HTMLElement>('button,input:not([type=hidden]),select,a')].filter(element=>element.getClientRects().length).filter(element=>{const r=element.getBoundingClientRect();return r.left< -1||r.top< -1||r.right>innerWidth+1||r.bottom>innerHeight+1;}).map(element=>element.textContent||element.getAttribute('aria-label'));
    return {bad,outside,scrollX:document.documentElement.scrollWidth-innerWidth,scrollY:document.documentElement.scrollHeight-innerHeight};
  });
  expect(result.bad).toEqual([]);expect(result.outside).toEqual([]);expect(result.scrollX).toBeLessThanOrEqual(1);expect(result.scrollY).toBeLessThanOrEqual(1);
  await expect(page.getByTestId('analysis-transport')).toBeVisible();
}
async function candidates(page: Page) {
  await page.getByTestId('analysis-view-candidates').click();
  await expect(page.locator('[data-candidate]').first()).toBeVisible({timeout:45000});
}
async function solvedTable(page: Page) {
  await page.getByTestId('analysis-view-dd').click();
  await expect.poll(()=>page.getByTestId('double-dummy-table').locator('[data-tricks]').count(),{timeout:45000}).toBe(20);
  const values=await page.getByTestId('double-dummy-table').locator('[data-tricks]').evaluateAll(cells=>cells.map(cell=>Number(cell.getAttribute('data-tricks'))));
  expect(values.every(value=>Number.isInteger(value)&&value>=0&&value<=13)).toBe(true);
}
function captureErrors(page: Page) { const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));return errors; }

test('production DDS worker, mobile saved branch and native file bridge contract',async({page})=>{
  const errors=captureErrors(page);await page.setViewportSize({width:390,height:844});
  await page.addInitScript(()=>{
    const state={saves:[] as {filename:string;text:string}[],opens:0};
    (window as any).__nativeFileTest=state;
    window.BridgeLabNativeFiles={
      saveFile:async(filename,text)=>{state.saves.push({filename,text});return true;},
      openFile:async()=>{state.opens++;const last=state.saves.at(-1)!;return {name:last.filename,text:last.text};}
    };
  });
  const html=await (await page.request.get('/')).text();
  expect(html).toMatch(/assets\/index-[^"\s]+\.js/);expect(html).not.toContain('/@vite/client');expect(html).not.toContain('/src/main.tsx');
  await page.goto('/#/analysis');await candidates(page);
  expect(page.workers().some(worker=>/assets\/worker-[^/]+\.js/.test(worker.url()))).toBe(true);
  const source=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).source,WORKSPACE_KEY);
  await page.locator('[data-candidate]').first().click();
  await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-cursor','1');
  const branch=await page.getByTestId('analysis-page').getAttribute('data-branch');expect(branch).not.toBe('original');
  await page.getByTestId('analysis-view-routes').click();await expect(page.getByTestId('branch-comparison')).toBeVisible();
  await page.getByRole('button',{name:'导出分析',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__nativeFileTest.saves.length)).toBe(1);
  const saved=await page.evaluate(()=>(window as any).__nativeFileTest.saves[0]);
  expect(saved.filename).toContain('BridgeLab-v0.3.7');expect(JSON.parse(saved.text).activeBranch).toBe(branch);expect(JSON.parse(saved.text).source).toEqual(source);
  await page.getByRole('button',{name:'返回原局',exact:true}).click();await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-branch','original');
  await page.getByRole('button',{name:'导入存档',exact:true}).click();
  await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-branch',branch!);
  expect(await page.evaluate(()=>(window as any).__nativeFileTest.opens)).toBe(1);
  await page.reload();await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-cursor','1');await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-branch',branch!);
  await bounded(page);expect(errors).toEqual([]);
  await page.screenshot({path:'artifacts/production-workbench/native-contract-mobile.png'});
});

test('production PWA offline cold-result worker computes all 53 positions and the original DD table',async({page,context})=>{
  const errors=captureErrors(page);await page.setViewportSize({width:1280,height:800});
  await page.goto('/#/analysis');await candidates(page);await solvedTable(page);
  await expect(page.getByText('● 离线资源已缓存',{exact:true})).toBeVisible({timeout:45000});
  const precache=await page.evaluate(async()=>{await navigator.serviceWorker.ready;const keys=await caches.keys();const requests=(await Promise.all(keys.map(async key=>(await caches.open(key)).keys()))).flat();const urls=requests.map(request=>request.url);const workers=urls.filter(url=>/worker-[^/]+\.js/.test(url));const bodies=await Promise.all(workers.map(async url=>(await fetch(url)).text()));return {keys,urls,embeddedWasm:bodies.some(body=>body.includes('AGFzbQ')&&body.includes('WebAssembly'))};});
  expect(precache.urls.some(url=>/worker-[^/]+\.js/.test(url))).toBe(true);expect(precache.embeddedWasm||precache.urls.some(url=>/\.wasm/.test(url))).toBe(true);
  await page.evaluate(key=>{localStorage.removeItem(key);localStorage.removeItem('bridgelab.analysis.cache.v3.5');},CACHE_KEY);
  await context.setOffline(true);await page.reload();
  await page.getByLabel('分析牌局',{exact:true}).selectOption('spades');await candidates(page);
  expect(page.workers().some(worker=>/assets\/worker-[^/]+\.js/.test(worker.url()))).toBe(true);
  await page.getByRole('button',{name:'计算整副 53 个位置',exact:true}).click();
  await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-results','53',{timeout:120000});
  await solvedTable(page);await bounded(page);await expect(page.getByText('● 离线模式',{exact:true})).toBeVisible();
  await page.reload();await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-results','53');await bounded(page);expect(errors).toEqual([]);
  await test.info().attach('offline-resource-evidence.json',{body:Buffer.from(JSON.stringify(precache,null,2)),contentType:'application/json'});
  await page.screenshot({path:'artifacts/production-workbench/offline-53-positions.png'});
});

test('production ALL PASS hypothesis and claim cutoff remain bounded in landscape',async({page})=>{
  const errors=captureErrors(page);await page.setViewportSize({width:844,height:390});
  let passed=newGame(2,'v037-production-pass');for(let i=0;i<4;i++)passed=applyCall(passed,passed.turn,PASS);
  await page.addInitScript(({key,raw})=>{if(!localStorage.getItem(key))localStorage.setItem(key,raw);},{key:WORKSPACE_KEY,raw:JSON.stringify(openDocument(passed))});
  await page.goto('/#/analysis');await page.getByTestId('analysis-view-routes').click();
  await expect(page.getByTestId('passed-out-analysis-controls')).toBeVisible();
  await page.getByLabel('假设定约阶数',{exact:true}).selectOption('4');await page.getByLabel('假设定约花色',{exact:true}).selectOption('S');await page.getByLabel('假设定约庄家',{exact:true}).selectOption('E');
  await candidates(page);await page.locator('[data-candidate]').first().click();await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-cursor','1');
  await page.getByTestId('analysis-view-routes').click();await expect(page.getByTestId('branch-comparison')).toContainText('四家 Pass');await bounded(page);
  let claimed=newGame(1,'v037-production-claim');claimed=applyCall(claimed,claimed.turn,{kind:'bid',level:1,strain:'NT'});for(let i=0;i<3;i++)claimed=applyCall(claimed,claimed.turn,PASS);
  claimed=playCard(claimed,claimed.turn,claimed.hands[claimed.turn][0].id);claimed=applyClaim(claimed,controllerFor(claimed),0);
  await page.evaluate(({key,raw})=>localStorage.setItem(key,raw),{key:WORKSPACE_KEY,raw:JSON.stringify(openDocument(claimed))});
  await page.goto('/#/home');await page.goto('/#/analysis');await page.getByTestId('analysis-view-tricks').click();
  await expect(page.getByTestId('claim-analysis-cutoff')).toContainText('已出 1 张');await expect(page.getByLabel('打牌位置',{exact:true})).toHaveAttribute('max','1');
  await solvedTable(page);await bounded(page);await page.getByTestId('analysis-view-tricks').click();await bounded(page);expect(errors).toEqual([]);
  await page.screenshot({path:'artifacts/production-workbench/claim-landscape.png'});
});

test('production historical completed two-table record replays all 52 cards and returns to the same detail',async({page})=>{
  const errors=captureErrors(page);await page.setViewportSize({width:360,height:800});
  let match=createMatch('v037-production-history',{mode:'imp',boardCount:8,seed:'prod-history'},{biddingSystem:'sayc',playStrength:'basic'});
  const initial=replay(match.boards[0].main);const main=playComplete(initial);const reference=playComplete(initial,true);
  match=updateMatchTable(updateMatchTable(match,'main',main),'reference',reference);
  const raw=encodeSession({...emptySession(),game:main,activeMatch:match,gameSystem:'sayc',playStrength:'basic'});
  await page.addInitScript(({key,raw})=>{if(!localStorage.getItem(key))localStorage.setItem(key,raw);},{key:STORAGE_KEY,raw});
  await page.goto('/#/history/v037-production-history');await expect(page.getByTestId('history-board')).toBeVisible();
  const sessionBefore=await page.evaluate(key=>localStorage.getItem(key),STORAGE_KEY);
  await page.getByRole('button',{name:'主桌叫牌与出牌复盘 →',exact:true}).click();
  await expect(page.getByTestId('analysis-page')).toBeVisible();await expect(page.getByLabel('打牌位置',{exact:true})).toHaveAttribute('max','52');
  await page.getByTestId('analysis-view-auction').click();await expect(page.getByTestId('analysis-active-panel')).toContainText('Pass');await bounded(page);
  await page.getByRole('button',{name:'跳到结束',exact:true}).click();await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-cursor','52');await page.getByTestId('analysis-view-notes').click();await expect(page.getByTestId('dd-value')).toContainText(String(main.result!.declarerTricks));await bounded(page);
  await page.getByRole('link',{name:'返回历史牌局',exact:true}).click();await expect(page).toHaveURL(/#\/history\/v037-production-history$/);await expect(page.getByTestId('history-board')).toBeVisible();
  expect(await page.evaluate(key=>localStorage.getItem(key),STORAGE_KEY)).toBe(sessionBefore);expect(errors).toEqual([]);
  await page.screenshot({path:'artifacts/production-workbench/history-return-mobile.png'});
});

