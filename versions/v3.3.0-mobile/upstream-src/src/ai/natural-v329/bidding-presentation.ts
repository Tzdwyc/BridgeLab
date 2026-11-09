import { type AuctionEntry, type Call, type Seat, type Suit, partnerOf, sideOf } from '../../core/types';
import { auctionStatus, bidValue, legalCalls, sameCall } from '../../core/auction';
import { type BiddingSystem } from './systems';
import { analyzeAuctionSemantics, publicCallMeaningAt, publicOpeningMinorChoiceBefore, publicPendingResponse, publicPlayerConstraints, publicTakeoutDoubleAt, type PublicCallMeaning } from './bidding-semantics';
import { formatPointRange, formatSuitPromises, joinBidMeaning } from './bidding-meaning-format';

const suits: Suit[] = ['S', 'H', 'D', 'C'];
const names: Record<Suit, string> = { S: '黑桃', H: '红心', D: '方块', C: '梅花' };
const callName = (call: Call) => call.kind === 'bid' ? `${call.level}${call.strain === 'NT' ? 'NT' : { S: '♠', H: '♥', D: '♦', C: '♣' }[call.strain]}` : call.kind === 'pass' ? '不叫' : call.kind === 'double' ? '加倍' : '再加倍';
const firstBid = (a: AuctionEntry[]) => a.flatMap(entry => entry.call.kind === 'bid' ? [entry.call] : [])[0];
const sentence = joinBidMeaning;

/** Display only. Public promises stay in bidding-semantics; no hand or future call is read. */
export function presentCall(auction: AuctionEntry[], seat: Seat, call: Call, system: BiddingSystem): string {
  if (!legalCalls(auction, seat).some(candidate => sameCall(candidate, call)))
    return `${callName(call)}：当前不可叫。`;
  // Old saves have their own natural decision engine, without the newer conventions.
  if (system === 'natural-lite') return presentLegacyCall(auction, call);
  const meaning = publicCallMeaningAt([...auction, { seat, call }], auction.length, system);
  if (!meaning.defined) {
    const pending = analyzeAuctionSemantics(auction, seat, system);
    return pending.mustBid
      ? sentence(`${callName(call)}：不是本轮约定回答`, '仍须完成同伴的问叫或逼叫')
      : sentence(`${callName(call)}：此处未约定`, '不推断点力、套长或逼叫性');
  }
  if (call.kind === 'pass') return presentPass(auction, seat, meaning, system);
  if (call.kind === 'double') return presentDouble(auction, meaning, system);
  if (call.kind === 'redouble') return meaning.role === 'precision-positive'
    ? sentence('再加倍：人工实力正应', points(meaning), '不承诺花色或均型', forcing(meaning))
    : sentence('实力再加倍', points(meaning), forcing(meaning));
  const prefix = `${callName(call)}：`;
  const summary = convention(auction, seat, call, meaning, system);
  const prior = publicPlayerConstraints(auction, seat, system);
  // A support cue has already established a same-trump support-point floor.
  // Retain that sourced floor only on its natural support continuation, never
  // attach an unrelated prior HCP range or a second point total.
  const continuingSupport = meaning.role === 'support-cue-continuation' && call.strain !== 'NT' && !points(meaning)
    ? formatPointRange(prior.supportRanges[call.strain], '支持点') : undefined;
  const earlierSuits = call.strain !== 'NT' && ['natural-second-suit', 'responder-second-suit', 'passed-second-suit'].includes(meaning.role)
    ? suits.filter(suit => suit !== call.strain && prior.suitMinimums[suit] >= 4 && !meaning.suitMinimums[suit])
      .map(suit => `原套${prior.suitMinimums[suit]}张以上${names[suit]}`).join('、') : undefined;
  const label = summary ?? naturalLabel(meaning, call);
  return prefix + sentence(meaning.artificial && label, points(meaning), continuingSupport && `此前${continuingSupport}（${names[call.strain as Suit]}）`,
    lengths(meaning), earlierSuits, shape(meaning), !meaning.artificial && label,
    details(auction, call, meaning, system), forcingAt(auction, seat, call, meaning, system));
}

function forcingAt(a: AuctionEntry[], seat: Seat, call: Extract<Call, { kind: 'bid' }>, m: PublicCallMeaning, system: BiddingSystem): string | undefined {
  if (m.role === 'natural-opening' && m.forcing === 'none' && !m.invitation) return undefined;
  const all = a.flatMap((entry, index) => entry.call.kind === 'bid' ? [{ ...entry, call: entry.call, index }] : []);
  const side = all.filter(entry => sideOf(entry.seat) === sideOf(seat));
  // The current card explicitly treats the one-level fourth suit as natural F1.
  // The structured analyzer does not classify this as an artificial fourth suit.
  if (system === 'sayc' && call.level === 1 && call.strain === 'S' && side.length === 3
    && side[0].index === all[0]?.index && side[0].call.level === 1 && side[0].call.strain === 'C'
    && side[1].seat === seat && side[1].call.level === 1 && side[1].call.strain === 'D'
    && side[2].call.level === 1 && side[2].call.strain === 'H'
    && a.slice(side[0].index + 1).every(entry => sideOf(entry.seat) === sideOf(seat) || entry.call.kind === 'pass')) {
    const passed = a.slice(0, side[0].index).some(entry => entry.seat === seat && entry.call.kind === 'pass');
    return passed ? '不逼叫' : '自然第四花色，逼叫一轮';
  }
  if (m.forcing === 'none' && !m.invitation && !m.artificial) {
    if (m.role === 'two-suit-choice' && publicOpeningMinorChoiceBefore(a, seat, system))
      return '完成低花选择，可停';
    const partnerBid = a.findLast(entry => entry.seat === partnerOf(seat) && entry.call.kind === 'bid');
    if (call.level === 3 && call.strain === 'NT' && partnerBid
      && publicCallMeaningAt(a, a.indexOf(partnerBid), system).role === 'transfer-acceptance')
      return '成局提议，可止叫或改选高花';
  }
  return forcing(m, call);
}

function points(m: PublicCallMeaning): string | undefined {
  // A support-point requirement replaces the HCP headline for this call. It
  // must never be added to a prior HCP promise or presented as a second total.
  const support = m.supportRange && formatPointRange(m.supportRange, '支持点');
  if (support && m.supportRange) return `${support}（${names[m.supportRange.trump]}）`;
  return formatPointRange(m.hcpRange);
}

function lengths(m: PublicCallMeaning): string | undefined {
  // Honor/control answers disclose resources, not natural length in the
  // artificial denomination. Old promises remain in the public ledger.
  if (['keycard-ask', 'keycard-answer', 'queen-ask', 'queen-answer', 'king-ask', 'king-answer', 'control-cue',
    'weak-feature-inquiry', 'weak-feature-answer', 'precision-negative', 'precision-positive',
    'precision-inquiry', 'artificial-response', 'stayman', 'fourth-suit', 'michaels-inquiry'].includes(m.role)) return undefined;
  if (m.role === 'jacoby-rebid' && m.artificial) return formatSuitPromises({}, m.suitMaximums);
  if (m.allowedShapeFamily && m.allowedShapeFamily.every(shape => [...shape].every(n => +n >= 2))) return undefined;
  // Balanced shape already conveys the four two-card minima. Do not repeat them.
  if (m.strictBalancedShapeFamily) return m.suitMaximums?.H === 4 && m.suitMaximums?.S === 4 ? '无五张高花' : undefined;
  if (m.role === 'precision-opening' && !m.artificial || m.role === 'precision-answer'
    && suits.every(suit => (m.suitMinimums[suit] ?? 0) === m.suitMaximums?.[suit])) return undefined;
  if (m.role === 'precision-answer' && m.suitMaximums?.H === 3 && m.suitMaximums?.S === 3)
    return formatSuitPromises(m.suitMinimums);
  return formatSuitPromises(m.suitMinimums, m.suitMaximums);
}

function shape(m: PublicCallMeaning): string | undefined {
  if (m.artificial && !['precision-opening', 'precision-answer'].includes(m.role)) return undefined;
  if (m.strictBalancedShapeFamily) return m.longMinorNTAlternative ? '通常均型' : '均型';
  if (m.allowedShapeFamily) return m.allowedShapeFamily.every(shape => [...shape].every(n => +n >= 2)) ? '无单缺' : `牌型${m.allowedShapeFamily.join('／')}`;
  return undefined;
}

function forcing(m: PublicCallMeaning, call?: Extract<Call, { kind: 'bid' }>): string {
  if (m.role === 'semi-forcing-nt') return '半逼叫，最低限无合适再叫时可不叫';
  if (m.forcing === 'game') return '逼叫进局';
  if (m.forcing === 'one-round') return '逼叫一轮';
  if (['keycard-answer', 'queen-answer', 'king-answer'].includes(m.role)) return '可停在约定将牌';
  if (m.invitation || m.intent === 'invitation' || m.intent === 'grand-inv') return '邀请，不逼叫，低限可停';
  // Signoff is a contract preference, not an order to Pass with every hand.
  // In particular, transfer-then-3NT still permits a known major-fit correction.
  if (call && !m.artificial && m.role !== 'natural-opening') {
    const gameLevel = call.strain === 'NT' ? 3 : ['H', 'S'].includes(call.strain) ? 4 : 5;
    if (call.level >= gameLevel) {
      if (m.intent === 'signoff') return call.level >= 6 ? '满贯止叫' : '成局止叫';
      return call.level >= 6 ? '选择满贯，可止叫' : '自然成局，可止叫';
    }
    if (m.intent === 'signoff') return '止叫建议，不逼叫';
  }
  return '不逼叫';
}

function presentPass(a: AuctionEntry[], seat: Seat, m: PublicCallMeaning, system: BiddingSystem): string {
  const special: Partial<Record<PublicCallMeaning['role'], string>> = {
    'strong-club-negative-pass': '强2♣受干扰后的弱负应，同伴须再描述',
    'precision-negative-pass': '强1♣受干扰后的负应，同伴须再描述',
    'precision-waiting-pass': '强1♣受干扰后暂时等待，不限定点力或牌型',
  };
  if (special[m.role]) return sentence(`不叫：${special[m.role]}`, points(m),
    m.role === 'precision-waiting-pass' && m.forcing === 'one-round' ? '同伴须再自然描述' : undefined);
  const status = auctionStatus(a), last = status.lastBid;
  const lastMeaning = last && publicCallMeaningAt(a, a.indexOf(last), system);
  const unansweredArtificial = last && sideOf(last.seat) === sideOf(seat) && lastMeaning?.artificial
    && ['transfer', 'stayman', 'weak-minor-relay', 'fourth-suit', 'precision-inquiry', 'precision-answer', 'keycard-ask', 'queen-ask', 'king-ask'].includes(lastMeaning.role);
  if (analyzeAuctionSemantics(a, seat, system).mustBid || unansweredArtificial)
    return '不叫：当前仍须完成问叫或逼叫义务，应按约定继续。';
  if (m.roleLabel === '把同伴技术X转作惩罚') return '不叫：把同伴的技术性加倍转为惩罚。';
  if (m.hcpRange?.max === 4) return sentence('不叫：精确负应后的弱手止叫', points(m));
  if (!last) return '不叫：不承诺具体点力或牌型。';
  const ended = auctionStatus([...a, { seat, call: { kind: 'pass' } }]).ended;
  const owner = sideOf(last.seat) === sideOf(seat) ? '本方' : '对方';
  const naturalGame = last.call.kind === 'bid' && lastMeaning?.defined && !lastMeaning.artificial
    && !['keycard-answer', 'queen-answer', 'king-answer'].includes(lastMeaning.role)
    && last.call.level >= (last.call.strain === 'NT' ? 3 : ['H', 'S'].includes(last.call.strain) ? 4 : 5);
  return sentence(`不叫：${ended ? '接受' : '暂不改变'}${owner}${callName(last.call)}${status.doubled === 1 ? '加倍' : status.doubled === 2 ? '再加倍' : ''}${naturalGame ? '自然成局' : '定约'}`,
    ended ? '叫牌结束' : '叫牌尚可继续');
}

function presentDouble(a: AuctionEntry[], m: PublicCallMeaning, system: BiddingSystem): string {
  const role = m.roleLabel;
  const last = auctionStatus(a).lastBid;
  if (role === 'takeout') {
    const technical = publicTakeoutDoubleAt([...a, { seat: m.seat, call: { kind: 'double' } }], a.length, system);
    const label = technical?.kind === 'reopening' ? '再开叫技术性加倍' : technical?.kind === 'responsive' ? '响应性技术性加倍' : technical?.kind === 'balancing' ? '平衡位技术性加倍' : '技术性加倍';
    return sentence(label, points(m), lengths(m),
      '请同伴选择未叫花色', firstBid(a)?.level === 2 && m.hcpRange?.min === 12
        && technical?.kind !== 'responsive' && technical?.kind !== 'reopening'
        ? '通常13个大牌点以上，12点仅限敌套单缺、三门未叫套各4张以上' : undefined);
  }
  if (role === 'negative') return sentence('负加倍', points(m), lengths(m), '请开叫人继续描述');
  if (role === 'two-suit-strength') return sentence('实力加倍', points(m), '有防守兴趣，不承诺未叫套');
  if (role === 'lead-directing') return last?.call.kind === 'bid' && last.call.strain === 'NT'
    ? '首攻指示加倍，具体首攻方向未约定。'
    : sentence('首攻指示加倍', points(m), lengths(m), '所加倍花色须有套质');
  if (role !== 'penalty') return '加倍：此处未约定，不推断未叫套或惩罚实力。';
  return sentence(`惩罚性加倍，准备防守${last ? callName(last.call) : '对方定约'}`, points(m),
    last?.call.kind === 'bid' && last.call.level === 1 && last.call.strain === 'NT' ? '至少3个快速赢墩' : undefined);
}

function naturalLabel(m: PublicCallMeaning, call: Extract<Call, { kind: 'bid' }>): string | undefined {
  if (m.role === 'natural-opening') return call.strain === 'NT' ? undefined
    : call.level === 2 ? '弱二阻击' : call.level === 3 ? '三阶阻击' : call.level === 4 ? '四阶阻击' : undefined;
  if (m.role === 'natural-response') return undefined;
  const labels: Partial<Record<PublicCallMeaning['role'], string>> = {
    'natural-overcall': '自然争叫', 'natural-nt': '自然无将', 'natural-repeat': '原套再叫',
    'natural-preference': '自然示选', 'natural-second-suit': '自然新花色',
    'responder-second-suit': '自然新花色', 'passed-second-suit': '自然新花色',
    'natural-support': '支持同伴', 'competitive-support': '竞争加叫', 'accepted-invitation': '接受邀请',
  };
  return labels[m.role] ?? m.roleLabel;
}

function convention(a: AuctionEntry[], seat: Seat, call: Extract<Call, { kind: 'bid' }>, m: PublicCallMeaning, system: BiddingSystem): string | undefined {
  const trump = m.agreedTrump && names[m.agreedTrump];
  switch (m.role) {
    case 'stayman': return 'Stayman问四张高花，不承诺梅花套';
    case 'stayman-answer': return call.strain === 'D' ? 'Stayman回答：无四张高花，不承诺方块套' : 'Stayman自然高花回答';
    case 'transfer': return `高花转移至${call.level}${call.strain === 'D' ? '♥' : '♠'}，不承诺${names[call.strain as Suit]}长度`;
    case 'transfer-acceptance': return '接受高花转移';
    case 'fourth-suit': return '人工第四花色问叫，不承诺所叫套';
    case 'michaels': return 'Michaels人工双套扣叫，不承诺所扣花色';
    case 'unusual': return call.level === 4 && call.strain === 'NT' && !firstBid(a)
      ? '人工双低花选择，请同伴选择5♣或5♦' : '人工双套叫：最低两门未叫花色';
    case 'cue': return m.supportRange || Object.values(m.suitMinimums).some(Boolean)
      ? '支持性敌套扣叫，不承诺敌方花色' : '实力性敌套扣叫，不承诺敌方花色';
    case 'control-cue': return `控制叫：${names[call.strain as Suit]}有首轮或第二轮控制，${trump ?? '原花色'}仍为将牌`;
    case 'keycard-ask': return `RKCB 1430问关键张，${trump ?? '原花色'}为将牌`;
    case 'keycard-answer': return `RKCB回答：${call.strain === 'C' ? '1或4个关键张' : call.strain === 'D' ? '0或3个关键张' : call.strain === 'H' ? '2或5个关键张，无将牌Q' : '2或5个关键张，有将牌Q'}`;
    case 'keycard-signoff': return `关键张回答后回${trump}止叫`;
    case 'queen-ask': return `询问${trump ?? '将牌'}Q`;
    case 'queen-answer': {
      const question = a.findLast(entry => entry.seat === partnerOf(seat) && entry.call.kind === 'bid');
      if (call.strain === m.agreedTrump) {
        if (call.level === 5) return `将牌Q回答：否认Q，回${callName(call)}止叫`;
        if (question?.call.kind === 'bid' && bidValue(question.call) >= bidValue({ kind: 'bid', level: 5, strain: m.agreedTrump! }))
          return '将牌Q回答：回最低可叫的六阶将牌，此回答不能单独区分有Q与无Q';
        return '将牌Q回答：有将牌Q，回六阶将牌，没有在其下可显示的旁门K';
      }
      if (call.level === 6 && call.strain !== 'NT') return `将牌Q回答：有将牌Q，同时显示${names[call.strain]}K，${trump}仍为将牌`;
      return '将牌Q询问的回答，此位置的具体含义未约定';
    }
    case 'king-ask': return '询问旁门K，关键张及将牌Q已齐全';
    case 'king-answer': return call.strain === m.agreedTrump ? '回六阶将牌，没有可在其下安全显示的旁门K，不否认更高花色K' : `显示${names[call.strain as Suit]}K，不保证十三墩或接受大满贯`;
    case 'weak-feature-inquiry': return '特征问叫：问高限及旁门A或K';
    case 'weak-feature-answer': return `显示${names[call.strain as Suit]}A或K，不承诺该旁门长套`;
    case 'precision-negative': return '人工负应，不承诺方块长度';
    case 'precision-positive': return '人工实力正应，不承诺所叫花色长度';
    case 'precision-inquiry': return call.strain === 'D' ? '人工询问四张高花' : '人工牌型询问';
    case 'precision-answer': {
      const opening = a.find(entry => entry.call.kind === 'bid');
      if (opening?.call.kind === 'bid' && opening.call.strain === 'D')
        return `精确牌型回答：黑桃/红心/方块/梅花为${suits.map(suit => m.suitMaximums?.[suit] ?? m.suitMinimums[suit] ?? 0).join('=')}`;
      return call.strain === 'NT' ? '高限回答，无四张高花，保留梅花长套' : call.strain === 'C' ? '低限回答，无四张高花，保留梅花长套' : '自然高花回答，保留梅花长套';
    }
    case 'precision-opening': return call.strain === 'C' ? '6张以上梅花，或5张梅花带4张高花' : '精确人工短方块，限约定牌型';
    case 'semi-forcing-nt': return '1NT半逼叫应叫';
    case 'passed-hand-nt': return '已不叫手的自然无将应叫';
    case 'weak-minor-relay': return '人工低花逃叫接力至3♣，不承诺黑桃长套';
    case 'weak-minor-relay-acceptance': return '接受低花接力，不承诺梅花长套';
    case 'michaels-inquiry': return '询问未指明的低花，不承诺均型';
    case 'natural-nt':
      if (call.level === 4 && m.invitation) return '自然定量小满贯邀请';
      if (call.level === 5 && m.intent === 'grand-inv') return '自然定量5NT，邀请大满贯，至少叫到6NT';
      {
        const partner = a.findLast(entry => entry.seat === partnerOf(seat) && entry.call.kind === 'bid');
        const index = partner && a.indexOf(partner);
        const invited = index !== undefined && index >= 0 && publicCallMeaningAt(a, index, system).invitation;
        if (invited && !m.invitation && call.level < 3) return '低限答叫，拒绝进局邀请';
      }
      break;
  }
  // Precision's strong club cannot be read as a natural club opening.
  if (system === 'precision' && !a.some(entry => entry.call.kind === 'bid') && call.level === 1 && call.strain === 'C')
    return '精确人工强1♣，不承诺梅花套';
  if (m.role === 'strong-opening') return '人工强开叫，不承诺梅花套';
  if (m.artificial && m.role === 'artificial-response') return m.hcpRange?.max === 3
    ? `人工二次负应，不承诺${names[call.strain as Suit]}长度` : '强2♣后的等待应叫，不承诺方块长度';
  return undefined;
}

function details(a: AuctionEntry[], call: Extract<Call, { kind: 'bid' }>, m: PublicCallMeaning, system: BiddingSystem): string | undefined {
  const parts: string[] = [];
  if (m.role === 'natural-repeat' && publicPendingResponse(a, m.seat, system)?.kind === 'feature')
    parts.push('低限或无可显示的旁门A/K');
  const ownStoppers = !m.artificial ? [...new Set(m.stopperSources.filter(source => source.seat === m.seat).map(source => names[source.suit]))] : [];
  const partnerStoppers = !m.artificial ? [...new Set(m.stopperSources.filter(source => source.seat !== m.seat).map(source => names[source.suit]))] : [];
  if (ownStoppers.length) parts.push(`${ownStoppers.join('、')}有止张`);
  if (partnerStoppers.length) parts.push(`${partnerStoppers.join('、')}止张由同伴已示`);
  if (m.role === 'natural-preference' && m.suitMinimum === 2) parts.push('可仅两张，不保证八张配合');
  const supportRoles = ['natural-support', 'competitive-support', 'support-cue-continuation', 'accepted-invitation',
    'nt-competitive-major-game', 'natural-preference', 'natural-repeat', 'two-suit-choice', 'jacoby-rebid', 'jacoby-continuation'];
  if (call.strain !== 'NT' && supportRoles.includes(m.role)) {
    const partnerLength = publicPlayerConstraints(a, partnerOf(m.seat), system).suitMinimums[call.strain];
    if (partnerLength && m.supportRange) parts.push(`同伴已示${partnerLength}张以上${names[call.strain]}`);
  }
  const all = a.flatMap((entry, index) => entry.call.kind === 'bid' ? [{ ...entry, call: entry.call, index }] : []);
  const ourBids = all.filter(entry => sideOf(entry.seat) === sideOf(m.seat));
  const partner = ourBids.findLast(entry => entry.seat === partnerOf(m.seat));
  const partnerMeaning = partner && publicCallMeaningAt(a, partner.index, system);
  if (!m.artificial && partnerMeaning?.invitation && !m.invitation
    && call.level >= (call.strain === 'NT' ? 3 : ['H', 'S'].includes(call.strain) ? 4 : 5)
    && m.role !== 'accepted-invitation') parts.push('接受同伴邀请');
  if (m.role === 'natural-overcall' && all.length === 1 && a.length === all[0].index + 3
    && a.slice(all[0].index + 1).every(entry => entry.call.kind === 'pass')) parts.push('平衡位');
  if (m.role === 'natural-nt' && call.level === 1 && ourBids.length === 1 && ourBids[0].call.level === 1
    && ['C', 'D'].includes(ourBids[0].call.strain) && ourBids[0].seat !== m.seat && !m.strictBalancedShapeFamily
    && publicCallMeaningAt(a, ourBids[0].index, system).role === 'natural-opening'
    && !publicCallMeaningAt(a, ourBids[0].index, system).artificial
    && (['C', 'D'] as Suit[]).some(suit => (m.suitMaximums?.[suit] ?? 13) >= 5))
    parts.push('可含长低花弱牌，不保证均型');
  if (m.role === 'takeout-minimum-response' && !m.suitMinimum) parts.push('被迫答叫，不保证四张套');
  if (m.role === 'michaels' && call.strain !== 'NT' && ['H', 'S'].includes(call.strain)) parts.push('另有一门未指明的5张以上低花');
  if (m.playingSourceCompensation) {
    const source = m.playingSourceCompensation;
    parts.push(`少于${source.normalHcpMinimum}个大牌点时须${source.minLength}张以上${names[source.suit]}且套质达标`);
  }
  if (m.longMinorNTAlternative) parts.push('可凭符合套质和进手条件的长低花替代均型');
  // A promised five-card suit already gives two longest suits totalling >=8.
  const alreadyMeetsRule20Shape = Object.values(m.suitMinimums).some(min => min >= 5)
    || Object.values(m.suitMinimums).sort((x, y) => y - x).slice(0, 2).reduce((sum, min) => sum + min, 0) >= 8;
  if (system === 'sayc' && m.role === 'natural-opening' && m.hcpRange?.min === 12
    && call.level === 1 && call.strain !== 'NT' && !alreadyMeetsRule20Shape) parts.push('12个大牌点开叫须符合二十法则');
  const opening = all[0];
  const weakTwo = opening?.call.level === 2 && ['D', 'H', 'S'].includes(opening.call.strain);
  if (weakTwo && ourBids.length === 1 && ourBids[0].index === opening.index
    && call.strain === opening.call.strain && call.level === 3 && !m.invitation) parts.push('延长阻击，非邀请');
  return parts.join('，') || undefined;
}

function presentLegacyCall(a: AuctionEntry[], call: Call): string {
  if (call.kind === 'pass') return '不叫：按旧版简化自然制暂不继续叫牌。';
  if (call.kind === 'double') return '加倍：沿用旧版简化自然制的防守约定。';
  if (call.kind === 'redouble') return '再加倍：旧版简化自然制的实力表示。';
  const opening = !a.some(entry => entry.call.kind === 'bid');
  if (opening && call.strain === 'NT' && call.level > 3) return `${callName(call)}：旧版简化自然制未约定此无将开叫的点力或牌型。`;
  if (opening && call.strain === 'NT') return `${callName(call)}：旧版自然无将开叫，${formatPointRange({ min: call.level === 1 ? 15 : call.level === 2 ? 20 : 23, max: call.level === 1 ? 17 : 40 })}，均型。`;
  return `${callName(call)}：旧版简化自然制的自然${opening ? '开叫' : '续叫'}；原存档未记录更细的点力与逼叫约定。`;
}
