import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktop = resolve(root, '../v3.1.2-desktop');
const require = createRequire(pathToFileURL(resolve(desktop, 'package.json')));
const { chromium } = require('@playwright/test');
const css = readFileSync(resolve(root, 'mobile-overrides/mobile.css'), 'utf8');
const record = JSON.parse(readFileSync(resolve(root, '../v3.1.1-desktop/artifacts/v311-ui/complete-52-card-game.json'), 'utf8')).record;
const current = { board: 33, seed: 'v3-ui-precision-7:board:1', actions: [
  { kind: 'call', seat: 'N', call: { kind: 'bid', level: 1, strain: 'NT' } },
  { kind: 'call', seat: 'E', call: { kind: 'pass' } },
], biddingSystem: 'precision', agreementVersion: 'precision-v3.1-natural-continuation' };
const seats = ['N','E','S','W'];
const history = Array.from({length:32}, (_,index) => index === 0 ? record : ({
  board:index+1,seed:`fixed-navigation-fixture-${index+1}`,biddingSystem:'precision',
  agreementVersion:'precision-v3.1-natural-continuation',
  actions:Array.from({length:4},(_,turn)=>({kind:'call',seat:seats[(index+turn)%4],call:{kind:'pass'}})),
}));
const output = resolve(root, 'docs/fixed-navigation-browser');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
const errors = [];
const snapshot = page => page.evaluate(() => {
  const box = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
  const main = document.querySelector('[data-testid=app]>main');
  const nodes = [main, ...main.children];
  const scroll = nodes.filter(node => /auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 2);
  return { header: box('[data-testid=app]>header'), nav: box('[aria-label=主导航]'), main: box('[data-testid=app]>main'),
    windowY: window.scrollY, documentHeight: document.documentElement.scrollHeight, height: innerHeight,
    scroll: scroll.map(node => ({ tag: node.tagName, top: node.scrollTop, max: node.scrollHeight-node.clientHeight })) };
});
const stable = (before, after) => {
  for (const key of ['header', 'nav']) for (const axis of ['x','y','width','height'])
    assert.ok(Math.abs(before[key][axis]-after[key][axis]) < 1, `${key}.${axis} moved`);
  assert.equal(after.windowY, 0);
  assert.equal(after.documentHeight, after.height);
  assert.ok(after.nav.bottom <= after.height + 1);
  assert.ok(after.main.bottom <= after.nav.top + 1, 'Content overlaps navigation');
};
async function fixture(viewport, game = current) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ game, history }) => {
    localStorage.setItem('bridgelab.session.v3.6', JSON.stringify({ version: 1, current: game, undo: [],
      history, delay: 1100, biddingSystem: 'precision', gameSystem: 'precision', playStrength: 'basic' }));
    const timer = window.setTimeout.bind(window);
    window.setTimeout = (handler, delay, ...args) => timer(handler, delay===1100||delay===1600 ? 600000 : delay, ...args);
  }, { game, history });
  await page.goto('http://127.0.0.1:5206/#/home');
  await page.getByTestId('app').waitFor();
  await page.addStyleTag({ content: css });
  await page.evaluate(() => document.fonts.ready);
  return { context, page };
}
try {
  for (const viewport of [{width:360,height:640}, {width:412,height:635}, {width:635,height:388}]) {
    const { context, page } = await fixture(viewport);
    for (const route of ['home','setup','history','analysis','deals','online']) {
      await page.evaluate(route => { location.hash = `#/${route}`; }, route);
      await page.waitForTimeout(150);
      await page.evaluate(() => {
        const main = document.querySelector('[data-testid=app]>main');
        for (const node of [main, ...main.children]) node.scrollTop = 0;
      });
      const before = await snapshot(page);
      assert.ok(before.scroll.length <= 1, `Nested page scrollers: ${route}`);
      const main = before.main;
      await page.mouse.move(main.left+5, Math.min(main.bottom-8, main.top+main.height/2));
      await page.mouse.wheel(0, 10000);
      await page.waitForTimeout(180);
      const after = await snapshot(page);
      stable(before, after);
      if (before.scroll.length) {
        assert.ok(after.scroll[0].top > before.scroll[0].top, `Middle did not scroll: ${route}`);
        assert.ok(Math.abs(after.scroll[0].max-after.scroll[0].top) < 2, `Bottom unreachable: ${route}`);
      }
      assert.equal(await page.getByRole('navigation', {name:'主导航'}).getByRole('link').count(), 4);
      results.push({ viewport, route, passed: true, before, after });
      if (route==='analysis' || route==='setup') await page.screenshot({path:resolve(output, `${route}-${viewport.width}x${viewport.height}-bottom.png`)});
    }
    await page.getByRole('link',{name:'单机游戏',exact:true}).click();
    await page.getByTestId('bridge-table').waitFor();
    const before = await snapshot(page);
    await page.mouse.move(before.main.left+5,before.main.top+40);
    await page.mouse.wheel(0,10000);
    await page.waitForTimeout(100);
    stable(before,await snapshot(page));
    const cards = await page.locator('[data-layout=player] [data-card]').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().top));
    assert.equal(cards.length,13); assert.equal(new Set(cards.map(Math.round)).size,1);
    results.push({viewport,route:'table-auction',passed:true});
    await page.getByRole('button',{name:'设置',exact:true}).click();
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    stable(before,await snapshot(page));
    results.push({viewport,route:'modal-open-close',passed:true});
    await context.close();
    const play = await fixture(viewport,{...record,board:33,actions:record.actions.slice(0,7)});
    await play.page.evaluate(()=>{location.hash='#/table';});
    await play.page.getByTestId('bridge-table').waitFor();
    const grouped=play.page.locator('[data-layout=dummy]');
    assert.equal(await grouped.locator('[data-testid^=table-suit-]').count(),4);
    const columns = await grouped.locator('[data-testid^=table-suit-]').evaluateAll(groups => groups.map(group => ({
      x:group.getBoundingClientRect().x,
      cards:[...group.querySelectorAll('[data-card]')].map(card => {
        const box=card.getBoundingClientRect();return {x:box.x,y:box.y};
      }),
    })));
    assert.equal(new Set(columns.map(column=>Math.round(column.x))).size,4);
    for (const column of columns) for (let i=1;i<column.cards.length;i++) {
      assert.ok(Math.abs(column.cards[i].x-column.cards[i-1].x)<1);
      assert.ok(column.cards[i].y>column.cards[i-1].y);
    }
    const playerY=await play.page.locator('[data-layout=player] [data-card]').evaluateAll(nodes=>nodes.map(node=>Math.round(node.getBoundingClientRect().top)));
    assert.equal(new Set(playerY).size,1);
    const g=await snapshot(play.page);stable(g,g);
    results.push({viewport,route:'table-play',passed:true,dummyVerticalColumns:true});
    await play.context.close();
  }
  assert.deepEqual(errors,[]);
  writeFileSync(resolve(output,'results.json'),JSON.stringify({passed:true,count:results.length,scope:'Production v3.1.2 JavaScript with exact mobile CSS override; synthetic retained-history fixture; Android evidence is separate',results,errors},null,2));
  console.log(`PASS ${results.length} fixed-navigation browser checks`);
} catch (error) {
  writeFileSync(resolve(output,'failure.json'),JSON.stringify({passed:false,error:error.stack,results,errors},null,2));
  throw error;
} finally { await browser.close(); }
