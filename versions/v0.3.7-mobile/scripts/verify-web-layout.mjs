import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = resolve(root, 'assets/www');
const require = createRequire(resolve(root, '../v0.3.6/package.json'));
const { chromium } = require('@playwright/test');
const { build } = require('esbuild');
const { Module } = require('node:module');
const fixtureDirectory=resolve(root,'artifacts/previous-code43/upstream-src');
const fixtureBuild=await build({stdin:{contents:`import {newGame,applyCall,playCard} from './src/core/game.ts'; import {legalCards} from './src/core/play.ts'; import {emptySession,encodeSession} from './src/persistence/session.ts'; let game=newGame(1,'fixed-north-dummy-code44'); for(const call of [{kind:'pass'},{kind:'pass'},{kind:'bid',level:1,strain:'NT'},{kind:'pass'},{kind:'pass'},{kind:'pass'}])game=applyCall(game,game.turn,call); game=playCard(game,game.turn,legalCards(game.hands[game.turn],game.currentTrick)[0].id); export const raw=encodeSession({...emptySession(),game,delay:0,playStrength:'basic'}); export const actions=game.actions.length;
function publicDummy(dummy){const declarer=dummy==='E'?'W':'E';let g=newGame(1,'fixed-public-dummy-'+dummy+'-code44'),bid=false;while(g.phase==='auction'){const call=!bid&&g.turn===declarer?(bid=true,{kind:'bid',level:1,strain:'NT'}):{kind:'pass'};g=applyCall(g,g.turn,call);}g=playCard(g,g.turn,legalCards(g.hands[g.turn],g.currentTrick)[0].id);while(g.phase==='play'&&g.turn!=='S')g=playCard(g,g.turn,legalCards(g.hands[g.turn],g.currentTrick)[0].id);return{raw:encodeSession({...emptySession(),game:g,delay:0,playStrength:'basic'}),seat:dummy,hiddenSeat:declarer,expectedCards:g.hands[dummy].map(c=>c.id).sort(),expectedSuits:Object.fromEntries(['S','H','D','C'].map(suit=>[suit,g.hands[dummy].filter(c=>c.suit===suit).map(c=>c.id).sort()]))};}
export const eastDummy=publicDummy('E');export const westDummy=publicDummy('W');
export {decodeSession} from './src/persistence/session.ts';
export const scoreProgressFixtures=['S','E'].map(declarer=>{let g=newGame(1,'score-progress-'+declarer),bid=false;while(g.phase==='auction'){const call=!bid&&g.turn===declarer?(bid=true,{kind:'bid',level:3,strain:'NT'}):{kind:'pass'};g=applyCall(g,g.turn,call);}while(g.phase==='play'&&(g.completedTricks.length<7||!(g.turn==='S'||(g.turn===g.dummy&&g.contract.declarer==='S'))))g=playCard(g,g.turn,legalCards(g.hands[g.turn],g.currentTrick)[0].id);return{declarer,raw:encodeSession({...emptySession(),game:g,delay:1100,playStrength:'basic'})};});
for(let attempt=0;attempt<50;attempt++){let g=newGame(1,'score-high-'+attempt),bid=false;while(g.phase==='auction'){const call=!bid&&g.turn==='S'?(bid=true,{kind:'bid',level:3,strain:'NT'}):{kind:'pass'};g=applyCall(g,g.turn,call);}while(g.phase==='play'&&(g.completedTricks.length<11||!(g.turn==='S'||(g.turn===g.dummy&&g.contract.declarer==='S'))))g=playCard(g,g.turn,legalCards(g.hands[g.turn],g.currentTrick)[0].id);if(g.phase==='play'&&g.tricksWon.NS>=5&&g.tricksWon.EW>=5){scoreProgressFixtures.push({declarer:'high',raw:encodeSession({...emptySession(),game:g,delay:1100,playStrength:'basic'})});break;}}if(scoreProgressFixtures.length!==3)throw new Error('No bounded legal high-column fixture found');
let longGame=newGame(3,'auction-scroll-live');for(let i=0;i<20;i++){const bid=Math.floor(i/3);longGame=applyCall(longGame,longGame.turn,i%3===0?{kind:'bid',level:Math.floor(bid/5)+1,strain:['C','D','H','S','NT'][bid%5]}:{kind:'pass'});}for(const call of [{kind:'bid',level:6,strain:'C'},{kind:'pass'},{kind:'pass'},{kind:'bid',level:6,strain:'D'},{kind:'bid',level:7,strain:'NT'}])longGame=applyCall(longGame,longGame.turn,call);const priorGames=[1,2].map(board=>{let g=newGame(board,'prior-auction-scroll');for(let i=0;i<4;i++)g=applyCall(g,g.turn,{kind:'pass'});return g;});export const longAuction={raw:encodeSession({...emptySession(),game:longGame,history:priorGames,delay:1100,playStrength:'basic'}),calls:longGame.auction.length};`,resolveDir:fixtureDirectory},bundle:true,platform:'node',format:'cjs',write:false});
const fixtureModule=new Module(resolve(fixtureDirectory,'fixed-seat-fixture.cjs'));fixtureModule._compile(fixtureBuild.outputFiles[0].text,fixtureModule.filename=resolve(fixtureDirectory,'fixed-seat-fixture.cjs'));const fixedFixture=fixtureModule.exports;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const path = resolve(webRoot, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(webRoot + sep)) throw new Error('Outside web root');
    res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
const url = `http://127.0.0.1:${server.address().port}`;

async function chooseSetting(page, label, buttonName) {
  for (let i=0;i<10;i++) {
    const group=page.getByRole('group',{name:label,exact:true});
    if (await group.count() && await group.isVisible()) {
      await group.getByRole('button',{name:buttonName}).click(); return;
    }
    const next=page.getByRole('button',{name:'下一页游戏设置',exact:true});
    if (!await next.count() || !await next.isEnabled()) break;
    await next.click();
  }
  throw new Error('Settings page not found: '+label);
}

async function verifyColumns(page) {
  await page.getByTestId('trick-score').waitFor();
  const raw=await page.evaluate(()=>localStorage.getItem('bridgelab.session.v3.6'));
  const game=fixedFixture.decodeSession(raw).game;
  const declaringSide=['N','S'].includes(game.contract.declarer)?'NS':'EW';
  const expected={NS:game.tricksWon.NS,EW:game.tricksWon.EW,target:game.contract.level+6,declaringSide};
  const actual=await page.getByTestId('trick-score').evaluate(section=>{
    const meters=[...section.querySelectorAll('[role="meter"]')].map(meter=>{const rect=meter.getBoundingClientRect();return{side:meter.closest('[data-side]').dataset.side,value:Number(meter.getAttribute('aria-valuenow')),min:Number(meter.getAttribute('aria-valuemin')),max:Number(meter.getAttribute('aria-valuemax')),x:rect.x,y:rect.y,width:rect.width,height:rect.height};});
    const target=section.querySelector('[data-testid="score-target"]');
    const standaloneNumbers=[...section.querySelectorAll('span')].filter(e=>e.children.length===0&&/^\d+$/.test(e.textContent.trim())).map(e=>Number(e.textContent.trim()));
    const rect=section.getBoundingClientRect();
    const labels=[...section.querySelectorAll('span')].filter(e=>e.children.length===0&&(/^\d+$/.test(e.textContent.trim())||/^目标 /.test(e.textContent.trim())));
    const seatLabels=['N','S'].flatMap(seat=>[...document.querySelectorAll('[data-testid="table-seat-'+seat+'"] > div:first-child > *')]);
    const overlap=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>.5&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>.5;
    const seatLabelCollisions=labels.flatMap(label=>seatLabels.filter(seat=>overlap(label.getBoundingClientRect(),seat.getBoundingClientRect())).map(seat=>({score:label.textContent,seat:seat.textContent})));
    return{seatLabelCollisions,meters,target:Number(target?.dataset.target),targetSide:target?.closest('[data-side]')?.dataset.side,standaloneNumbers,noStandaloneUnit:![...section.querySelectorAll('*')].some(e=>e.children.length===0&&e.textContent.trim()==='墩'),noAxisElement:!section.querySelector('[class*="Axis"],[class*="axis"],[data-testid*="axis"]'),insideViewport:rect.x>=0&&rect.y>=0&&rect.right<=innerWidth+1&&rect.bottom<=innerHeight+1};
  });
  const correctValues=actual.meters.length===2&&actual.meters.every(m=>m.value===expected[m.side]&&m.min===0&&m.max===13);
  const verticalColumns=actual.meters.every(m=>m.height>m.width)&&actual.meters[0].x<actual.meters[1].x&&Math.abs(actual.meters[0].y-actual.meters[1].y)<=2;
  const noLeftScale=actual.standaloneNumbers.length===2&&actual.noStandaloneUnit&&actual.noAxisElement;
  const correctTarget=actual.target===expected.target&&actual.targetSide===expected.declaringSide;
  const noDocumentScroll=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight&&scrollY===0);
  if(!correctValues||!verticalColumns||!noLeftScale||!correctTarget||!actual.insideViewport||!noDocumentScroll||actual.seatLabelCollisions.length)throw new Error('Mobile double-column validation failed '+JSON.stringify({expected,actual,correctValues,verticalColumns,noLeftScale,correctTarget,noDocumentScroll}));
  return{expected,actual,correctValues,verticalColumns,noLeftScale,correctTarget,noDocumentScroll};
}

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const results = [];
const nativeFilesSource = await readFile(resolve(root, 'lib/native_files.dart'), 'utf8');
const nativeFilesScript = nativeFilesSource.match(/const installNativeFilesScript = r'''([\s\S]*?)'''/)[1];
try {
  for (const [orientation, viewport] of [['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]]) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 1, serviceWorkers: 'block' });
    await context.addInitScript(() => {
      window.BridgeLabFiles = { postMessage: message => {
        const request = JSON.parse(message);
        if (request.action === 'saveFile') {
          window.__nativeFileExport = { name: request.name, text: request.text };
          queueMicrotask(() => window.__bridgeNativeFilesComplete({ id: request.id, value: true }));
        } else {
          queueMicrotask(() => window.__bridgeNativeFilesComplete({ id: request.id, value: window.__nativeFileExport || null }));
        }
      } };
    });
    await context.addInitScript({ content: nativeFilesScript });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.getByTestId('home-page').waitFor({ state: 'visible' });
    const homeNoHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    await page.screenshot({ path: resolve(root, `docs/home-${orientation}.png`), fullPage: false });
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await chooseSetting(page, '打牌强度', /基础/);
    await chooseSetting(page, '机器人行动速度', '即时');
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await page.evaluate(() => {location.hash='/setup';});
    await page.getByTestId('setup-page').waitFor();
    const setupNoHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    await page.screenshot({ path: resolve(root, `docs/setup-${orientation}.png`), fullPage: false });
    await page.getByRole('button', { name: /复现发牌/ }).click();
    await page.getByLabel('随机种子', { exact: true }).fill('ui-human-declarer-v1');
    await page.getByRole('button', { name: '完成', exact: true }).click();
    await page.getByLabel('本场打牌强度', { exact: true }).getByRole('button', {name:'基础',exact:true}).click();
    await page.getByRole('button', { name: /开始比赛/ }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="app"]')?.getAttribute('data-controller') === 'S');
    await page.mouse.move(0, 0);
    const table = page.getByTestId('bridge-table');
    await table.waitFor({ state: 'visible' });
    const historyInsideTable = await table.getByLabel('叫牌历史', { exact: true }).count() === 1;
    const biddingInsideTable = await table.getByLabel('叫牌框', { exact: true }).count() === 1;
    if (!historyInsideTable || !biddingInsideTable) throw new Error('New central table layout missing');
    const mobileCssLoaded = await page.evaluate(() => [...document.styleSheets].some(sheet => sheet.href?.endsWith('/mobile.css')));
    const tableSeatCount = await table.locator('[data-testid^="table-seat-"]').count();
    const fixedScreen = await page.evaluate(() => ({viewport:{width:innerWidth,height:innerHeight},document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},body:{width:document.body.scrollWidth,height:document.body.scrollHeight},root: (()=>{const r=document.getElementById('root').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};})()}));
    const noDocumentScroll = fixedScreen.document.width <= viewport.width && fixedScreen.document.height <= viewport.height && fixedScreen.body.height <= viewport.height;
    const bounds = await table.boundingBox();
    const tableInsideViewport = bounds.x>=0 && bounds.y>=0 && bounds.x+bounds.width<=viewport.width+1 && bounds.y+bounds.height<=viewport.height+1;
    const noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    const screenshot = resolve(root, `docs/new-table-${orientation}.png`);
    await page.screenshot({ path: screenshot, fullPage: false });
    await page.evaluate(() => {location.hash='/history';});
    await page.getByTestId('history-page').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: '导出存档', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '牌局存档已导出。' }).waitFor();
    const nativeExport = await page.evaluate(() => window.__nativeFileExport);
    if (!nativeExport?.name.endsWith('.json') || !nativeExport.text.includes('bridgelab')) throw new Error('Native bridge did not receive archive JSON');
    await page.getByRole('button', { name: '导入存档', exact: true }).click();
    await page.getByRole('status').filter({ hasText: /已导入/ }).waitFor();
    const historyNoHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    await page.screenshot({ path: resolve(root, `docs/history-${orientation}.png`), fullPage: false });
    await page.evaluate(() => {location.hash='/setup';});
    await page.getByTestId('setup-page').waitFor();
    await page.getByRole('button', { name: /双桌 IMP/ }).click();
    await page.getByLabel('本场打牌强度', { exact: true }).getByRole('button', {name:'基础',exact:true}).click();
    await page.getByRole('button', { name: /开始比赛/ }).click();
    const score = page.getByLabel('双方 IMP 比分', { exact: true });
    await score.waitFor({ state: 'visible' });
    const impScoreText = await score.innerText();
    if (!/我方 0 : 0 对方 · 净 0 IMP/.test(impScoreText)) throw new Error(`Both team scores and net missing: ${impScoreText}`);
    const impNoHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    await page.screenshot({ path: resolve(root, `docs/imp-score-${orientation}.png`), fullPage: false });
    const fixedContext=await browser.newContext({viewport,isMobile:true,hasTouch:true,deviceScaleFactor:1,serviceWorkers:'block'});
    await fixedContext.addInitScript(raw=>localStorage.setItem('bridgelab.session.v3.6',raw),fixedFixture.raw);
    const fixedPage=await fixedContext.newPage();fixedPage.on('pageerror',error=>errors.push(error.message));
    await fixedPage.goto(url+'/index.html#/table');
    const north=fixedPage.getByTestId('table-seat-N'),south=fixedPage.getByTestId('table-seat-S');
    await north.getByTestId('table-hand-N').waitFor();await south.getByTestId('table-hand-S').waitFor();
    const trickScoreChecks=[await verifyColumns(fixedPage)];
    const fixedBefore={north:await north.boundingBox(),south:await south.boundingBox()};
    const fixedNorthSouthSeats=fixedBefore.north.y+fixedBefore.north.height/2<fixedBefore.south.y+fixedBefore.south.height/2 && await south.getByTestId('table-hand-N').count()===0 && await north.getByTestId('table-hand-S').count()===0;
    const noHandSwitchControls=await fixedPage.getByRole('button',{name:'我的手牌',exact:true}).count()===0 && await fixedPage.getByRole('button',{name:/^明手(?: · 轮到出牌)?$/}).count()===0;
    const southCardsBefore=await south.locator('[data-card]').evaluateAll(cards=>cards.map(card=>card.dataset.card));
    await north.locator('button[data-card]:not([disabled])').first().click();
    await fixedPage.waitForFunction(actions=>Number(document.querySelector('[data-testid="app"]').dataset.actions)>actions,fixedFixture.actions);
    await fixedPage.waitForFunction(()=>document.querySelector('[data-testid="app"]').dataset.turn==='S');
    const fixedAfter={north:await north.boundingBox(),south:await south.boundingBox()};
    const southCardsAfter=await south.locator('[data-card]').evaluateAll(cards=>cards.map(card=>card.dataset.card));
    const dummyRemainsNorthAfterAction=await north.getByTestId('table-hand-N').count()===1 && await south.getByTestId('table-hand-S').count()===1 && await south.getByTestId('table-hand-N').count()===0 && fixedAfter.north.y+fixedAfter.north.height/2<fixedAfter.south.y+fixedAfter.south.height/2 && JSON.stringify(southCardsBefore)===JSON.stringify(southCardsAfter) && await north.locator('[data-card]').count()===12;
    const fixedDummyScreenshot=resolve(root,`docs/fixed-dummy-north-${orientation}.png`);
    await fixedPage.screenshot({path:fixedDummyScreenshot,fullPage:false});
    if(!fixedNorthSouthSeats||!noHandSwitchControls||!dummyRemainsNorthAfterAction)throw new Error('Fixed South/North dummy layout failed: '+orientation);
    await fixedContext.close();
    const longContext=await browser.newContext({viewport,isMobile:true,hasTouch:true,deviceScaleFactor:1,serviceWorkers:'block'});
    await longContext.addInitScript(()=>{const later=window.setTimeout.bind(window);window.setTimeout=(callback,milliseconds,...args)=>later(callback,milliseconds===1100?60000:milliseconds,...args);});
    await longContext.addInitScript(raw=>localStorage.setItem('bridgelab.session.v3.6',raw),fixedFixture.longAuction.raw);
    const longPage=await longContext.newPage();longPage.on('pageerror',error=>errors.push(error.message));
    await longPage.goto(url+'/index.html#/table');
    const longHistory=longPage.getByTestId('table-auction-history'),longHeader=longPage.getByTestId('auction-history-header'),longScroll=longPage.getByTestId('auction-history-scroll');
    await longScroll.waitFor();
    const longCalls=longScroll.locator('[data-explanation]');
    const allAuctionCallsRendered=await longCalls.count()===fixedFixture.longAuction.calls;
    const auctionHistoryPaginationRemoved=await longHistory.getByRole('button',{name:/较早叫牌|较新叫牌/}).count()===0;
    await longScroll.evaluate(element=>{element.scrollTop=0;});
    const historyHeaderBefore=await longHeader.boundingBox(),historyBodyBefore=await longScroll.boundingBox(),historyFirstCall=await longCalls.first().boundingBox();
    const longScrollDimensions=await longScroll.evaluate(element=>({height:element.clientHeight,scrollHeight:element.scrollHeight,top:element.scrollTop,overflowY:getComputedStyle(element).overflowY}));
    await longScroll.hover();await longPage.mouse.wheel(0,350);
    await longPage.waitForFunction(()=>document.querySelector('[data-testid="auction-history-scroll"]').scrollTop>0);
    const realWheelScrollTop=await longScroll.evaluate(element=>element.scrollTop);
    await longScroll.evaluate(element=>{element.scrollTop=element.scrollHeight;});
    const historyHeaderAfter=await longHeader.boundingBox(),historyBodyAfter=await longScroll.boundingBox(),historyLastCall=await longCalls.last().boundingBox();
    const auctionHistoryScrollsInsideFrame=allAuctionCallsRendered&&auctionHistoryPaginationRemoved&&longScrollDimensions.scrollHeight>longScrollDimensions.height&&['auto','scroll'].includes(longScrollDimensions.overflowY)&&realWheelScrollTop>0&&Math.abs(historyHeaderBefore.y-historyHeaderAfter.y)<1&&Math.abs(historyBodyBefore.y-historyBodyAfter.y)<1&&historyFirstCall.y>=historyBodyBefore.y-1&&historyLastCall.y+historyLastCall.height<=historyBodyAfter.y+historyBodyAfter.height+1&&await longPage.evaluate(()=>scrollY===0&&document.documentElement.scrollHeight<=innerHeight);
    const longAuctionScreenshot=resolve(root,`docs/auction-history-scroll-${orientation}.png`);
    await longPage.mouse.move(0,0);await longPage.keyboard.press('Escape');
    await longPage.screenshot({path:longAuctionScreenshot,fullPage:false});
    if(!auctionHistoryScrollsInsideFrame)throw new Error('Long auction does not scroll inside fixed frame: '+orientation+' '+JSON.stringify({allAuctionCallsRendered,auctionHistoryPaginationRemoved,longScrollDimensions,realWheelScrollTop,historyHeaderBefore,historyHeaderAfter,historyBodyBefore,historyBodyAfter,historyFirstCall,historyLastCall}));
    await longContext.close();
    const publicDummyChecks=[];
    for(const publicFixture of [fixedFixture.eastDummy,fixedFixture.westDummy]){
      const publicContext=await browser.newContext({viewport,isMobile:true,hasTouch:true,deviceScaleFactor:1,serviceWorkers:'block'});
      await publicContext.addInitScript(raw=>localStorage.setItem('bridgelab.session.v3.6',raw),publicFixture.raw);
      const publicPage=await publicContext.newPage();publicPage.on('pageerror',error=>errors.push(error.message));
      await publicPage.goto(url+'/index.html#/table');
      trickScoreChecks.push(await verifyColumns(publicPage));
      const publicSeat=publicPage.getByTestId('table-seat-'+publicFixture.seat),publicHand=publicSeat.getByTestId('table-hand-'+publicFixture.seat);
      await publicHand.waitFor();
      const realCardViews=await publicHand.locator('button[data-card][data-seat="'+publicFixture.seat+'"]').evaluateAll(cards=>cards.map(card=>({id:card.dataset.card,rank:card.querySelector('b')?.textContent,disabled:card.disabled})));
      const realCardsRendered=JSON.stringify(realCardViews.map(card=>card.id).sort())===JSON.stringify(publicFixture.expectedCards)&&realCardViews.every(card=>card.rank&&card.disabled);
      const hiddenOpponentCardsRemainHidden=await publicPage.getByTestId('table-seat-'+publicFixture.hiddenSeat).locator('[data-card]').count()===0;
      const seatBounds=await publicSeat.boundingBox(),tableBounds=await publicPage.getByTestId('bridge-table').boundingBox();
      const center=tableBounds.x+tableBounds.width/2;
      const remainsOriginalSide=publicFixture.seat==='E'?seatBounds.x+seatBounds.width/2>center:seatBounds.x+seatBounds.width/2<center;
      const suitRows=[];
      const expectedSuitOrder=['S','H','D','C'].filter(suit=>publicFixture.expectedSuits[suit].length>0);
      for(const suit of expectedSuitOrder){
        const suitRow=publicHand.getByTestId('table-suit-'+publicFixture.seat+'-'+suit);
        const row=await suitRow.evaluate(element=>{const rect=element.getBoundingClientRect();return{suit:element.dataset.suit,bounds:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},cards:[...element.querySelectorAll('button[data-card]')].map(card=>{const r=card.getBoundingClientRect();return{id:card.dataset.card,x:r.x,y:r.y,width:r.width,height:r.height,rank:card.querySelector('b')?.textContent,pip:!!card.querySelector('svg')};})};});
        row.expectedCards=publicFixture.expectedSuits[suit];
        row.onlyExpectedSuit=JSON.stringify(row.cards.map(card=>card.id).sort())===JSON.stringify(row.expectedCards)&&row.suit===suit;
        row.horizontal=row.cards.every((card,i)=>i===0||(Math.abs(card.y-row.cards[0].y)<1&&card.x>row.cards[i-1].x));
        row.allCardFacesInsideSeat=row.cards.every(card=>card.rank&&card.pip&&card.x>=seatBounds.x-1&&card.y>=seatBounds.y-1&&card.x+card.width<=seatBounds.x+seatBounds.width+1&&card.y+card.height<=seatBounds.y+seatBounds.height+1&&card.x>=0&&card.x+card.width<=viewport.width+1);
        suitRows.push(row);
      }
      const suitsInSeparateHorizontalRows=suitRows.length===expectedSuitOrder.length&&suitRows.every((row,i)=>row.onlyExpectedSuit&&row.horizontal&&(i===0||row.bounds.y>=suitRows[i-1].bounds.y+suitRows[i-1].bounds.height-1));
      const allCardFacesInsideSeat=suitRows.every(row=>row.allCardFacesInsideSeat);
      const publicScreenshot=resolve(root,`docs/public-dummy-${publicFixture.seat}-${orientation}.png`);
      await publicPage.screenshot({path:publicScreenshot,fullPage:false});
      if(!realCardsRendered||!hiddenOpponentCardsRemainHidden||!remainsOriginalSide||!suitsInSeparateHorizontalRows||!allCardFacesInsideSeat)throw new Error('Public dummy real-card/suit-row/privacy/seat check failed: '+publicFixture.seat+' '+orientation+' '+JSON.stringify({realCardsRendered,hiddenOpponentCardsRemainHidden,remainsOriginalSide,suitsInSeparateHorizontalRows,allCardFacesInsideSeat,seatBounds,suitRows}));
      publicDummyChecks.push({seat:publicFixture.seat,realCardsRendered,cardCount:realCardViews.length,suitsInSeparateHorizontalRows,allCardFacesInsideSeat,suitRows,hiddenOpponentCardsRemainHidden,remainsOriginalSide,screenshot:publicScreenshot});
      await publicContext.close();
    }
    for(const scoreFixture of fixedFixture.scoreProgressFixtures){
      const scoreContext=await browser.newContext({viewport,isMobile:true,hasTouch:true,deviceScaleFactor:1,serviceWorkers:'block'});
      await scoreContext.addInitScript(raw=>localStorage.setItem('bridgelab.session.v3.6',raw),scoreFixture.raw);
      const scorePage=await scoreContext.newPage();scorePage.on('pageerror',error=>errors.push(error.message));
      await scorePage.goto(url+'/index.html#/table');
      trickScoreChecks.push(await verifyColumns(scorePage));
      await scorePage.screenshot({path:resolve(root,`docs/trick-columns-${scoreFixture.declarer}-${orientation}.png`),fullPage:false});
      await scoreContext.close();
    }
    const publicEastDummyCardsRendered=publicDummyChecks.find(check=>check.seat==='E').realCardsRendered;
    const publicWestDummyCardsRendered=publicDummyChecks.find(check=>check.seat==='W').realCardsRendered;
    const hiddenOpponentCardsRemainHidden=publicDummyChecks.every(check=>check.hiddenOpponentCardsRemainHidden);
    results.push({ trickScoreChecks, orientation, viewport, screenshot, fixedScreen, noDocumentScroll, tableInsideViewport, historyInsideTable, biddingInsideTable, tableSeatCount, mobileCssLoaded, noHorizontalOverflow, homeNoHorizontalOverflow, setupNoHorizontalOverflow, historyNoHorizontalOverflow, nativeBridgeArchiveRoundtrip: true, impScoreText, impNoHorizontalOverflow, fixedNorthSouthSeats, noHandSwitchControls, dummyRemainsNorthAfterAction, fixedBefore, fixedAfter, fixedDummyScreenshot, auctionHistoryScrollsInsideFrame, auctionHistoryPaginationRemoved, allAuctionCallsRendered, longAuctionCallCount:fixedFixture.longAuction.calls, longAuctionFixtureBoundary:'Same legal natural-with-pass 25-call sequence as desktop auction-scroll case; browser-only 1100ms robot timer extended to60000ms to hold the saved position during scroll checks.', longScrollDimensions, realWheelScrollTop, longAuctionScreenshot, publicDummyChecks, publicEastDummyCardsRendered, publicWestDummyCardsRendered, hiddenOpponentCardsRemainHidden, southCardsPreservedAcrossDummyAction:southCardsBefore.length, pageErrors: errors });
    if (!noDocumentScroll || !tableInsideViewport || tableSeatCount !== 4 || !mobileCssLoaded || !noHorizontalOverflow || !homeNoHorizontalOverflow || !setupNoHorizontalOverflow || !historyNoHorizontalOverflow || !impNoHorizontalOverflow || errors.length) throw new Error(`Web layout checks failed: ${orientation}`);
    await context.close();
  }
  const sync = JSON.parse(await readFile(resolve(root, 'docs/SYNC_MANIFEST.json'), 'utf8'));
  const mainBundleSha256 = createHash('sha256').update(await readFile(resolve(webRoot, 'assets', sync.desktopMainBundle))).digest('hex');
  await writeFile(resolve(root, 'docs/WEB_LAYOUT_VALIDATION.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), version:'0.3.7+44', servedAssets: webRoot, desktopMainBundle: sync.desktopMainBundle, mainBundleSha256, browserVersion: browser.version(), browserExecutable: executablePath || 'Playwright bundled Chromium', evidenceBoundary: 'Chromium mobile web viewport; no Android device launch', results }, null, 2));
  console.log('Separate horizontal rows for every nonempty suit using real CardView at E/W original seats, fixed South/North dummy seats verified before/after a real dummy action, with mobile portrait/landscape and file-bridge checks.');
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolveClosed => server.close(resolveClosed));
}
