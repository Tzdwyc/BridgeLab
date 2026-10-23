import { test, expect, type Page } from '@playwright/test';
import { newGame, applyCall } from '../../src/core/game';
import { robotStep } from '../../src/controller/robot';
import { PASS, type Seat } from '../../src/core/types';

async function instant(page: Page) {
  await page.getByRole('button',{name:'设置',exact:true}).click();
  const strength = page.getByLabel('打牌强度');
  if (await strength.isEnabled()) await strength.selectOption('basic');
  else await expect(strength).toHaveValue('basic');
  await page.getByLabel('机器人行动速度').selectOption('0');
  await page.getByRole('button',{name:'关闭',exact:true}).click();
}
async function start(page: Page, seed: string, strength: 'basic' | 'standard' = 'basic') {
  await page.getByRole('link',{name:'新牌局',exact:true}).click();
  await page.getByText('复现发牌（可选）',{exact:true}).click();
  await page.getByLabel('随机种子',{exact:true}).fill(seed);
  await page.getByLabel('本场打牌强度',{exact:true}).selectOption(strength);
  await page.getByRole('button',{name:'开始比赛 →',exact:true}).click();
}
async function waitDecision(page: Page) {
  await expect.poll(async()=>{
    const app=page.getByTestId('app');const phase=await app.getAttribute('data-phase');const seat=await app.getAttribute('data-controller');
    return phase==='complete'||phase==='passedOut'||seat==='S';
  },{timeout:30000}).toBe(true);
}
async function forceSouthDeclarer(page: Page) {
  await waitDecision(page);const app=page.getByTestId('app');
  await expect(app).toHaveAttribute('data-phase','auction');
  const firstNorthCall=await page.getByLabel('叫牌历史',{exact:true}).locator('div').nth(1).locator(':scope > span').first().innerText();
  // Select a strain North has not named; the final contract's first bidder is South.
  const strain=firstNorthCall.includes('NT')?'S':'NT';
  await page.getByRole('button',{name:`叫 7${strain}`,exact:true}).click();
  await expect(app).toHaveAttribute('data-phase','play');
  await expect(page.getByLabel('明手',{exact:true})).toBeVisible();
  await expect(page.getByText('南家控制明手',{exact:true})).toBeVisible();
}
async function finishThroughUI(page: Page, withHints=false) {
  let decisions=0;
  for(let guard=0;guard<100;guard++) {
    await waitDecision(page);const phase=await page.getByTestId('app').getAttribute('data-phase');
    if(phase==='complete'||phase==='passedOut') return decisions;
    if(withHints) {
      await page.getByRole('button',{name:'◇ 提示',exact:true}).click();
      const suggested=page.locator('button[data-recommended="true"]:not([disabled])');
      await expect(suggested).toHaveCount(1);await suggested.click();
    } else if(phase==='auction') await page.getByRole('button',{name:'不叫 Pass',exact:true}).click();
    else {
      const legal=page.locator('button[data-card]:not([disabled])');await expect(legal.first()).toBeVisible();await legal.first().click();
    }
    decisions++;
  }
  throw new Error('The UI game exceeded 100 human decisions');
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
}

test('complete user game, declarer dummy control, meaningful undo, reload and next board',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/#/table');await expect(page.getByRole('button',{name:'开始游戏',exact:true})).toBeVisible();
  await instant(page);await start(page,'ui-human-declarer-v1');await forceSouthDeclarer(page);
  await waitDecision(page);await noOverflow(page);
  if(info.project.name==='mobile') {
    const table=page.getByTestId('bridge-table');
    await expect(table.getByLabel('我的手牌',{exact:true})).toBeVisible();
    await expect(table.getByLabel('明手',{exact:true})).toBeVisible();
  }
  const actionPoint=await page.getByTestId('app').getAttribute('data-actions');
  const firstCard=page.locator('button[data-card]:not([disabled])').first();
  const cardBounds=await firstCard.boundingBox();expect(cardBounds!.width).toBeGreaterThanOrEqual(44);expect(cardBounds!.height).toBeGreaterThanOrEqual(44);
  await expect(firstCard.locator('svg[data-suit]')).toHaveCount(1);
  const pipBounds=await firstCard.locator('svg[data-suit]').boundingBox();
  expect(Math.abs(pipBounds!.x+pipBounds!.width/2-(cardBounds!.x+cardBounds!.width/2))).toBeLessThan(2);
  await firstCard.click();await waitDecision(page);
  await page.getByRole('button',{name:'↶ 悔牌',exact:true}).click();
  await expect(page.getByTestId('app')).toHaveAttribute('data-actions',actionPoint!);
  await expect(page.getByTestId('app')).toHaveAttribute('data-controller','S');
  const handBefore=await page.locator('button[data-card]').evaluateAll(cards=>cards.map(c=>c.getAttribute('data-card')));
  await page.reload();await expect(page.getByTestId('app')).toHaveAttribute('data-actions',actionPoint!);
  expect(await page.locator('button[data-card]').evaluateAll(cards=>cards.map(c=>c.getAttribute('data-card')))).toEqual(handBefore);
  await page.screenshot({path:`artifacts/${info.project.name}-table.png`,fullPage:true});
  expect(await finishThroughUI(page)).toBe(26);
  await expect(page.getByTestId('result')).toBeVisible();await expect(page.getByText('已完成 13 墩 · 查看记录',{exact:true})).toBeVisible();
  const score=Number(await page.getByTestId('board-score').innerText());expect(Number(await page.getByTestId('cumulative-score').innerText())).toBe(score);
  await page.getByRole('button',{name:'复盘四家手牌',exact:true}).click();await expect(page.getByText('北家 · 原始手牌',{exact:true})).toBeVisible();
  await page.screenshot({path:`artifacts/${info.project.name}-result.png`,fullPage:true});
  await page.getByRole('button',{name:'↶ 悔牌',exact:true}).click();await expect(page.getByTestId('app')).toHaveAttribute('data-phase','play');
  await finishThroughUI(page);expect(Number(await page.getByTestId('board-score').innerText())).toBe(score);
  await page.getByRole('button',{name:'下一副牌 →',exact:true}).click();await expect(page.getByText('第 2 副',{exact:true})).toBeVisible();
  await finishThroughUI(page,true);await expect(page.getByTestId('result')).toBeVisible();await noOverflow(page);
  const second=Number(await page.getByTestId('board-score').innerText());expect(Number(await page.getByTestId('cumulative-score').innerText())).toBe(score+second);
  await page.reload();await expect(page.getByTestId('result')).toBeVisible();expect(Number(await page.getByTestId('cumulative-score').innerText())).toBe(score+second);
  expect(errors).toEqual([]);
});

test('cached PWA reloads offline and completes all 13 tricks without network',async({page,context},info)=>{
  await page.goto('/#/table');await expect(page.getByText('● 离线资源已缓存',{exact:true})).toBeVisible({timeout:30000});
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await instant(page);await context.setOffline(true);await page.reload();
  await expect(page.getByRole('button',{name:'开始游戏',exact:true})).toBeVisible();await expect(page.getByText('● 离线模式',{exact:true})).toBeVisible();
  await start(page,'offline-board-v1');await forceSouthDeclarer(page);expect(await finishThroughUI(page)).toBe(26);
  await expect(page.getByTestId('result')).toBeVisible();await expect(page.getByText('已完成 13 墩 · 查看记录',{exact:true})).toBeVisible();
  await page.reload();await expect(page.getByTestId('result')).toBeVisible();await noOverflow(page);
  await page.screenshot({path:`artifacts/${info.project.name}-offline.png`,fullPage:true});
});

test('corrupt save is preserved and player can recover by starting a real game',async({page})=>{
  await page.addInitScript(()=>{localStorage.setItem('bridgelab.session.v3.6','{bad-json');});
  await page.goto('/#/table');await expect(page.getByRole('alert')).toContainText('已保留原始备份');
  expect(await page.evaluate(()=>Object.keys(localStorage).some(key=>key.includes('.rejected.')))).toBe(true);
  await instant(page);await start(page,'corrupt-save-recovery');await forceSouthDeclarer(page);await finishThroughUI(page);
  await expect(page.getByTestId('result')).toBeVisible();
});

test('PWA manifest, local resources and 1280px desktop bidding are usable',async({page})=>{
  await page.goto('/#/table');const manifestHref=await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest=await(await page.request.get(manifestHref!)).json();expect(manifest.display).toBe('standalone');expect(manifest.name).toContain('v0.3.6');expect(manifest.icons).toHaveLength(3);
  for(const icon of manifest.icons) expect((await page.request.get(icon.src)).ok()).toBe(true);
  await page.setViewportSize({width:1280,height:800});await instant(page);await start(page,'small-desktop');await waitDecision(page);await noOverflow(page);
  const bidButton=page.getByRole('button',{name:'叫 7NT',exact:true});const bounds=await bidButton.boundingBox();expect(bounds!.width).toBeGreaterThanOrEqual(44);expect(bounds!.height).toBeGreaterThanOrEqual(44);
  await page.getByRole('button',{name:'重打本副',exact:true}).click();await page.getByRole('button',{name:'确认重打',exact:true}).click();await expect(page.getByTestId('app')).toHaveAttribute('data-phase','auction');
  await waitDecision(page);await noOverflow(page);
});

function auctionFixture(declarer: Seat): string {
  for(let i=0;i<500;i++) {
    const seed=`ui-role-${declarer}-${i}`;let game=newGame(1,`${seed}:board:1`);
    for(let guard=0;guard<100&&game.phase==='auction';guard++) game=game.turn==='S'?applyCall(game,'S',PASS):robotStep(game).game;
    if(game.phase==='play'&&game.contract?.declarer===declarer)return seed;
  }
  throw new Error(`No deterministic auction fixture for ${declarer}`);
}

test('human defends with only South cards; AI declarer operates the revealed dummy',async({page})=>{
  await page.goto('/#/table');await instant(page);await start(page,auctionFixture('E'));
  let played=0;
  for(let guard=0;guard<100;guard++) {
    await waitDecision(page);const phase=await page.getByTestId('app').getAttribute('data-phase');if(phase==='complete')break;
    if(phase==='auction')await page.getByRole('button',{name:'不叫 Pass',exact:true}).click();
    else {
      const legal=page.locator('button[data-card]:not([disabled])');expect(await legal.evaluateAll(cards=>cards.every(c=>c.getAttribute('data-seat')==='S'))).toBe(true);
      await legal.first().click();played++;
    }
  }
  expect(played).toBe(13);await expect(page.getByTestId('result')).toBeVisible();await expect(page.getByText('已完成 13 墩 · 查看记录',{exact:true})).toBeVisible();
});

test('North AI declarer controls South dummy and finishes without illegal human clicks',async({page})=>{
  await page.goto('/#/table');await instant(page);await start(page,auctionFixture('N'));
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByLabel('机器人行动速度').selectOption('250');await page.getByRole('button',{name:'关闭',exact:true}).click();
  await waitDecision(page);await page.getByRole('button',{name:'不叫 Pass',exact:true}).click();
  // Any additional South auction turns are passed, but South does not play its own dummy.
  for(let guard=0;guard<20;guard++) {
    const phase=await page.getByTestId('app').getAttribute('data-phase');if(phase==='play')break;
    await expect.poll(async()=>{const app=page.getByTestId('app');return await app.getAttribute('data-phase')==='play'||await app.getAttribute('data-controller')==='S';}).toBe(true);
    if(await page.getByTestId('app').getAttribute('data-phase')==='auction')await page.getByRole('button',{name:'不叫 Pass',exact:true}).click();
  }
  await expect(page.getByText('你的明手',{exact:true})).toBeVisible();
  await expect(page.locator('button[data-card]:not([disabled])')).toHaveCount(0);
  await instant(page);await expect(page.getByTestId('result')).toBeVisible({timeout:15000});await expect(page.getByText('已完成 13 墩 · 查看记录',{exact:true})).toBeVisible();
});

test('random deal works when randomUUID is unavailable on a LAN HTTP browser',async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(crypto,'randomUUID',{value:undefined}));
  await page.goto('/#/table');await instant(page);await page.getByRole('button',{name:'开始游戏',exact:true}).click();
  await expect(page.getByTestId('app')).toHaveAttribute('data-phase','auction');await waitDecision(page);await finishThroughUI(page);
  await expect(page.getByTestId('result')).toBeVisible();
});

test('sampled DDS hint is produced from public information and selects one legal card',async({page})=>{
  await page.goto('/#/table');await instant(page);await start(page,'sampled-dds-hint-v03','standard');await forceSouthDeclarer(page);await waitDecision(page);
  // Only a genuine choice needs sampling. The 2.5s robot budgets can lead to
  // different legal continuations; a forced follow must retain its fast path.
  for(let forced=0;forced<20;forced++) {
    const legal=page.locator('button[data-card]:not([disabled])');
    if(await legal.count()>1) break;
    await expect(legal).toHaveCount(1);await legal.first().click();await waitDecision(page);
  }
  expect(await page.locator('button[data-card]:not([disabled])').count()).toBeGreaterThan(1);
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await expect(page.getByLabel('打牌强度')).toHaveValue('standard');
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'◇ 提示',exact:true}).click();
  await expect(page.getByText(/8 个公开信息样本，本地 DDS/)).toBeVisible({timeout:30000});
  const suggested=page.locator('button[data-recommended="true"]:not([disabled])');
  await expect(suggested).toHaveCount(1);await suggested.click();
  await expect(page.getByTestId('app')).not.toHaveAttribute('data-actions','0');
});

test('DDS adjudicates a saved claim without inventing a full play record',async({page},info)=>{
  await page.goto('/#/table');await instant(page);await start(page,'dds-claim-v03');await forceSouthDeclarer(page);await waitDecision(page);
  const before=await page.getByTestId('app').getAttribute('data-actions');
  await page.getByRole('button',{name:'摊牌声称',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'摊牌声称'});await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('声称摊牌')).toBeVisible();
  await expect(dialog.getByTestId('claim-hand-S')).toBeVisible();
  await page.getByLabel('南北方声称再得墩数').selectOption('0');
  await page.getByRole('button',{name:'提交声称',exact:true}).click();
  await expect(page.getByTestId('result')).toBeVisible({timeout:30000});
  await expect(page.getByText('第 1 副 · DDS 声称结算',{exact:true})).toBeVisible();
  await expect(page.getByLabel('声称时四家余牌')).toBeVisible();
  for(const seat of ['N','E','S','W'])await expect(page.getByTestId(`claim-hand-${seat}`)).toBeVisible();
  await expect(page.getByRole('button',{name:'主桌逐墩分析 →',exact:true})).toBeEnabled();
  expect(Number(await page.getByTestId('app').getAttribute('data-actions'))).toBe(Number(before)+1);
  await page.reload();await expect(page.getByText('第 1 副 · DDS 声称结算',{exact:true})).toBeVisible();
  await page.screenshot({path:`artifacts/${info.project.name}-claim.png`,fullPage:true});
  await page.getByRole('button',{name:'主桌逐墩分析 →',exact:true}).click();
  await expect(page.getByTestId('claim-analysis-cutoff')).toBeVisible();
  await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-cursor','0');
  await page.getByRole('link',{name:'牌桌',exact:true}).click();
  await page.getByRole('button',{name:'↶ 悔牌',exact:true}).click();
  await expect(page.getByTestId('app')).toHaveAttribute('data-phase','play');
  await expect(page.getByTestId('app')).toHaveAttribute('data-actions',before!);
});

test('bid meanings appear on desktop hover and mobile long press',async({page})=>{
  await page.goto('/#/table');await instant(page);await start(page,'bid-explanation-v03');await waitDecision(page);
  const bid=page.getByRole('button',{name:'叫 1C',exact:true});await expect(bid).toBeVisible();
  await bid.hover();const tooltip=page.getByRole('tooltip');await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText(/\d\+张/);await expect(tooltip).toContainText(/自然|人工|逼叫|阻击/);
  await expect(tooltip).toContainText('v0.3.6 · 10月16日修订');
  await expect(tooltip).not.toContainText('范围详见体系卡');await expect(tooltip).not.toContainText('自然叫牌／加叫');
  await page.waitForTimeout(5200);await expect(tooltip).toBeVisible();
  await page.mouse.move(0,0);await expect(page.getByRole('tooltip')).toHaveCount(0);
  await bid.dispatchEvent('pointerdown',{pointerType:'touch',pointerId:7,isPrimary:true});
  await page.waitForTimeout(650);
  await expect(page.getByRole('tooltip')).toBeVisible();
  await bid.dispatchEvent('pointerup',{pointerType:'touch',pointerId:7,isPrimary:true});
});

test('deal workbench assigns, saves, reloads and simulates a complete custom deal',async({page})=>{
  await page.goto('/#/deals');const editor=page.getByTestId('deal-editor');await expect(editor).toBeVisible();
  const seats=['北家','东家','南家','西家'];
  for(const seat of seats){
    await editor.getByRole('tab').filter({hasText:seat}).click();
    for(let card=0;card<13;card++) await editor.locator('button[aria-label$="未分配"]').first().click();
  }
  await page.getByLabel('牌例名称').fill('v0.3.6 四家自定义回归牌例');
  await page.getByLabel('发牌人').selectOption('N');await page.getByLabel('局况').selectOption('Both');
  await editor.getByRole('button',{name:'保存牌例',exact:true}).click();
  await expect(editor.getByRole('alert')).toContainText('已保存');
  await page.reload();await expect(editor.getByText('v0.3.6 四家自定义回归牌例',{exact:true})).toBeVisible();
  await editor.getByRole('button').filter({hasText:'v0.3.6 四家自定义回归牌例'}).click();
  await expect(editor.getByRole('alert')).toContainText('已载入');
  await editor.getByRole('button',{name:'保存并开始模拟',exact:true}).click();
  await expect(page.getByTestId('app')).toHaveAttribute('data-phase','auction');
  await instant(page);const southBefore=await page.locator('button[data-card]').evaluateAll(cards=>cards.map(card=>card.getAttribute('data-card')));
  await forceSouthDeclarer(page);await finishThroughUI(page);await expect(page.getByTestId('result')).toBeVisible();
  await page.getByRole('button',{name:'↶ 悔牌',exact:true}).click();await expect(page.getByTestId('app')).toHaveAttribute('data-phase','play');
  await page.getByRole('button',{name:'重打本副',exact:true}).click();await page.getByRole('button',{name:'确认重打',exact:true}).click();
  await waitDecision(page);expect(await page.locator('button[data-card]').evaluateAll(cards=>cards.map(card=>card.getAttribute('data-card')))).toEqual(southBefore);
});
