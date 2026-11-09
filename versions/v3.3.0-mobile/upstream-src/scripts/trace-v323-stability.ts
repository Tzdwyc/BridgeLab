import { writeFileSync } from 'node:fs';
const version = process.argv[2] ?? 'v3.2.3-desktop';
const base = `F:/Bridge/versions/${version}/src`;
const { newGame, isFinished } = await import(`${base}/core/game.ts`);
const { observe } = await import(`${base}/ai/observation.ts`);
const { robotStep, strategyFor } = await import(`${base}/controller/robot.ts`);
const { evaluateHand } = await import(`${base}/ai/bidding.ts`);
const format = (call: any) => call.kind === 'bid' ? `${call.level}${call.strain}` : call.kind;
let found = false;
const systems = process.argv[3] ? [process.argv[3]] : ['sayc', 'two-over-one', 'precision'];
for (const system of systems) {
  for (let board = Number(process.argv[4] ?? 1); board <= Number(process.argv[5] ?? 500) && !found; board++) {
    let game = newGame(board, `v03-${system}-${board}`);
    for (let guard = 0; guard < 400 && !isFinished(game); guard++) {
      const before = game;
      const next = robotStep(game, strategyFor(system));
      if (next.warning) {
        const obs = observe(before);
        const report = { version, system, board, step: guard, warning: next.warning, phase: obs.phase,
          seat: obs.seat, prefix: before.auction.map((e: any) => `${e.seat}:${format(e.call)}`).join(' '),
          hand: obs.hand.map((c: any) => c.id), evaluation: evaluateHand(obs.hand),
          action: next.game.actions.at(-1) };
        writeFileSync(`artifacts/${version}-first-stability-fallback.json`, JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report)); found = true; break;
      }
      game = next.game;
    }
    if (process.argv[4]) console.log(JSON.stringify({ version, system, board, phase: game.phase, auction: game.auction.map((e: any) => `${e.seat}:${format(e.call)}`).join(' ') }));
  }
  console.log(`${version}: finished ${system}; fallback=${found}`);
  if (found) break;
}

