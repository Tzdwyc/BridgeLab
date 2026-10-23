/** BridgeLab Phase A: independent BRL DeepMind MLP implementation.
 * Encoding derived from PGX v1.4.0 bridge_bidding.py and OpenSpiel v1.4
 * (Apache-2.0). No Nickel application code is used. See NOTICE.md.
 */
export type Seat = 'N' | 'E' | 'S' | 'W';
export type Strain = 'C' | 'D' | 'H' | 'S' | 'NT';
export type Call = { kind: 'pass' } | { kind: 'double' } | { kind: 'redouble' } | { kind: 'bid'; level: number; strain: Strain };
/** Structural subset of v0.3.7 BiddingObservation; deliberately excludes hidden hands. */
export interface BiddingObservation {
  phase: 'auction'; board: number; seat: Seat; actingSeat: Seat;
  vulnerability: 'None' | 'NS' | 'EW' | 'Both';
  hand: { id: string; suit: 'C' | 'D' | 'H' | 'S'; rank: number }[];
  auction: { seat: Seat; call: Call }[]; legalCalls: Call[];
}
export interface TensorRef { shape: number[]; offset: number; size: number }
export interface ModelManifest { source: string; license: string; dtype: string; layers: { name: string; w: TensorRef; b: TensorRef }[] }
interface Layer { inputs: number; outputs: number; w: Float32Array; b: Float32Array }
export interface NeuralModel { source: string; layers: readonly Layer[] }
export interface Inference { logits: Float32Array; value: number }
const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
const STRAINS: readonly Strain[] = ['C', 'D', 'H', 'S', 'NT'];
function check(ok: unknown, reason: string): asserts ok { if (!ok) throw new Error(`BRL model: ${reason}`); }
export function callToAction(call: Call): number {
  if (call.kind === 'pass') return 0;
  if (call.kind === 'double') return 1;
  if (call.kind === 'redouble') return 2;
  const strain = STRAINS.indexOf(call.strain);
  check(call.kind === 'bid' && Number.isInteger(call.level) && call.level >= 1 && call.level <= 7 && strain >= 0, 'invalid call');
  return 3 + (call.level - 1) * 5 + strain;
}
export function actionToCall(action: number): Call {
  check(Number.isInteger(action) && action >= 0 && action < 38, 'invalid action');
  if (action === 0) return { kind: 'pass' };
  if (action === 1) return { kind: 'double' };
  if (action === 2) return { kind: 'redouble' };
  return { kind: 'bid', level: Math.floor((action - 3) / 5) + 1, strain: STRAINS[(action - 3) % 5] };
}
/** 4 vulnerability bits + 424 public history bits + 52 own-card bits. */
export function encodeObservation(obs: BiddingObservation): Float32Array {
  check(obs.phase === 'auction' && obs.seat === obs.actingSeat, 'expected own hand at the acting seat');
  const actor = SEATS.indexOf(obs.actingSeat);
  check(actor >= 0 && ['None', 'NS', 'EW', 'Both'].includes(obs.vulnerability), 'invalid seat/vulnerability');
  check(obs.hand.length === 13, 'auction hand must contain exactly 13 cards');
  const x = new Float32Array(480);
  const side = actor % 2 === 0 ? 'NS' : 'EW';
  const ours = obs.vulnerability === 'Both' || obs.vulnerability === side;
  const theirs = obs.vulnerability === 'Both' || (obs.vulnerability !== 'None' && obs.vulnerability !== side);
  x.set([+!ours, +ours, +!theirs, +theirs]);
  let last = 0;
  let previousSeat = -1;
  for (const entry of obs.auction) {
    const bidder = SEATS.indexOf(entry.seat);
    check(bidder >= 0 && (previousSeat < 0 || bidder === (previousSeat + 1) % 4), 'auction seats must advance clockwise');
    previousSeat = bidder;
    const relative = (bidder - actor + 4) % 4;
    const action = callToAction(entry.call);
    if (action === 0) { if (last === 0) x[4 + relative] = 1; }
    else if (action < 3) {
      check(last >= 3, 'double/redouble requires a preceding bid');
      x[8 + (last - 3) * 12 + action * 4 + relative] = 1;
    } else {
      check(action > last, 'contract bids must increase');
      last = action;
      x[8 + (action - 3) * 12 + relative] = 1;
    }
  }
  check(previousSeat < 0 || actor === (previousSeat + 1) % 4, 'actor must follow public auction');
  for (const card of obs.hand) {
    const suit = STRAINS.indexOf(card.suit);
    check(suit >= 0 && suit < 4 && Number.isInteger(card.rank) && card.rank >= 2 && card.rank <= 14, 'invalid own card');
    // OpenSpiel uses rank-major 2..A, suit C,D,H,S; PGX uses S,H,D,C and A,2..K.
    const index = 428 + (card.rank - 2) * 4 + suit;
    check(x[index] === 0, 'duplicate own card');
    x[index] = 1;
  }
  return x;
}
/** Consume a flat little-endian float32 manifest without filesystem/browser dependencies. */
export function loadModelFromBuffer(manifest: ModelManifest, arrayBuffer: ArrayBuffer): NeuralModel {
  check(manifest.dtype === 'float32' && manifest.layers.length === 6, 'expected six float32 layers');
  check(new Uint8Array(new Uint32Array([1]).buffer)[0] === 1, 'little-endian runtime required');
  check(arrayBuffer.byteLength % 4 === 0, 'unaligned binary');
  const data = new Float32Array(arrayBuffer);
  const expected = [[480, 1024], [1024, 1024], [1024, 1024], [1024, 1024], [1024, 38], [1024, 1]];
  let offset = 0;
  const layers = manifest.layers.map((layer, i) => {
    const [inputs, outputs] = expected[i];
    const name = i === 0 ? 'actor_critic/linear' : `actor_critic/linear_${i}`;
    check(layer.name === name && layer.w.shape.length === 2 && layer.w.shape[0] === inputs && layer.w.shape[1] === outputs && layer.w.size === inputs * outputs, `invalid weight layer ${i}`);
    check(layer.b.shape.length === 1 && layer.b.shape[0] === outputs && layer.b.size === outputs, `invalid bias layer ${i}`);
    check(layer.w.offset === offset && layer.b.offset === offset + layer.w.size, `invalid tensor offset ${i}`);
    offset += layer.w.size + layer.b.size;
    check(offset <= data.length, `truncated layer ${i}`);
    return { inputs, outputs, w: data.subarray(layer.w.offset, layer.w.offset + layer.w.size), b: data.subarray(layer.b.offset, layer.b.offset + layer.b.size) };
  });
  check(offset === data.length, 'unexpected trailing weights');
  for (const value of data) check(Number.isFinite(value), 'non-finite weight');
  return { source: manifest.source, layers };
}
function dense(layer: Layer, x: Float32Array, relu: boolean): Float32Array {
  // JS number sums use float64, then round each complete affine output to float32.
  // This has a documented numerical tolerance against original NumPy/JAX float32.
  const sums = new Float64Array(layer.outputs);
  for (let i = 0; i < layer.inputs; i++) {
    const xi = x[i];
    if (xi === 0) continue;
    const start = i * layer.outputs;
    for (let j = 0; j < layer.outputs; j++) sums[j] += xi * layer.w[start + j];
  }
  const y = new Float32Array(layer.outputs);
  for (let j = 0; j < layer.outputs; j++) y[j] = relu ? Math.max(0, sums[j] + layer.b[j]) : sums[j] + layer.b[j];
  return y;
}
export function infer(model: NeuralModel, input: Float32Array): Inference {
  check(input.length === 480 && input.every(Number.isFinite), 'expected 480 finite inputs');
  let x = input;
  for (let i = 0; i < 4; i++) x = dense(model.layers[i], x, true);
  return { logits: dense(model.layers[4], x, false), value: dense(model.layers[5], x, false)[0] };
}
/** Argmax with legality only. Does not enforce any bidding convention/system. */
export function chooseLegal(model: NeuralModel, obs: BiddingObservation): Inference & { call: Call; action: number; rawTopAction: number } {
  check(obs.legalCalls.length > 0, 'no legal actions');
  const result = infer(model, encodeObservation(obs));
  let rawTopAction = 0;
  for (let a = 1; a < 38; a++) if (result.logits[a] > result.logits[rawTopAction]) rawTopAction = a;
  let action = -1;
  for (const call of obs.legalCalls) {
    const candidate = callToAction(call);
    if (action < 0 || result.logits[candidate] > result.logits[action] || (result.logits[candidate] === result.logits[action] && candidate < action)) action = candidate;
  }
  return { ...result, call: actionToCall(action), action, rawTopAction };
}
