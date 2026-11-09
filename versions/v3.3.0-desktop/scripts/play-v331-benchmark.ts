import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';
import { suggestSystemBid } from '../../v3.2.1-desktop/src/ai/bid-strategy';
import { ensureSLReady, getSLModelState } from '../../v3.2.1-desktop/src/ai/neural/browser-model';
import { observe, type PlayObservation, type BiddingObservation } from '../../v3.2.1-desktop/src/ai/observation';
import { newGame, applyCall, playCard, newGameFromDeal, assertGameIntegrity } from '../../v3.2.1-desktop/src/core/game';
import { sideOf, type Hands, type AuctionEntry, type Contract, type Vulnerability, type Seat } from '../../v3.2.1-desktop/src/core/types';

export const POLICY = Object.freeze({ version: 1, development: 12, heldout: 96, samples: 8,
  deadlineMs: 1200, hardDeadlineMs: 1350, startupLimitMs: 10000, runWallLimitMs: 1800000, system: 'two-over-one', strength: 'standard',
  maxDealAttempts: 5000, claims: false, source: 'v3.2.1 suggestSystemBid; seed101-epoch08 SL; allowLookahead:false',
  sampling: 'Incremental deterministic seeds; complete old public-observation auction; only passed-out and filled-stratum exclusion. No DDS or play-result selection.',
  distribution: 'NT/major/minor equally weighted stress set, not natural deployment distribution' });
type Stratum = 'NT' | 'major' | 'minor';
type Partition = 'development' | 'heldout';
export interface FrozenBoard { id: string; partition: Partition; stratum: Stratum; attempt: number;
  board: number; seed: string; dealer: Seat; vulnerability: Vulnerability; hands: Hands;
  auction: AuctionEntry[]; contract: Contract }
const OUT = resolve('artifacts/v331-play/benchmark');
const OLD = resolve('../v3.2.1-desktop');
const PRIOR = resolve('../v3.3-desktop/artifacts/v33-play/benchmark');
const DEVELOPMENT_BASELINE = join(PRIOR,'development-2026-11-07T03-25-33-128Z');
export const INDEPENDENT_SEED_PREFIX = 'v331-empty-recovery-independent-20261107-';
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function json(path: string, value: unknown) { writeFileSync(path, JSON.stringify(value, null, 2) + '\n'); }
export function sourceManifest(root: string) {
  const files: Record<string, string> = {};
  function walk(dir: string) { for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, ent.name); if (ent.isDirectory()) walk(path);
    else if (/\.(ts|mts|mjs)$/.test(ent.name)) files[relative(root, path).replaceAll('\\', '/')] = digest(readFileSync(path));
  } }
  walk(join(root, 'src'));
  return { files, sha256: digest(JSON.stringify(files)) };
}
export function restoreBoard(board: FrozenBoard) {
  let state = newGameFromDeal(board.board, board.seed, board.hands, board.dealer, board.vulnerability);
  for (const entry of board.auction) state = applyCall(state, entry.seat, entry.call);
  if (JSON.stringify(state.contract) !== JSON.stringify(board.contract)) throw new Error('Frozen contract mismatch');
  assertGameIntegrity(state); return state;
}
export async function generateFrozenBoards(): Promise<{ boards: FrozenBoard[]; attempted: number; skipped: Record<string, number>; slModel: unknown }> {
  const originalFetch=globalThis.fetch;
  const modelAssets:Record<string,string>={};
  globalThis.fetch=async(input:any)=>{
    const url=typeof input==='string'?input:String(input.url??input);
    if(!url.startsWith('/models/')||url.includes('..'))throw new Error('Freeze fetch allows only old local model assets');
    const data=readFileSync(join(OLD,'public',url.slice(1)));modelAssets[url]=digest(data);
    return new Response(data);
  };
  try {
  await ensureSLReady(); const slModel=structuredClone(getSLModelState());
  if(slModel.profileId!=='seed101-epoch08'||slModel.loadedWeightsSHA256!=='41556ff0f83ced20eeea66a853b87269f3de0ac62b1aca75abce4bf9a63275e3')throw new Error('SL profile mismatch');
  const priorDocument=JSON.parse(readFileSync(join(PRIOR,'frozen-boards.json'),'utf8'));
  const boards: FrozenBoard[] = structuredClone(priorDocument.boards.filter((board:FrozenBoard)=>board.partition==='development'));
  if(boards.length!==12)throw new Error('Expected exactly 12 existing development boards');
  const counts:Record<Stratum,number>={NT:0,major:0,minor:0};
  const skipped = { passedOut: 0, filledStratum: 0 }; let attempt = 0;
  for (; attempt < POLICY.maxDealAttempts && boards.length < 108; attempt++) {
    const seed = `${INDEPENDENT_SEED_PREFIX}${attempt.toString().padStart(5, '0')}`;
    let state = newGame(attempt % 16 + 1, seed);
    for (let guard = 0; state.phase === 'auction'; guard++) {
      if (guard >= 160) throw new Error(`Nonterminating old auction ${attempt}`);
      const decision=await suggestSystemBid(observe(state) as BiddingObservation,{system:'two-over-one',allowLookahead:false});
      state = applyCall(state, state.turn, decision.call);
    }
    if (!state.contract) { skipped.passedOut++; continue; }
    const stratum: Stratum = state.contract.strain === 'NT' ? 'NT' : ['H', 'S'].includes(state.contract.strain) ? 'major' : 'minor';
    const partition: Partition = 'heldout';
    if (counts[stratum] >= 32) { skipped.filledStratum++; continue; }
    const index = ++counts[stratum];
    boards.push({ id: `${partition}-${stratum}-${index.toString().padStart(2, '0')}`, partition, stratum,
      attempt, board: state.board, seed, dealer: state.dealer, vulnerability: state.vulnerability,
      hands: structuredClone(state.initialHands), auction: structuredClone(state.auction), contract: structuredClone(state.contract) });
  }
  if (boards.length !== 108) throw new Error(`Freeze exhausted ${attempt} attempts; no scope expansion`);
  return { boards, attempted: attempt, skipped, slModel:{...slModel,consumedLocalAssetSha256:modelAssets} };
  } finally {globalThis.fetch=originalFetch;}
}
export async function freeze() {
  mkdirSync(OUT, { recursive: true }); const path = join(OUT, 'frozen-boards.json');
  if (existsSync(path)) throw new Error('Frozen board file already exists; refusing overwrite');
  const old = sourceManifest(OLD); const generated = await generateFrozenBoards();
  if(sourceManifest(OLD).sha256!==old.sha256)throw new Error('Old source changed during input generation');
  const baselineReuse=developmentBaselineProvenance(generated.boards.filter(board=>board.partition==='development'));
  const document = { createdAt: new Date().toISOString(), policy: POLICY, oldSource: old, ...generated,
    independentSeedPrefix:INDEPENDENT_SEED_PREFIX,baselineReuse,
    interpretation:'Only the newly generated 96 heldout boards are independent of prior diagnostic play results. The original v3.3 96 boards are development material and are excluded. Development reuses the original 12 boards and 12 old tables.' };
  json(path, document); const sha256 = digest(readFileSync(path));
  json(join(OUT, 'freeze-manifest.json'), { createdAt: document.createdAt, file: 'frozen-boards.json', sha256,
    oldSourceSha256: old.sha256, boardCount: generated.boards.length, policy: POLICY,
    independentSeedPrefix:INDEPENDENT_SEED_PREFIX,baselineReuse,modelAssets:(generated.slModel as any).consumedLocalAssetSha256 });
  return { sha256, attempted: generated.attempted, skipped: generated.skipped, boardCount: generated.boards.length };
}

/** Reuse only the approved prior 12 old tables, with exact board and file provenance. */
export function developmentBaselineProvenance(boards:FrozenBoard[]) {
  const prior=JSON.parse(readFileSync(join(PRIOR,'frozen-boards.json'),'utf8'));
  const freeze=JSON.parse(readFileSync(join(PRIOR,'freeze-manifest.json'),'utf8'));
  if(digest(readFileSync(join(PRIOR,'frozen-boards.json')))!==freeze.sha256)throw new Error('Prior development board freeze changed');
  const policy=JSON.parse(readFileSync(join(DEVELOPMENT_BASELINE,'run-policy.json'),'utf8'));
  if(policy.freezeSha256!==freeze.sha256||policy.oldSourceSha256!==freeze.oldSourceSha256||policy.candidateSource!==null)throw new Error('Prior old-only baseline mismatch');
  const priorDevelopment=prior.boards.filter((board:FrozenBoard)=>board.partition==='development');
  if(boards.length!==12||digest(JSON.stringify(boards))!==digest(JSON.stringify(priorDevelopment)))throw new Error('Development boards must exactly reuse original 12');
  const baselineHashes:Record<string,string>={};
  for(const board of boards){
    const path=join(DEVELOPMENT_BASELINE,board.id+'-old.json');const row=JSON.parse(readFileSync(path,'utf8'));
    if(row.id!==board.id||row.variant!=='old'||!row.complete||row.playedCards!==52||row.claims!==0)throw new Error('Incomplete prior baseline');
    let state=restoreBoard(board);
    for(const action of row.actions.filter((action:any)=>action.kind==='play'))state=playCard(state,action.seat,action.cardId);
    if(state.phase!=='complete'||state.result?.breakdown.total!==row.declarerScore||state.result?.declarerTricks!==row.declarerTricks)throw new Error('Baseline replay does not match original development board');
    baselineHashes[board.id]=digest(readFileSync(path));
  }
  return {baseline:DEVELOPMENT_BASELINE,priorBoardFile:join(PRIOR,'frozen-boards.json'),priorFreezeSha256:freeze.sha256,
    oldSourceSha256:freeze.oldSourceSha256,developmentBoardsSha256:digest(JSON.stringify(boards)),baselineHashes};
}

export function assertFrozenInputs(document:any,manifest:any) {
  if(sourceManifest(OLD).sha256!==manifest.oldSourceSha256)throw new Error('Old source changed');
  for(const [url,expected]of Object.entries(manifest.modelAssets??{}))if(digest(readFileSync(join(OLD,'public',url.slice(1))))!==expected)throw new Error('Old model asset changed');
  if(JSON.stringify(developmentBaselineProvenance(document.boards.filter((board:FrozenBoard)=>board.partition==='development')))!==JSON.stringify(manifest.baselineReuse))throw new Error('Development baseline provenance changed');
}

export function scoreToImps(score: number) {
  const thresholds = [20,50,90,130,170,220,270,320,370,430,500,600,750,900,1100,1300,1500,1750,2000,2250,2500,3000,3500,4000];
  return Math.sign(score) * thresholds.filter(value => Math.abs(score) >= value).length;
}
export function quantile(values: number[], fraction: number) {
  if (!values.length) return null; const sorted = [...values].sort((a,b) => a-b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}
export function decisionClass(step: any) {
  if (step.timeout) return step.usedProgress ? 'hard-timeout-partial-sampled' : 'hard-timeout-safety';
  if (step.error) return step.usedProgress ? 'runtime-error-partial-sampled' : 'runtime-error-safety';
  if (step.engine === 'sampled-dds') return step.sampleCount < 8 ? 'partial-sampled' : 'full-sampled';
  if (step.reasonTags?.some((tag: string) => /只有一张/.test(tag))) return 'forced';
  return step.fallback ? 'engine-safety-fallback' : 'safety';
}
/** Mirrors the production client completeBatch boundary; malformed progress cannot be scored. */
export function completeProgressBatch(observation: PlayObservation, result: any): boolean {
  const legal=new Set(observation.legalCards.map(card=>card.id));
  return !!result && result.engine==='sampled-dds' && result.sampleCount>0 && legal.has(result.cardId)
    && Array.isArray(result.candidates) && result.candidates.length===legal.size
    && new Set(result.candidates.map((candidate:any)=>candidate.cardId)).size===legal.size
    && result.candidates.every((candidate:any)=>legal.has(candidate.cardId)&&candidate.support===result.sampleCount
      && Number.isFinite(candidate.expectedDeclarerTricks)&&Number.isFinite(candidate.makeRate));
}
export function summarizeSteps(steps: any[]) {
  const classes: Record<string, number> = {};
  for (const step of steps) { const key = decisionClass(step); classes[key] = (classes[key] ?? 0) + 1; }
  const times = steps.map(step => step.wallMs);
  return { count: steps.length, classes, p50Ms: quantile(times, .5), p95Ms: quantile(times, .95), maxMs: times.length ? Math.max(...times) : null,
    trueSafetyFallbacks: steps.filter(step => ['hard-timeout-safety','runtime-error-safety','engine-safety-fallback'].includes(decisionClass(step))).length };
}
export function pairedReport(rows: any[]) {
  const report: Record<string, any> = {};
  for (const role of ['declarer', 'defense']) {
    const paired = rows.filter(row => row.variant === role).map(row => {
      const old = rows.find(base => base.id === row.id && base.variant === 'old'); if (!old) return null;
      const sign = role === 'declarer' ? 1 : -1;
      return { id: row.id, stratum: row.stratum, imp: scoreToImps(sign * (row.declarerScore - old.declarerScore)),
        tricks: sign * (row.declarerTricks - old.declarerTricks),
        madeDelta: sign * (Number(row.made) - Number(old.made)), oldScore: old.declarerScore, newScore: row.declarerScore };
    }).filter(Boolean) as any[];
    const mean = (arr: number[]) => arr.length ? arr.reduce((a,b) => a+b,0)/arr.length : null;
    // Deterministic percentile bootstrap resamples complete boards, never individual decisions.
    let rng = 330007; const random = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng / 4294967296; };
    const bootstrap = paired.length ? Array.from({ length: 2000 }, () => mean(paired.map(() => paired[Math.floor(random()*paired.length)].imp))!) : [];
    report[role] = { n: paired.length, meanImp: mean(paired.map(row => row.imp)), meanTricks: mean(paired.map(row => row.tricks)),
      roleSuccessRateDelta: mean(paired.map(row => row.madeDelta)),
      roleSuccessDefinition:role==='declarer'?'contract made':'contract defeated', ci95Imp: [quantile(bootstrap,.025), quantile(bootstrap,.975)],
      rescues10Imp: paired.filter(row => row.imp >= 10), newLosses10Imp: paired.filter(row => row.imp <= -10), boards: paired };
  }
  return report;
}
export function evaluateGate(rows:any[],gate:any,partition:Partition){
  const paired=pairedReport(rows);const roles=['declarer','defense'];
  const metrics=summarizeSteps(rows.flatMap(row=>row.steps).filter(step=>step.version==='candidate'));
  const rescues=roles.reduce((n,role)=>n+paired[role].rescues10Imp.length,0);
  const losses=roles.reduce((n,role)=>n+paired[role].newLosses10Imp.length,0);
  const expected=partition==='heldout'?gate.heldoutBoards:gate.developmentBoards;
  const checks={completeScope:rows.length===expected*3&&roles.every(role=>paired[role].n===expected),
    legalCompleteNoClaims:rows.every(row=>row.complete&&row.playedCards===52&&row.claims===0),
    eachRoleMeanNonnegative:roles.every(role=>paired[role].meanImp!==null&&paired[role].meanImp>=gate.performance.eachRoleMeanImpAtLeast),
    positiveConfidenceAtLeastOneRole:roles.some(role=>paired[role].ci95Imp[0]!==null&&paired[role].ci95Imp[0]>gate.performance.atLeastOneRole95PercentConfidenceLowerBoundStrictlyAbove),
    totalRescuesExceedNewLosses:rescues>losses,
    eachRoleLossCountNotAboveRescue:roles.every(role=>paired[role].newLosses10Imp.length<=paired[role].rescues10Imp.length),
    candidateP95WithinHardLimit:metrics.p95Ms!==null&&metrics.p95Ms<=gate.performance.candidateP95DecisionMsAtMost};
  return {formal:partition==='heldout',passed:Object.values(checks).every(Boolean),checks,rescues10Imp:rescues,newLosses10Imp:losses,
    candidateMetrics:metrics,informationBoundary:'Only cloned observe() public observations sent to isolated advisor; source/production information-boundary review remains separately recorded.',
    interpretation:partition==='heldout'?gate.interpretation:'Development diagnostic only; does not establish heldout acceptance.'};
}

export async function buildAdapter(root: string, name: string) {
  const path = join(OUT, 'runtime', name + '.mjs'); mkdirSync(join(OUT,'runtime'), { recursive: true });
  const core = join(root,'src/ai/play-advisor-core.ts'); const playing = join(root,'src/ai/playing.ts');
  const runtimeExport=readFileSync(core,'utf8').includes('createPlayAdvisorRuntime')?'export { createPlayAdvisorRuntime } from '+JSON.stringify(core)+';':'';
  await build({ stdin: { contents: `export { advisePlay } from ${JSON.stringify(core)}; export { chooseCard } from ${JSON.stringify(playing)};${runtimeExport}`,
    resolveDir: root, sourcefile: 'benchmark-adapter.ts', loader: 'ts' }, outfile: path, bundle: true,
    platform: 'node', target: 'node24', format: 'esm' });
  return path;
}
const workerSource = `const {parentPort,workerData}=require('node:worker_threads');
(async()=>{ const mod=await import(workerData.moduleUrl); const runtime=mod.createPlayAdvisorRuntime?.()??{}; parentPort.postMessage({kind:'ready'});
parentPort.on('message',async(message)=>{const {observation,deadlineMs}=message;
try{const safe=mod.chooseCard(observation,'two-over-one'); parentPort.postMessage({kind:'safety',cardId:safe});
const onProgress=(decision)=>parentPort.postMessage({kind:'progress',decision});
const decision=await mod.advisePlay({observation,system:'two-over-one',strength:'standard',timeoutMs:deadlineMs,onProgress},undefined,{...runtime,onProgress});
parentPort.postMessage({kind:'result',decision});}catch(error){parentPort.postMessage({kind:'error',error:String(error)});}});
})().catch(error=>parentPort.postMessage({kind:'startup-error',error:String(error)}));`;
export class IsolatedAdvisor {
  worker: Worker | null = null; startupMs: number[] = [];
  constructor(public modulePath: string) {}
  async start() {
    if (this.worker) return; const start = performance.now();
    const worker = new Worker(workerSource, { eval: true, workerData: { moduleUrl: pathToFileURL(this.modulePath).href } });
    this.worker = worker;
    await new Promise<void>((accept,reject) => {
      const timer = setTimeout(() => { void worker.terminate(); this.worker=null; reject(new Error('Worker startup timeout')); }, POLICY.startupLimitMs);
      const done = (err?: Error) => { clearTimeout(timer); worker.off('message',message); worker.off('error',error); err ? reject(err) : accept(); };
      const error = (err: Error) => done(err);
      const message = (msg: any) => { if(msg.kind==='ready') done(); else if(msg.kind==='startup-error') done(new Error(msg.error)); };
      worker.on('message',message); worker.once('error',error);
    });
    this.startupMs.push(performance.now()-start);
  }
  async decide(observation: PlayObservation) {
    await this.start(); const worker = this.worker!; const start=performance.now();
    return await new Promise<any>((accept,reject)=>{
      let safety = observation.legalCards[0].id; let progress: any = null;
      const finish=(value: any)=>{clearTimeout(timer);worker.off('message',message);worker.off('error',error);
        const result={...value,wallMs:performance.now()-start}; accept(result);};
      const recovered=(reason:string,timeout=false)=>progress?{...progress,error:timeout?undefined:reason,timeout,usedProgress:true,fallback:true,
        elapsedMs:Math.max(progress.elapsedMs??0,performance.now()-start),reasonTags:[...(progress.reasonTags??[]),reason],
        diagnostics:{...progress.diagnostics,status:'partial',requestedSamples:progress.diagnostics?.requestedSamples??progress.sampleCount,
          completedSamples:progress.sampleCount,stopReason:reason}}:{cardId:safety,error:timeout?undefined:reason,timeout,engine:'safety',sampleCount:0};
      const error=(err:Error)=>{this.worker=null;void worker.terminate();finish(recovered(String(err)));};
      const timer=setTimeout(()=>{this.worker=null;void worker.terminate();
        finish(recovered('Hard decision deadline',true));},POLICY.hardDeadlineMs);
      const message=(msg:any)=>{if(msg.kind==='safety') safety=msg.cardId;
        else if(msg.kind==='progress' && completeProgressBatch(observation,msg.decision)
          && msg.decision.sampleCount>=(progress?.sampleCount??0)) progress=msg.decision;
        else if(msg.kind==='result') finish(msg.decision);
        else if(msg.kind==='error') finish(recovered(msg.error));};
      worker.on('message',message);worker.once('error',error);
      worker.postMessage({observation,deadlineMs:POLICY.deadlineMs});
    });
  }
  async close(){if(this.worker){await this.worker.terminate();this.worker=null;}}
}
export async function runBoard(board: FrozenBoard, variant: 'old'|'declarer'|'defense', oldModule: string, candidateModule?: string) {
  let state=restoreBoard(board); const started=performance.now(); const old=new IsolatedAdvisor(oldModule);
  const candidate=candidateModule ? new IsolatedAdvisor(candidateModule):null; const steps:any[]=[];
  try { while(state.phase==='play') {
    const obs=observe(state) as PlayObservation;
    if ('seed' in obs || 'hands' in obs || 'initialHands' in obs) throw new Error('Private state crossed observation boundary');
    const declaring=sideOf(obs.actingSeat)===sideOf(board.contract.declarer);
    const useCandidate=variant==='declarer'?declaring:variant==='defense'?!declaring:false;
    if(useCandidate&&!candidate)throw new Error('Candidate module required');
    const decision=await (useCandidate?candidate!:old).decide(obs);
    if(!obs.legalCards.some(card=>card.id===decision.cardId))throw new Error('Advisor produced illegal card');
    steps.push({ply:steps.length,seat:obs.actingSeat,role:declaring?'declarer':'defense',version:useCandidate?'candidate':'old',...decision});
    state=playCard(state,state.turn,decision.cardId);
  }
  if(state.phase!=='complete'||state.claim||steps.length!==52||state.completedTricks.length!==13)throw new Error('Incomplete/no-claim invariant failed');
  const tricks=state.result!.declarerTricks;
  return {id:board.id,stratum:board.stratum,partition:board.partition,variant,complete:true,claims:0,playedCards:52,
    declarerTricks:tricks,declarerScore:state.result!.breakdown.total,made:tricks>=board.contract.level+6,
    wallMs:performance.now()-started,startupMs:{old:old.startupMs,candidate:candidate?.startupMs??[]},
    metrics:summarizeSteps(steps),steps,actions:state.actions};
  } finally {await old.close();await candidate?.close();}
}
export async function main(args: string[]) {
  if(args[0]==='freeze'){console.log(JSON.stringify(await freeze()));return;}
  const candidateArg=args.find(arg=>arg.startsWith('--candidate='));
  if(args[0]==='freeze-formal-runtime'){
    const arg=args.find(arg=>arg.startsWith('--development='));if(!arg)throw new Error('Explicit development run required');
    const dir=resolve(arg.slice(14));if(!dir.toLowerCase().startsWith((OUT+'\\').toLowerCase()))throw new Error('Development path outside benchmark');
    const path=join(OUT,'formal-runtime-freeze.json');if(existsSync(path))throw new Error('Formal runtime already frozen');
    const prior=JSON.parse(readFileSync(join(dir,'run-policy.json'),'utf8'));
    if(prior.actualRunTables!==24||prior.reusedTables!==12)throw new Error('Expected development 24 candidate role tables with 12 reused old tables');
    const summary=JSON.parse(readFileSync(join(dir,'summary.json'),'utf8'));
    if(summary.completedTables!==36)throw new Error('Development incomplete');
    const tableMs:number[]=[];
    for(const entry of readdirSync(dir).filter(name=>/development-.*-(declarer|defense)\.json$/.test(name)))tableMs.push(JSON.parse(readFileSync(join(dir,entry),'utf8')).wallMs);
    for(const entry of readdirSync(prior.baseline).filter((name:string)=>/development-.*-old\.json$/.test(name)))tableMs.push(JSON.parse(readFileSync(join(prior.baseline,entry),'utf8')).wallMs);
    if(tableMs.length!==36)throw new Error('Expected 36 measured table timings');
    const mean=tableMs.reduce((a,b)=>a+b,0)/tableMs.length;
    const limitMs=Math.ceil(Math.max(1800000,2*mean*288));
    const gatePath=resolve('artifacts/v331-play/ACCEPTANCE_GATE.json');
    json(path,{createdAt:new Date().toISOString(),formula:'ceil(max(1800000, 2 * meanMeasuredDevelopmentTableMs * 288))',
      developmentRun:dir,developmentSummarySha256:digest(readFileSync(join(dir,'summary.json'))),meanMeasuredDevelopmentTableMs:mean,tableCount:36,
      expectedFormalTables:288,limitMs,acceptanceGateSha256:digest(readFileSync(gatePath))});console.log(JSON.stringify({limitMs,meanMeasuredDevelopmentTableMs:mean}));return;
  }
  if(args[0]==='freeze-candidate'){
    if(!candidateArg)throw new Error('Explicit --candidate= root required');
    const path=join(OUT,'candidate-freeze.json');if(existsSync(path))throw new Error('Refusing candidate freeze overwrite');
    if(!existsSync(join(OUT,'formal-runtime-freeze.json')))throw new Error('Complete the 24-table development timing and freeze wall cap before candidate freeze');
    const root=resolve(candidateArg.slice(12));const source=sourceManifest(root);
    if(root!==resolve('.'))throw new Error('Only this minimal v3.3.1 candidate may be frozen');
    const freezeManifest=JSON.parse(readFileSync(join(OUT,'freeze-manifest.json'),'utf8'));
    const adapter=await buildAdapter(root,'candidate-frozen');
    if(sourceManifest(root).sha256!==source.sha256)throw new Error('Candidate source changed during bundle');
    const harnessFiles=['scripts/play-v331-benchmark.ts','scripts/play-v331-cli.ts','artifacts/v331-play/benchmark/benchmark.test.ts','artifacts/v331-play/benchmark/vitest.config.ts'];
    const harness=Object.fromEntries(harnessFiles.map(file=>[file,digest(readFileSync(resolve(file)))]));
    json(path,{createdAt:new Date().toISOString(),root,source,adapter,adapterSha256:digest(readFileSync(adapter)),boardFreezeSha256:freezeManifest.sha256,
      harness,acceptanceGateSha256:digest(readFileSync(resolve('artifacts/v331-play/ACCEPTANCE_GATE.json'))),
      heldoutResultsPreviouslyAccessed:false,policy:POLICY});console.log(JSON.stringify({candidateSha256:source.sha256,adapterSha256:digest(readFileSync(adapter))}));return;
  }
  if(!['run-development','run-heldout'].includes(args[0]))throw new Error('Use freeze, run-development, freeze-candidate, or run-heldout');
  const freezeFile=join(OUT,'frozen-boards.json'); const manifest=JSON.parse(readFileSync(join(OUT,'freeze-manifest.json'),'utf8'));
  if(digest(readFileSync(freezeFile))!==manifest.sha256)throw new Error('Board freeze hash changed');
  const partition:Partition=args[0]==='run-heldout'?'heldout':'development';
  const document=JSON.parse(readFileSync(freezeFile,'utf8'));assertFrozenInputs(document,manifest);
  const boards=document.boards.filter((board:FrozenBoard)=>board.partition===partition);
  const module=await buildAdapter(OLD,'old');
  let candidate:string|undefined;let runWallLimitMs=POLICY.runWallLimitMs;
  if(partition==='heldout'){
    const gate=JSON.parse(readFileSync(join(OUT,'candidate-freeze.json'),'utf8'));
    if(gate.boardFreezeSha256!==manifest.sha256||sourceManifest(gate.root).sha256!==gate.source.sha256||digest(readFileSync(gate.adapter))!==gate.adapterSha256)
      throw new Error('Frozen candidate/source/board gate mismatch');
    if(gate.acceptanceGateSha256!==digest(readFileSync(resolve('artifacts/v331-play/ACCEPTANCE_GATE.json')))||Object.entries(gate.harness).some(([file,expected])=>digest(readFileSync(resolve(file)))!==expected))throw new Error('Frozen harness/acceptance gate changed');
    candidate=gate.adapter;
    const runtimeGate=JSON.parse(readFileSync(join(OUT,'formal-runtime-freeze.json'),'utf8'));
    if(runtimeGate.acceptanceGateSha256!==digest(readFileSync(resolve('artifacts/v331-play/ACCEPTANCE_GATE.json')))||runtimeGate.expectedFormalTables!==288)
      throw new Error('Formal runtime/acceptance gate mismatch');
    runWallLimitMs=runtimeGate.limitMs;
    const startSeal=join(OUT,'heldout-run-started.json');
    if(existsSync(startSeal))throw new Error('The one independent heldout run has already been started; refusing rerun');
    json(startSeal,{startedAt:new Date().toISOString(),candidateSourceSha256:gate.source.sha256,boardSha256:manifest.sha256,
      candidateManifestSha256:digest(readFileSync(join(OUT,'candidate-freeze.json'))),runtimeManifestSha256:digest(readFileSync(join(OUT,'formal-runtime-freeze.json'))),
      gateSha256:gate.acceptanceGateSha256,heldoutRunsStarted:1,stop:'No automatic rerun, retuning, or expansion after results.'});
  }else {
    if(!candidateArg||resolve(candidateArg.slice(12))!==resolve('.'))throw new Error('Development requires this minimal v3.3.1 candidate');
    candidate=await buildAdapter(resolve(candidateArg.slice(12)),'candidate-development');
  }
  const baselineArg=args.find(arg=>arg.startsWith('--baseline='));
  if(baselineArg&&(partition!=='development'||!candidate))throw new Error('Baseline reuse is only for development candidate role tables');
  const rows:any[]=[];const baselineHashes:Record<string,string>={};
  if(baselineArg){
    const baseline=resolve(baselineArg.slice(11));
    if(baseline!==DEVELOPMENT_BASELINE)throw new Error('Only the approved original 12-table baseline may be reused');
    const provenance=developmentBaselineProvenance(boards);
    if(provenance.oldSourceSha256!==manifest.oldSourceSha256)throw new Error('Baseline old-source freeze mismatch');
    for(const board of boards){const file=join(baseline,board.id+'-old.json');const row=JSON.parse(readFileSync(file,'utf8'));
      if(row.id!==board.id||row.variant!=='old'||!row.complete||row.playedCards!==52||row.claims!==0)throw new Error('Incomplete baseline table');
      rows.push(row);baselineHashes[board.id]=digest(readFileSync(file));}
  }
  if(partition==='development'&&(!candidate||!baselineArg))throw new Error('Development requires the minimal candidate and approved 12-table baseline; exactly 24 new tables');
  const reusedTables=rows.length;
  const candidateSourceAtStart=sourceManifest(partition==='heldout'?JSON.parse(readFileSync(join(OUT,'candidate-freeze.json'),'utf8')).root:resolve(candidateArg!.slice(12)));
  const sourceRootAtStart=partition==='heldout'?JSON.parse(readFileSync(join(OUT,'candidate-freeze.json'),'utf8')).root:resolve(candidateArg!.slice(12));
  const preservedFiles=['scripts/play-v331-benchmark.ts','scripts/play-v331-cli.ts','artifacts/v331-play/benchmark/benchmark.test.ts','artifacts/v331-play/benchmark/vitest.config.ts','artifacts/v331-play/ACCEPTANCE_GATE.json'];
  const preservedHashes=Object.fromEntries(preservedFiles.map(file=>[file,digest(readFileSync(resolve(file)))]));
  const variants=('old,declarer,defense'.split(',') as ('old'|'declarer'|'defense')[]).filter(v=>(candidate||v==='old')&&(!baselineArg||v!=='old'));
  const runStarted=performance.now();const runId=new Date().toISOString().replaceAll(/[:.]/g,'-'); const runDir=join(OUT,partition+'-'+runId);mkdirSync(runDir,{recursive:true});
  json(join(runDir,'run-policy.json'),{startedAt:new Date().toISOString(),policy:POLICY,freezeSha256:manifest.sha256,
    oldSourceSha256:manifest.oldSourceSha256,candidateSource:candidateSourceAtStart,variants,
    actualRunTables:boards.length*variants.length,reusedTables,baseline:baselineArg?.slice(11),baselineHashes,runWallLimitMs,totalTables:reusedTables+boards.length*variants.length});
  for(const board of boards)for(const variant of variants){
    if(performance.now()-runStarted>runWallLimitMs){json(join(runDir,'stopped.json'),{reason:'wall-clock limit',completedTables:rows.length,totalTables:reusedTables+boards.length*variants.length});throw new Error('Run wall-clock limit; partial artifacts preserved');}
    console.log(JSON.stringify({status:'running',id:board.id,variant,completedTables:rows.length,totalTables:reusedTables+boards.length*variants.length}));
    const row=await runBoard(board,variant,module,candidate);rows.push(row);json(join(runDir,board.id+'-'+variant+'.json'),row);
    json(join(runDir,'progress.json'),{completedTables:rows.length,totalTables:reusedTables+boards.length*variants.length,last:{id:board.id,variant,wallMs:row.wallMs},metrics:summarizeSteps(rows.flatMap(r=>r.steps))});
    console.log(JSON.stringify({status:'complete',id:board.id,variant,wallMs:row.wallMs,metrics:row.metrics}));
  }
  const steps=rows.flatMap(row=>row.steps);
  json(join(runDir,'summary.json'),{completedTables:rows.length,totalTables:reusedTables+boards.length*variants.length,reusedTables,actualRunTables:boards.length*variants.length,wallMs:performance.now()-runStarted,
    metrics:summarizeSteps(steps),metricsByRole:Object.fromEntries(['declarer','defense'].map(role=>[role,summarizeSteps(steps.filter(step=>step.role===role))])),
    metricsByVersion:Object.fromEntries(['old','candidate'].map(version=>[version,summarizeSteps(steps.filter(step=>step.version===version))])),paired:pairedReport(rows)});
  const gatePath=resolve('artifacts/v331-play/ACCEPTANCE_GATE.json');
  if(candidate&&existsSync(gatePath))json(join(runDir,'acceptance-gate-result.json'),{gateSha256:digest(readFileSync(gatePath)),...evaluateGate(rows,JSON.parse(readFileSync(gatePath,'utf8')),partition)});
  const integrity={checkedAt:new Date().toISOString(),candidateSourceUnchanged:sourceManifest(sourceRootAtStart).sha256===candidateSourceAtStart.sha256,
    oldSourceUnchanged:sourceManifest(OLD).sha256===manifest.oldSourceSha256,boardFileUnchanged:digest(readFileSync(freezeFile))===manifest.sha256,
    harnessAndGateUnchanged:Object.entries(preservedHashes).every(([file,expected])=>digest(readFileSync(resolve(file)))===expected),
    actualTables:rows.length,actualNewPolicyTables:boards.length*variants.length,reusedTables,allTablesComplete52NoClaims:rows.every(row=>row.complete&&row.playedCards===52&&row.claims===0)};
  assertFrozenInputs(document,manifest);json(join(runDir,'post-run-integrity.json'),integrity);
  if(!integrity.candidateSourceUnchanged||!integrity.oldSourceUnchanged||!integrity.boardFileUnchanged||!integrity.harnessAndGateUnchanged||!integrity.allTablesComplete52NoClaims)throw new Error('Post-run integrity failure; result cannot be accepted');
}
