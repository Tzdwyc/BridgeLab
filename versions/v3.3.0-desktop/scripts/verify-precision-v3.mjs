import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:') && !/\.[cm]?[jt]s$/.test(specifier)) {
      for (const suffix of ['.ts', '/index.ts']) {
        const url = new URL(specifier + suffix, context.parentURL);
        if (statSync(fileURLToPath(url), { throwIfNoEntry: false })?.isFile()) return next(url.href, context);
      }
    }
    return next(specifier, context);
  },
});

const root = new URL('../', import.meta.url);
const legacy500 = process.argv.includes('--legacy500');
const label = legacy500 ? 'legacy500' : '512';
const output = new URL(legacy500 ? 'artifacts/precision-v3-legacy500/' : 'artifacts/precision-v3/', root);
mkdirSync(output, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hashes = {};
for (const entry of readdirSync(new URL('src/', root), { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const absolute = entry.parentPath + '/' + entry.name;
  const relative = absolute.slice(fileURLToPath(root).length).replaceAll('\\', '/');
  hashes[relative] = sha(readFileSync(absolute));
}
hashes['scripts/verify-precision-v3.mjs'] = sha(readFileSync(fileURLToPath(import.meta.url)));
const freezePath = new URL(`${label}-freeze.json`, output);
assert.ok(!existsSync(freezePath), 'Preserve an existing acceptance generation');
const seedPrefix = legacy500 ? 'v03-precision-' : 'BridgeLab/v3/precision/acceptance/20261106/';
const freeze = { count: legacy500 ? 500 : 512, seedPrefix, system: 'precision', sourceHashes: hashes };
writeFileSync(freezePath, JSON.stringify(freeze, null, 2) + '\n', { flag: 'wx' });

const { newGame, assertGameIntegrity } = await import('../src/core/game.ts');
const { robotStep, robotStepWithAdvisor, strategyFor } = await import('../src/controller/robot.ts');
const { observe } = await import('../src/ai/observation.ts');
const { analyzeAuctionSemantics, isArtificialBidAt, publicCallMeaningAt, publicNoTrumpQuestionAt } = await import('../src/ai/bidding-semantics.ts');
const { partnerOf } = await import('../src/core/types.ts');
const { agreementVersionFor } = await import('../src/ai/bid-strategy.ts');
const { getSLModelState } = await import('../src/ai/neural/browser-model.ts');
const { sameCall } = await import('../src/core/auction.ts');
const { diagnosePrecisionBid } = await import('../src/ai/precision.ts');
const advisor = { advise: async () => { throw new Error('This verification uses the deterministic play strategy'); } };
const rows = [];
for (let board = 1; board <= freeze.count; board++) {
  let game = { ...newGame(board, seedPrefix + board), biddingSystem: 'precision', agreementVersion: agreementVersionFor('precision') };
  const issues = [], decisions = [];
  let blocked = false;
  try {
  while (game.phase === 'auction' || game.phase === 'play') {
    assert.ok(game.actions.length < 350, 'Action cap ' + board);
    if (game.phase === 'auction') {
      const obs = observe(game);
      const before = analyzeAuctionSemantics(obs.auction, obs.seat, 'precision');
      const diagnostic = diagnosePrecisionBid(obs);
      const result = await robotStepWithAdvisor(game, 'precision', 'basic', advisor);
      const entry = result.game.auction.at(-1);
      assert.equal(result.warning, null);
      assert.ok(obs.legalCalls.some(call => sameCall(call, entry.call)), 'Illegal precision call ' + board);
      const meaning = publicCallMeaningAt(result.game.auction, game.auction.length, 'precision');
      if (diagnostic.status !== 'supported') issues.push({ index: game.auction.length, code: diagnostic.code, proposed: entry.call });
      if (diagnostic.status === 'supported' && !sameCall(diagnostic.call, entry.call)) issues.push({ index: game.auction.length, code: 'diagnostic-dispatch-mismatch' });
      if (result.game.phase !== 'auction' && entry.call.kind === 'pass' && before.mustBid)
        issues.push({ index: game.auction.length, code: 'forcing-auction-ended' });
      if (!meaning.defined) issues.push({ index: game.auction.length, code: 'undefined-selected-meaning', call: entry.call });
      const ntQuestionKind = { stayman: 'stayman', transfer: 'transfer', 'weak-minor-relay': 'weak-minor-relay' }[meaning.role];
      if (ntQuestionKind && publicNoTrumpQuestionAt(result.game.auction, game.auction.length, 'precision')?.kind !== ntQuestionKind)
        issues.push({ index: game.auction.length, code: 'question-meaning-api-mismatch', role: meaning.role });
      decisions.push({ seat: entry.seat, call: entry.call, role: meaning.role, hcpRange: meaning.hcpRange, lengths: meaning.suitMinimums,
        selection: diagnostic.selection, rejectedRuleCall: diagnostic.rejectedRuleCall });
      game = result.game;
    } else {
      const result = robotStep(game, strategyFor('precision'), 'precision');
      assert.equal(result.warning, null, 'Play fallback ' + board);
      game = result.game;
    }
    assertGameIntegrity(game);
  }
  } catch (error) {
    blocked = true;
    const obs = game.phase === 'auction' ? observe(game) : null;
    issues.push({ index: game.auction.length, code: 'execution-blocked', error: String(error),
      hand: obs?.hand, seat: obs?.seat, auction: game.auction, diagnostic: obs ? diagnosePrecisionBid(obs) : null });
  }
  if (game.contract) {
    const lastBid = game.auction.findLastIndex(entry => entry.call.kind === 'bid');
    const last = game.auction[lastBid], meaning = publicCallMeaningAt(game.auction, lastBid, 'precision');
    // Existing card exception: 1NT Stayman 2D denial fulfils the inquiry;
    // it is nonforcing. This does not exempt higher NT or shape/feature answers.
    const permittedDenial = meaning.role === 'stayman-answer' && last.call.level === 2 && last.call.strain === 'D'
      && game.auction.slice(0, lastBid).some((entry, index) => {
        const question = publicNoTrumpQuestionAt(game.auction, index, 'precision');
        const state = analyzeAuctionSemantics(game.auction, entry.seat, 'precision');
        return question?.kind === 'stayman' && question.platform.call.level === 1
          && question.platform.seat === last.seat && entry.seat === partnerOf(last.seat)
          && state.forcing === 'none' && !state.mustBid;
      });
    if (permittedDenial) decisions.push({ audit: 'existing-nonforcing-1nt-stayman-denial' });
    if (isArtificialBidAt(game.auction, lastBid, 'precision') && !permittedDenial) issues.push({ code: 'artificial-final-contract' });
  }
  rows.push({ board, seed: game.seed, phase: blocked ? 'blocked' : game.phase, contract: game.contract, scoreNS: game.result?.scoreNS,
    calls: game.auction.length, actions: game.actions.length, issues, decisions });
  if (board % 32 === 0) console.log(JSON.stringify({ completed: board, issues: rows.reduce((n, row) => n + row.issues.length, 0) }));
}
for (const [relative, hash] of Object.entries(hashes)) assert.equal(sha(readFileSync(new URL(relative, root))), hash, relative);
assert.equal(getSLModelState().loadedWeightsSHA256, null, 'Precision unexpectedly loaded SL');
const problems = rows.filter(row => row.issues.length);
const summary = { count: rows.length, completed: rows.filter(row => row.phase === 'complete').length,
  passedOut: rows.filter(row => row.phase === 'passedOut').length, auctionActions: rows.reduce((n, row) => n + row.calls, 0),
  problematicBoards: problems.length, issues: problems.flatMap(row => row.issues.map(issue => ({ board: row.board, ...issue }))),
  qualifiedNaturalSelections: rows.reduce((n, row) => n + row.decisions.filter(d => d.selection === 'qualified-natural').length, 0),
  naturalSLLoaded: false, agreementVersion: agreementVersionFor('precision'), sourceFreezeSHA256: sha(readFileSync(freezePath)) };
writeFileSync(new URL(`${label}-rows.json`, output), JSON.stringify(rows, null, 2) + '\n', { flag: 'wx' });
writeFileSync(new URL(`${label}-summary.json`, output), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(summary));
if (problems.length) process.exitCode = 1;
