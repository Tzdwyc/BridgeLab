import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
const appUrl = process.env.BRIDGELAB_TEST_APP_URL ?? 'http://127.0.0.1:4194/';
const vite = process.env.BRIDGELAB_TEST_APP_URL ? null : await createServer({ server: { host: '127.0.0.1', port: 4194, strictPort: true } });
await vite?.listen();
let browser;
const evidence = { browser: 'Microsoft Edge', transport: 'Playwright intercepted /api/lan native adapter endpoints; real app, React hook and host room authority', checks: [] };
try {
  browser = await chromium.launch({ executablePath: process.env.BRIDGELAB_TEST_EDGE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  let id = 0;
  let queue = [];
  const replies = new Map();
  const actions = [];
  const closureReplies = new Set();
  let hostStarted = false;
  let westOffline = false;
  const seats = ['N','E','S','W'];
  const seatNames = { N: '北', E: '东', S: '南', W: '西' };
  const pages = {};
  for (const seat of seats) {
    const context = await browser.newContext({ viewport: seat === 'N' ? {width: 390, height: 844} : {width: 1280, height: 800}, serviceWorkers: 'block' });
    const page = await context.newPage();
    pages[seat] = page;
    await context.route('**/api/lan/**', async route => {
      const operation = new URL(route.request().url()).pathname.split('/').at(-1);
      const body = route.request().postDataJSON();
      const respond = (json, status = 200) => route.fulfill({ json, status });
      if (operation === 'capabilities') return respond({canHost: seat === 'N'});
      if (operation === 'start') { hostStarted = true; return respond({address:'192.168.1.8',port:51894}); }
      if (operation === 'stop') { hostStarted = false; return respond({ok:true}); }
      if (operation === 'poll') return hostStarted ? respond(queue.shift() ?? {}) : respond({error:'房间已经关闭'}, 410);
      if (operation === 'reply') {
        replies.get(body.id)?.(body.payload);
        replies.delete(body.id);
        return respond({ok:true});
      }
      if (operation === 'connect') {
        if (seat === 'W' && westOffline) return respond({error:'连接中断'}, 503);
        if (!hostStarted) return respond({error:'房间已经关闭'}, 410);
        assert.equal(body.address, '192.168.1.8');
        assert.equal(body.port, 51894);
        const ticket = ++id;
        const response = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Host adapter reply timeout')), 10000);
          replies.set(ticket, value => { clearTimeout(timer); resolve(value); });
          queue.push({ id: ticket, payload: body.payload });
        });
        if (body.payload.kind === 'action' && response.ok) actions.push(body.payload.action.kind);
        if (response.code === 'ROOM_CLOSED') closureReplies.add(seat);
        return respond(response);
      }
      throw new Error('Unexpected operation ' + operation);
    });
    await page.goto(new URL('#/online', appUrl).href, {waitUntil:'domcontentloaded',timeout:90000});
    console.log('Page loaded', seat);
    await expect(page.getByRole('heading', {name:'局域网联机'})).toBeVisible();
  }
  const host = pages.N;
  await host.getByLabel('北家', {exact:true}).check();
  await host.getByRole('button', {name:'创建房间'}).click();
  const codeHeading = host.getByRole('heading', {name:/房间 [A-Z0-9]{6}/});
  await expect(codeHeading).toBeVisible();
  const code = (await codeHeading.textContent()).split(' ').at(-1);
  for (const seat of seats.slice(1)) {
    const page = pages[seat];
    await expect(page.getByRole('button', {name:'创建房间'})).toHaveCount(0);
    await page.getByLabel(seatNames[seat]+'家',{exact:true}).check();
    await page.getByLabel('房主地址').fill('192.168.1.8:51894');
    await page.getByLabel('房间码').fill(code.toLowerCase());
    await page.getByRole('button',{name:'加入房间'}).click();
    await expect(page.getByRole('heading',{name:'房间 '+code})).toBeVisible();
  }
  evidence.checks.push('Android-style host creation; three guest browser sessions join distinct seats');
  for (const [index, seat] of seats.entries()) {
    const lobby = pages[seat].getByRole('region',{name:'房间信息'});
    await expect(lobby.getByText(/^在线 · (?:已|未)准备$/)).toHaveCount(4);
    await expect(lobby.getByText('在线 · 已准备', {exact:true})).toHaveCount(index);
    await expect(pages[seat].getByRole('region', {name:/我的手牌/})).toHaveCount(0);
    await pages[seat].getByRole('button',{name:'准备',exact:true}).click();
  }
  for (const seat of seats) {
    await expect(pages[seat].getByRole('region',{name:/我的手牌/}).getByRole('button')).toHaveCount(13);
    await expect(pages[seat].getByRole('region',{name:/^明手/})).toHaveCount(0);
  }
  evidence.checks.push('All ready required; each seat renders only 13 own cards during auction');
  const west = pages.W;
  await west.reload({waitUntil:'domcontentloaded'});
  await expect(west.getByText('已连接',{exact:true})).toBeVisible();
  await expect(west.getByRole('region',{name:/我的手牌/}).getByRole('button')).toHaveCount(13);
  evidence.checks.push('Guest reload automatically restores the original seat');
  await host.getByRole('button',{name:'叫 1C',exact:true}).click();
  for (const seat of seats.slice(1)) await pages[seat].getByRole('button',{name:'不叫',exact:true}).click();
  await expect(host.getByRole('region',{name:/^明手/})).toHaveCount(0);
  const first = pages.E.getByRole('region',{name:/我的手牌/}).locator('button:enabled').first();
  await first.click();
  await expect(host.getByRole('region',{name:'明手 · 南家'}).locator('button:enabled').first()).toBeVisible();
  await expect(pages.S.getByRole('region',{name:/我的手牌/}).locator('button:enabled')).toHaveCount(0);
  evidence.checks.push('Auction 1C followed by three passes; opening lead reveals dummy; declarer alone can play dummy');
  westOffline = true;
  await expect(west.getByText('连接已断开',{exact:true})).toBeVisible();
  await expect(host.getByText(/有玩家离线，牌局已暂停/)).toBeVisible({timeout:20000});
  await expect(host.getByRole('region',{name:'明手 · 南家'}).locator('button:enabled')).toHaveCount(0);
  westOffline = false;
  await west.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(west.getByText('已连接',{exact:true})).toBeVisible();
  await expect(host.getByRole('region',{name:'明手 · 南家'}).locator('button:enabled').first()).toBeVisible();
  evidence.checks.push('Interrupted guest connection pauses play; online event automatically restores the same seat and unlocks play');
  await host.setViewportSize({ width: 320, height: 568 });
  await host.getByRole('region',{name:'局域网联机'}).evaluate(section => section.scrollIntoView({ block: 'start' }));
  const dummyButton = host.getByRole('region',{name:'明手 · 南家'}).locator('button:enabled').first();
  const dummyBox = await dummyButton.boundingBox();
  const handBox = await host.getByRole('region',{name:/我的手牌/}).boundingBox();
  const navBox = await host.getByRole('navigation').first().boundingBox();
  assert.ok(dummyBox && handBox && navBox && dummyBox.y >= 0 && dummyBox.y + dummyBox.height < navBox.y && dummyBox.y < handBox.y);
  evidence.checks.push('At 320×568 the actionable dummy card sits above own hand and remains above the bottom navigation');
  await host.setViewportSize({ width: 390, height: 844 });
  await host.getByRole('region',{name:'房间信息'}).locator('summary').click();
  await host.getByRole('button',{name:'离开房间'}).click();
  await expect(host.getByRole('region',{name:'确认离开房间'})).toBeVisible();
  await host.getByRole('button',{name:'返回房间'}).click();
  await expect(host.getByRole('region',{name:'确认离开房间'})).toHaveCount(0);
  evidence.checks.push('Host exit requires confirmation during play; cancel preserves room');
  for (let played = 1; played < 52; played++) {
    const { card, visibleHand } = await Promise.any(seats.map(async seat => {
      const visibleHand = pages[seat].getByRole('region',{name:/我的手牌|^明手/});
      const card = visibleHand.locator('button:enabled').first();
      await card.waitFor({state:'visible',timeout:7000});
      return { card, visibleHand };
    }));
    const cardId = await card.getAttribute('data-card');
    await card.click();
    await expect(visibleHand.locator('[data-card="' + cardId + '"]')).toHaveCount(0);
    if (played % 10 === 0) console.log('Card', played + 1);
  }
  await expect(host.getByRole('region',{name:'本副结算'})).toBeVisible();
  for (const seat of seats.slice(1)) {
    await expect(pages[seat].getByRole('region',{name:'本副结算'})).toBeVisible();
    await expect(pages[seat].getByRole('button',{name:'下一副'})).toBeDisabled();
  }
  const scores = await Promise.all(seats.map(seat => pages[seat].getByRole('region',{name:'本副结算'}).locator('p').nth(1).textContent()));
  assert.equal(new Set(scores).size, 1);
  evidence.score = scores[0];
  await host.getByRole('button',{name:'下一副'}).click();
  for (const seat of seats) await expect(pages[seat].getByText('第 2 副',{exact:true})).toBeVisible();
  evidence.checks.push('52 cards played by UI, synchronized score, host-only next board and rotation');
  const roomDetails = host.getByRole('region',{name:'房间信息'});
  if (!(await roomDetails.getByRole('button',{name:'离开房间'}).isVisible())) await roomDetails.locator('summary').click();
  await roomDetails.getByRole('button',{name:'离开房间'}).click();
  await host.getByRole('button',{name:'确认离开',exact:true}).click();
  for (const seat of seats.slice(1)) {
    await expect(pages[seat].getByText('房主已关闭房间。',{exact:true})).toBeVisible();
    await expect(pages[seat].getByRole('button',{name:'重新连接'})).toHaveCount(0);
  }
  assert.deepEqual([...closureReplies].sort(), seats.slice(1).sort());
  evidence.checks.push('An explicit closed-room response clears the guest session and stops retry');

  await host.getByRole('button', {name:'创建房间'}).click();
  await expect(codeHeading).toBeVisible();
  const mixedCode = (await codeHeading.textContent()).split(' ').at(-1);
  await host.getByRole('button', {name:'准备', exact:true}).click();
  await host.getByRole('button', {name:'机器人补位开局'}).click();
  const confirmRobots = host.getByRole('region', {name:'确认机器人补位'});
  await expect(confirmRobots).toContainText('3 个空位');
  await expect(host.getByRole('region', {name:/我的手牌/})).toHaveCount(0);
  const east = pages.E;
  await east.getByLabel('房主地址').fill('192.168.1.8:51894');
  await east.getByLabel('房间码').fill(mixedCode);
  await east.getByRole('button', {name:'加入房间'}).click();
  await expect(east.getByRole('heading', {name:'房间 '+mixedCode})).toBeVisible();
  await expect(confirmRobots).toHaveCount(0);
  await expect(east.getByRole('button', {name:'机器人补位开局'})).toHaveCount(0);
  await expect(host.getByRole('button', {name:'机器人补位开局'})).toBeDisabled();
  await east.getByRole('button', {name:'准备', exact:true}).click();
  await host.getByRole('button', {name:'机器人补位开局'}).click();
  await expect(confirmRobots).toContainText('2 个空位');
  await confirmRobots.getByRole('button', {name:'继续等人'}).click();
  await expect(confirmRobots).toHaveCount(0);
  await expect(east.getByRole('region', {name:/我的手牌/})).toHaveCount(0);
  await host.getByRole('button', {name:'机器人补位开局'}).click();
  await confirmRobots.getByRole('button', {name:'确认补位并开局'}).click();
  for (const page of [host, east]) await expect(page.getByRole('region', {name:/我的手牌/}).getByRole('button')).toHaveCount(13);
  if (!(await roomDetails.getByText('机器人', {exact:true}).first().isVisible())) await roomDetails.locator('summary').click();
  await expect(roomDetails.getByText('机器人', {exact:true})).toHaveCount(2);
  await host.getByRole('button', {name:'7', exact:true}).click();
  await host.getByRole('button', {name:'叫 7NT', exact:true}).click();
  await east.getByRole('button', {name:'不叫', exact:true}).click();
  await east.getByRole('region', {name:/我的手牌/}).locator('button:enabled').first().click();
  const hostDummy = host.getByRole('region', {name:'明手 · 南家'});
  const eastDummy = east.getByRole('region', {name:'明手 · 南家'});
  await expect(eastDummy).toBeVisible();
  await expect(eastDummy.locator('button:enabled')).toHaveCount(0);
  await hostDummy.locator('button:enabled').first().click();
  await expect(host.getByText('轮到你行动', {exact:true})).toBeVisible();
  evidence.checks.push('Host-only robot confirmation refreshes when a guest joins; waiting keeps hands hidden; confirmed bots bid and play, and the human declarer controls robot dummy');

  evidence.guestActions = actions.length;
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed';
  evidence.error = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  const evidencePath = process.env.BRIDGELAB_TEST_LAN_EVIDENCE ?? 'artifacts/lan-e2e-results.json';
  if (!process.env.BRIDGELAB_TEST_LAN_EVIDENCE) await mkdir('artifacts', {recursive:true});
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
  await browser?.close();
  if (vite) await Promise.race([vite.close(), new Promise(resolve => setTimeout(resolve, 2000))]);
}


process.exit(process.exitCode ?? 0);
