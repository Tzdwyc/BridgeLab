// scripts/replay-v033-findings.ts
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

// src/core/types.ts
var SEATS = ["N", "E", "S", "W"];
var SUITS = ["C", "D", "H", "S"];
var STRAINS = [...SUITS, "NT"];
var PASS = { kind: "pass" };
var sideOf = (seat) => seat === "N" || seat === "S" ? "NS" : "EW";
var partnerOf = (seat) => SEATS[(SEATS.indexOf(seat) + 2) % 4];

// src/core/auction.ts
var bidValue = (call) => call.kind === "bid" ? (call.level - 1) * 5 + STRAINS.indexOf(call.strain) : -1;
function auctionStatus(auction) {
  let lastBid = null;
  let doubled = 0;
  let passes = 0;
  for (const entry of auction) {
    if (entry.call.kind === "pass") passes++;
    else {
      passes = 0;
      if (entry.call.kind === "bid") {
        lastBid = entry;
        doubled = 0;
      }
      if (entry.call.kind === "double") doubled = 1;
      if (entry.call.kind === "redouble") doubled = 2;
    }
  }
  return { lastBid, doubled, passes, ended: lastBid ? passes >= 3 : passes >= 4 };
}
function legalCalls(auction, seat) {
  const { lastBid, doubled, ended } = auctionStatus(auction);
  if (ended) return [];
  const calls = [PASS];
  const floor = lastBid ? bidValue(lastBid.call) : -1;
  for (let level = 1; level <= 7; level++) for (const strain of STRAINS) {
    const bid4 = { kind: "bid", level, strain };
    if (bidValue(bid4) > floor) calls.push(bid4);
  }
  if (lastBid && sideOf(lastBid.seat) !== sideOf(seat) && doubled === 0) calls.push({ kind: "double" });
  if (lastBid && sideOf(lastBid.seat) === sideOf(seat) && doubled === 1) calls.push({ kind: "redouble" });
  return calls;
}
function sameCall(a, b) {
  return a.kind === b.kind && (a.kind !== "bid" || b.kind === "bid" && a.level === b.level && a.strain === b.strain);
}

// src/ai/bidding-legacy.ts
function evaluateHand(hand) {
  const hcp = hand.reduce((points, card) => points + Math.max(0, card.rank - 10), 0);
  const lengths = Object.fromEntries(SUITS.map((suit) => [suit, hand.filter((c) => c.suit === suit).length]));
  const shape = Object.values(lengths).sort((a, b) => b - a).join("");
  return { hcp, lengths, balanced: ["4333", "4432", "5332"].includes(shape) };
}
var bid = (level, strain) => ({ kind: "bid", level, strain });
function minimumPoints(call) {
  if (call.kind !== "bid") return 0;
  if (call.strain === "NT") return call.level === 1 ? 15 : call.level === 2 ? 8 : 10;
  return call.level === 1 ? 6 : call.level === 2 ? 6 : call.level === 3 ? 10 : 12;
}
function chooseBid(obs) {
  const { hcp, lengths, balanced } = evaluateHand(obs.hand);
  const available = (call) => obs.legalCalls.some((c) => sameCall(call, c));
  const pick = (...calls) => calls.find(available) ?? PASS;
  const partner = partnerOf(obs.seat);
  const ours = obs.auction.filter((a) => a.seat === obs.seat && a.call.kind === "bid");
  const partners = obs.auction.filter((a) => a.seat === partner && a.call.kind === "bid");
  const partnerLast = partners.at(-1)?.call;
  const { lastBid, doubled } = auctionStatus(obs.auction);
  const longest = [...SUITS].sort((a, b) => lengths[b] - lengths[a] || SUITS.indexOf(b) - SUITS.indexOf(a))[0];
  const majors = ["S", "H"].filter((s) => lengths[s] >= 5).sort((a, b) => lengths[b] - lengths[a]);
  const openingSuit = majors[0] ?? (lengths.D > lengths.C ? "D" : "C");
  if (!lastBid) {
    if (balanced && hcp >= 23) return pick(bid(3, "NT"));
    if (balanced && hcp >= 20) return pick(bid(2, "NT"));
    if (balanced && hcp >= 15 && hcp <= 17) return pick(bid(1, "NT"));
    if (hcp >= 12) return pick(bid(1, openingSuit));
    if (hcp >= 7 && hcp <= 11 && lengths[longest] >= 6 && longest !== "C") return pick(bid(2, longest));
    return PASS;
  }
  if (doubled === 1 && lastBid.call.kind === "bid" && sideOf(lastBid.seat) === sideOf(obs.seat) && hcp >= 12 && ours.length === 0) return pick({ kind: "redouble" });
  if (ours.length >= 2) return PASS;
  if (partnerLast?.kind === "bid" && sideOf(lastBid.seat) === sideOf(obs.seat)) {
    const p = partnerLast;
    const partnerOpening = partners[0];
    const firstPartnershipBid = obs.auction.find((a) => sideOf(a.seat) === sideOf(obs.seat) && a.call.kind === "bid");
    const partnerOpened = firstPartnershipBid?.seat === partner;
    if (!ours.length) {
      if (p.strain === "NT") {
        if (p.level === 1) {
          if (majors[0] && lengths[majors[0]] >= 6 && hcp >= 10) return pick(bid(4, majors[0]));
          if (majors[0] && hcp >= 8) return pick(bid(2, majors[0]));
          if (hcp >= 10) return pick(bid(3, "NT"));
          if (hcp >= 8) return pick(bid(2, "NT"));
        } else if (p.level === 2 && hcp >= (partnerOpened ? 5 : 12)) return pick(bid(3, "NT"));
        return PASS;
      }
      if ((p.strain === "S" || p.strain === "H") && lengths[p.strain] >= 3) {
        if (p.level === 1) {
          if (hcp >= 13) return pick(bid(4, p.strain));
          if (hcp >= 10) return pick(bid(3, p.strain));
          if (hcp >= 6) return pick(bid(2, p.strain));
        } else if (p.level === 2 && hcp >= 15) return pick(bid(4, p.strain));
        return PASS;
      }
      if (p.level === 1) {
        const newMajor = ["S", "H"].filter((s) => lengths[s] >= 4 && s !== p.strain && available(bid(1, s))).sort((a, b) => lengths[b] - lengths[a])[0];
        if (newMajor && hcp >= 6) return bid(1, newMajor);
        if (balanced && hcp >= 13) return pick(bid(3, "NT"));
        if (balanced && hcp >= 11) return pick(bid(2, "NT"));
        if (lengths[longest] >= 5 && longest !== p.strain && hcp >= 10) return pick(bid(2, longest));
        if (lengths[p.strain] >= 4 && hcp >= 6) return pick(bid(hcp >= 10 ? 3 : 2, p.strain));
        if (hcp >= 6) return pick(bid(1, "NT"));
      }
      return PASS;
    }
    const firstOwn = ours[0].call;
    if (firstOwn.kind !== "bid") return PASS;
    if (firstOwn.strain === "NT" && firstOwn.level === 1 && p.strain === "NT" && p.level === 2) return hcp >= 16 ? pick(bid(3, "NT")) : PASS;
    const pMin = partnerOpened && partnerOpening.call.kind === "bid" ? partnerOpening.call.strain === "NT" ? partnerOpening.call.level === 1 ? 15 : 20 : partnerOpening.call.level === 1 ? 12 : 7 : minimumPoints(p);
    const combined = hcp + pMin;
    if (p.strain !== "NT" && lengths[p.strain] >= (p.strain === "S" || p.strain === "H" ? 3 : 4)) {
      const gameLevel3 = p.strain === "S" || p.strain === "H" ? 4 : 5;
      if (combined >= (gameLevel3 === 4 ? 25 : 28)) return pick(bid(gameLevel3, p.strain));
      if (p.level === 1 && hcp >= 12) return pick(bid(2, p.strain));
      if (p.level === 2 && hcp >= 17) return pick(bid(3, p.strain));
    }
    if (balanced && combined >= 25) return pick(bid(3, "NT"));
    if (balanced && hcp >= 18 && p.level <= 1) return pick(bid(2, "NT"));
    if (lengths[firstOwn.strain] >= 6 && p.level <= 1 && hcp >= 13) return pick(bid(2, firstOwn.strain));
    return PASS;
  }
  if (lastBid.call.kind !== "bid" || sideOf(lastBid.seat) === sideOf(obs.seat)) return PASS;
  const opposing = lastBid.call;
  if (partnerLast?.kind === "bid" && partnerLast.strain !== "NT" && lengths[partnerLast.strain] >= 3 && hcp >= 8) {
    const cap = hcp >= 13 ? 4 : 2;
    for (let level = partnerLast.level + 1; level <= cap; level++) if (available(bid(level, partnerLast.strain))) return bid(level, partnerLast.strain);
  }
  const stopped = opposing.strain === "NT" || obs.hand.some((c) => c.suit === opposing.strain && (c.rank === 14 || c.rank === 13 && lengths[c.suit] >= 2 || c.rank === 12 && lengths[c.suit] >= 3));
  if (!ours.length && balanced && hcp >= 16 && hcp <= 18 && stopped && available(bid(1, "NT"))) return bid(1, "NT");
  if (!ours.length && lengths[longest] >= 5) {
    for (let level = 1; level <= 2; level++) if (hcp >= (level === 1 ? 10 : 13) && available(bid(level, longest))) return bid(level, longest);
  }
  if (!ours.length && hcp >= 17 && opposing.level <= 2 && opposing.strain !== "NT" && lengths[opposing.strain] <= 2) return pick({ kind: "double" });
  if (hcp >= 18 && opposing.level >= 3 && opposing.strain !== "NT" && lengths[opposing.strain] >= 4 && bidValue(opposing) >= 10) return pick({ kind: "double" });
  return PASS;
}

// src/ai/systems.ts
var SYSTEMS = {
  sayc: {
    name: "SAYC\uFF0B2/1\u8FDB\u5C40\u903C\u53EB\uFF0BRKCB 1430",
    short: "SAYC/2/1",
    summary: "SAYC \u5F00\u53EB\u4E0E\u7ADE\u4E89 \xB7 2/1\u8FDB\u5C40\u903C\u53EB \xB7 1NT\u534A\u903C\u53EB \xB7 RKCB 1430",
    rules: [
      "\u4E00\u9636\u82B1\u8272\u901A\u5E3813\u201321 HCP\uFF1B12 HCP\u4EC5\u5728HCP\u52A0\u4E24\u95E8\u6700\u957F\u5957\u5F20\u6570\u8FBE\u523020\u65F6\u5F00\u53EB\u3002\u4E94\u5F20\u9AD8\u82B1\uFF1B\u7B49\u957F\u957F\u5957\u5F00\u8F83\u9AD8\u7EA7\uFF0C\u4F4E\u82B14\u20134\u5F001\u2666\u30013\u20133\u5F001\u2663\u30021NT=15\u201317\uFF0C2NT=20\u201321\uFF0C3NT=25\u201327\u5747\u578B\u3002",
      "2\u2663\u4E3A22+\u5F3A\u5F00\u53EB\uFF1B2\u2666\uFF0F2\u2665\uFF0F2\u2660\u4E3A5\u201311 HCP\u3001\u901A\u5E386\u5F20\u7684\u5F31\u4E8C\u30021M\u20131NT\u4E3A5\u201312\u534A\u903C\u53EB\uFF1A\u5747\u578B\u6700\u4F4E\u9650\u5F00\u53EB\u4EBA\u53EFPass\uFF0C\u975E\u5747\u578B\u7EE7\u7EED\u63CF\u8FF0\u3002\u672APass\u4E14\u65E0\u5E72\u6270\u7684\u4E8C\u76D6\u4E00\u65B0\u82B1\u8272\u4E3A13+\u5E76\u903C\u53EB\u8FDB\u5C40\u3002",
      "\u5F3A2\u2663\u540E2\u2666\u7B49\u5F85\uFF1B\u81EA\u7136\u9AD8\u82B1\u518D\u53EB5+\u5F20\uFF0C\u4F4E\u82B1\u901A\u5E385+\u5F20\uFF0C\u5F3A4-4-4-1\u4E14\u6CA1\u6709\u4E94\u5F20\u5957\u65F6\u5141\u8BB8\u81EA\u7136\u56DB\u5F20\u4F4E\u82B1\uFF0C\u4E0D\u628A\u56DB\u5F20\u9AD8\u82B1\u5047\u62A5\u6210\u4E94\u5F20\u3002\u5F00\u53EB\u4EBA\u518D\u53EB\u81EA\u7136\u5957\u540E\uFF0C0\u20133 HCP\u7528\u6700\u4FBF\u5B9C\u4F4E\u82B1\u4E8C\u6B21\u8D1F\u5E94\u53EB\uFF1A2M\u540E3\u2663\u30013\u2663\u540E3\u2666\u30013\u2666\u540E3NT\u3002\u4EBA\u5DE5\u8D1F\u5E94\u53EB\u4E0D\u8868\u793A\u8BE5\u5957\u6216\u65E0\u5C06\u6B62\u5F20\uFF0C\u903C\u53EB\u4E00\u8F6E\uFF1B\u5F00\u53EB\u4EBA\u6700\u4F4E\u9650\u539F\u5957\u518D\u53EB\u53EF\u505C\uFF0C\u5176\u4F59\u81EA\u7136\u65B0\u5957\u7EE7\u7EED\u903C\u5C40\u3002",
      "\u9AD8\u82B1\u7B80\u5355\u52A0\u53EB6\u20139\u8C03\u6574\u70B9\uFF0C\u9650\u5236\u6027\u8DF3\u52A0\u53EB10\u201312\uFF1BJacoby 2NT\u4E3A4+\u5F20\u652F\u6301\u300113+\u8C03\u6574\u70B9\u5E76\u903C\u53EB\u8FDB\u5C40\u3002\u4F4E\u82B1\u7B80\u5355\u52A0\u53EB\u53EF\u4E3A\u56DB\u5F20\u652F\u6301\u6216\u504F\u597D\uFF1B\u5F00\u53EB\u53EA\u4FDD\u8BC1\u4E09\u5F20\u65F6\uFF0C\u786E\u8BA4\u516B\u5F20\u4F4E\u82B1\u914D\u5408\u9700\u4E94\u5F20\u652F\u6301\uFF0C\u672A\u786E\u8BA4\u524D\u4E0D\u8BA1\u77ED\u95E8\u70B9\u3002\u5F00\u53EB\u4EBA\u5728\u4E00\u76D6\u4E00\u540E\u5F3A\u8DF3\u79FB\u53EB\u4E3A19+ HCP\u30014+\u5F20\u7B2C\u4E8C\u5957\u5E76\u903C\u53EB\u8FDB\u5C40\uFF1B\u539F\u9AD8\u82B15+\u3001\u539F\u4F4E\u82B14+\u4E14\u53EF\u4E0E\u7B2C\u4E8C\u5957\u7B49\u957F\uFF0C\u5141\u8BB84-4-4-1\u3002\u9006\u53EB17+\u3001\u903C\u53EB\u4E00\u8F6E\u3002\u4E00\u76D6\u4E00\u540E\u5F00\u53EB\u4EBA\u56DE\u53EB\u539F\u4F4E\u82B1\uFF0C\u5E94\u53EB\u4EBA\u672APass\u7684\u7B2C\u4E8C\u81EA\u7136\u65B0\u59574+\u5F20\u3001\u903C\u53EB\u4E00\u8F6E\uFF1B\u5E94\u53EB\u4EBA\u81EA\u5DF1\u7684\u516D\u5F20\u9AD8\u82B1\u8DF3\u518D\u53EB3M\u4E3A10\u201312\u9080\u8BF7\uFF0C4M\u4E3A13+\u81EA\u7136\u6210\u5C40\uFF0C\u4E0D\u627F\u8BFA\u540C\u4F34\u5DF2\u6709\u652F\u6301\u3002",
      "\u4E00\u9636\u4F4E\u82B1\u540E\uFF0C\u65E0\u56DB\u5F20\u9AD8\u82B1\u7684\u81EA\u7136NT\u5E94\u53EB\u4E3A\uFF1A1NT 6\u201310\uFF0C\u901A\u5E38\u5747\u578B\u6216\u534A\u5747\u578B\uFF0C\u4E5F\u53EF\u7528\u4E8E\u4E0D\u591F\u4E8C\u76D6\u4E00\u5B9E\u529B\u7684\u957F\u4F4E\u82B1\u724C\uFF1B\u5747\u578B2NT\u4E3A11\u201312\u9080\u8BF7\u3001\u4E0D\u903C\u53EB\uFF0C3NT\u4E3A13+\u6210\u5C40\uFF08\u901A\u5E3813\u201315\uFF1B\u66F4\u5F3A\u4E14\u65E0\u5408\u9002\u771F\u5B9E\u65B0\u5957\u65F6\u4E5F\u53EF\u76F4\u53EB\uFF09\u3002\u6709\u56DB\u5F20\u9AD8\u82B1\u4F18\u5148\u4E00\u9636\u81EA\u7136\u5E94\u53EB\uFF1B5-3-3-2\u5373\u4F7F\u6709\u4E94\u5F20\u5F00\u53EB\u4F4E\u82B1\u652F\u6301\u4ECD\u6309\u4E0A\u8FF0\u8303\u56F4\u4F18\u5148\u5B9A\u91CFNT\u3002\u672C\u5361\u4E0D\u91C7\u7528\u5012\u7F6E\u4F4E\u82B1\u52A0\u53EB\u3002\u4E00\u76D6\u4E00\u540E1NT\u518D\u53EB\u4E3A12\u201314\uFF0812\u70B9\u5F00\u53EB\u987B\u7B26\u5408Rule of 20\uFF09\u30012NT\u8DF3\u518D\u53EB\u4E3A18\u201319\uFF1B\u56DE\u7B54\u7B2C\u56DB\u82B1\u8272\u7684\u88AB\u8FEB2NT\u4E0D\u5957\u7528\u8DF3\u518D\u53EB\u8303\u56F4\u3002\u516C\u5F00\u6700\u4F4E\u8054\u624B\u8FBE\u5230\u8FDB\u5C40\u65F6\u4E0D\u5141\u8BB8\u505C\u5728\u9080\u8BF7\u6216\u90E8\u5206\u5B9A\u7EA6\u3002",
      "\u76F4\u63A5\u4E89\u53EB\uFF1A\u4E00\u9636\u81EA\u71365+\u5F208\u201316\uFF1B\u975E\u8DF3\u4E8C\u9636\u4E89\u53EB\u901A\u5E3810\u201316\u5E76\u8981\u6C42\u8F83\u597D\u5957\uFF1B\u654C\u65B9\u5E94\u53EB\u540E\u672C\u65B9\u5C1A\u672A\u81EA\u7136\u53EB\u724C\u65F6\uFF0C\u9996\u6B21\u4E89\u53EB\u4ECD\u6309\u81EA\u7136\u5957\u89E3\u91CA\uFF0C\u5E73\u8861\u4F4D\u53EF\u9002\u5F53\u51CF\u4F4E\u70B9\u529B\u8981\u6C42\u300217+\u5148\u6280\u672F\u6027\u52A0\u500D\u518D\u53EB\u5957\u3002\u76F4\u63A51NT\u4E89\u53EB15\u201318\u3001\u5E73\u8861\u4F4D1NT\u4E3A11\u201314\uFF0C\u5747\u987B\u6709\u654C\u5957\u6B62\u5F20\uFF1B\u5176\u540EStayman\u3001Jacoby\u9AD8\u82B1\u8F6C\u79FB\u7EE7\u7EED\u4F7F\u7528\uFF0C2\u2660\u4E3A\u5F31\u4F4E\u82B1\u9003\u53EB\u63A5\u529B\u81F33\u2663\uFF0C\u65393\u2666\u4E3A\u81EA\u7136\u4E0D\u903C\u53EB\u3002\u8DF3\u4E89\u53EB\u4E3A\u963B\u51FB\u3002",
      "Michaels\u6263\u53EB\u3001Unusual 2NT\u3001\u6280\u672F\u6027\u52A0\u500D\u3001\u81F32\u2660\u7684\u8D1F\u52A0\u500D\u53CA\u4E89\u53EB\u540E\u7684\u903C\u53EB\u6263\u53EB\uFF0C\u6309\u81EA\u7136\u7ADE\u4E89\u7ED3\u6784\u5904\u7406\uFF1B\u4EBA\u5DE5\u6263\u53EB\u6216\u8F6C\u79FB\u88AB\u52A0\u500D\u540E\u4E0D\u80FD\u4EE5Pass\u505C\u5728\u4EBA\u5DE5\u5B9A\u7EA6\u3002\u8F6C\u79FB\u53CA\u652F\u6301\u6027\u4EBA\u5DE5\u6263\u53EB\u4E0A\u7684\u654C\u65B9\u52A0\u500D\u4E3A\u9996\u653B\u6307\u793A\uFF0C\u5BF9Michaels\u6216Unusual 2NT\u4E3A\u5B9E\u529B\u52A0\u500D\uFF1B\u672C\u65B9\u5B9E\u529B\u518D\u52A0\u500D\u540E\u540E\u7EED\u52A0\u500D\u4E3A\u60E9\u7F5A\u3002\u7B80\u5355\u4E89\u53EB\u540E\u7684\u65B0\u82B1\u8272\u5EFA\u8BBE\u6027\u4F46\u4E0D\u903C\u53EB\uFF0C\u652F\u6301\u6027\u6263\u53EB\u903C\u53EB\u4E00\u8F6E\u3002\u6280\u672F\u6027\u52A0\u500D\u65B9\u968F\u540E1NT\u793A18\u201320\u3001\u8DF32NT\u793A21\u201322\u5747\u578B\u4E14\u654C\u65B9\u5DF2\u793A\u5957\u6709\u6B62\u5F20\uFF1B\u88AB\u8FEB\u6700\u4F4E\u5E94\u53EB\u4E0D\u4FDD\u8BC1\u70B9\u529B\uFF0C\u906D\u518D\u52A0\u500D\u540E\u7684\u9003\u53EB\u4E0D\u81EA\u52A8\u793A17+\u5F3A\u724C\u3002",
      "\u540C\u4F34\u4E00\u9636\u5F00\u53EB\u906D\u4E09\u9636\u963B\u51FB\u540E\uFF0C12+\u6709\u6B62\u5F20\u7684\u5747\u578B\u724C\u53EB3NT\uFF0C\u65E0\u6B62\u5F20\u65F6\u7528\u81EA\u7136\u957F\u5957\u3001\u652F\u6301\u8FDB\u5C40\u6216\u6263\u53EB\u4FDD\u6301\u903C\u53EB\u3002\u540C\u4F34\u4E09\u9636\u963B\u51FB\u540E\uFF0C15+\u7684\u4E94\u5F20\u65B0\u82B1\u8272\u903C\u53EB\u4E00\u8F6E\uFF1B\u963B\u51FB\u65B9\u5FC5\u987B\u52A0\u53EB\u914D\u5408\u6216\u56DE\u53EB\u539F\u5957\uFF0C\u660E\u786E\u914D\u5408\u540E\u53EF\u7528RKCB\u63A2\u7D22\u6EE1\u8D2F\u3002",
      "1NT\u53D7\u5230\u81EA\u7136\u82B1\u8272\u4E89\u53EB\u540E\uFF1A\u4E8C\u9636\u81EA\u7136\u957F\u5957\u4E3A\u7ADE\u4E89\u6027\u4E0D\u903C\u53EB\uFF0C\u4E09\u9636\u4E94\u5F20\u65B0\u595710+\u5E76\u903C\u53EB\u8FDB\u5C40\uFF1B\u654C\u5957\u6263\u53EB10+\u5E76\u903C\u5C40\uFF0C\u8BE2\u95EE\u56DB\u5F20\u9AD8\u82B1\u548C\u6B62\u5F20\u3002\u65E0\u5E72\u6270\u81EA\u7136NT\u76844NT\u4ECD\u4E3A\u5B9A\u91CF\u9080\u8BF7\uFF1B\u8FBE\u5230\u6210\u5C40\u540E\u4E0D\u5C06\u666E\u901A\u4E00\u8F6E\u903C\u53EB\u7EE7\u7EED\u7B97\u4F5C\u672A\u89E3\u9664\u3002",
      "\u5DF2Pass\u5E94\u53EB\u4EBA\u7684\u81EA\u7136\u65B0\u82B1\u8272\u901A\u5E38\u4E0D\u903C\u53EB\uFF1B\u666E\u901A\u4E00\u8F6E\u903C\u53EB\u53CA\u8D1F\u52A0\u500D\u7ECF\u540C\u4F34\u4F5C\u51FA\u81EA\u7136\u7B54\u53EB\u5373\u5C65\u884C\uFF0C\u4E0D\u81EA\u52A8\u5EF6\u7EED\u5230\u4E0B\u4E00\u8F6E\u3002\u7B2C\u56DB\u82B1\u8272\u4E3A\u4EBA\u5DE5\u8BE2\u95EE\u3001\u903C\u53EB\u4E00\u8F6E\uFF0C\u4E0D\u627F\u8BFA\u5957\u957F\uFF1B\u81EA\u7136\u7B2C\u4E8C\u5957\u91CD\u590D\u4E0D\u81EA\u52A8\u4ECE\u56DB\u5F20\u53D8\u6210\u516D\u5F20\uFF0C\u7B54\u8BE2\u95EE\u540E\u7684\u8FDF\u5230\u9AD8\u82B1\u652F\u6301\u53EF\u4EC5\u4E09\u5F20\u3002\u5F31\u4E8C\u6216\u5F31\u8DF3\u4E89\u53EB\u540E\u7684\u666E\u901A\u52A0\u53EB\u4E0D\u903C\u53EB\uFF0C\u662F\u5EF6\u957F\u963B\u51FB\u800C\u975E\u6B63\u5E38\u9080\u8BF7\uFF1B\u6700\u4F4E\u56DE\u5230\u5F00\u53EB\u5957\u53EF\u4EC5\u4E3A\u4E24\u5F20\u504F\u597D\uFF0C\u4E0D\u80FD\u636E\u6B64\u8BA4\u5B9A\u516B\u5F20\u914D\u5408\u3002\u81EA\u71361NT\u518D\u53EB\u540E\u7684\u539F\u5957\u504F\u597D\u4E0D\u4F5C\u4E3AJacoby\u8F6C\u79FB\u3002\u4EBA\u5DE5\u7EA6\u5B9A\u53CA\u5DF2\u5EFA\u7ACB\u7684\u8FDB\u5C40\u903C\u53EB\u4ECD\u6309\u5176\u5177\u4F53\u89C4\u5219\u7EE7\u7EED\u3002"
    ],
    limitations: "\u8FD9\u662F\u7528\u6237\u6307\u5B9A\u7684\u6DF7\u5408\u4F53\u7CFB\uFF1ASAYC\u5F00\u53EB\u4E0E\u7ADE\u4E89\u7ED3\u6784\uFF0C\u52A02/1\u8FDB\u5C40\u903C\u53EB\u30015\u201312\u534A\u903C\u53EB1NT\u53CARKCB 1430\uFF0C\u56E0\u6B64\u4E0D\u6807\u4F5C\u201C\u539F\u7248\u4E25\u683CSAYC\u201D\u3002\u5224\u65AD\u4ECD\u662F\u786E\u5B9A\u6027\u6559\u5B66\u5F15\u64CE\uFF0C\u4E0D\u7B49\u540C\u4E8E\u4EBA\u7C7B\u4E13\u5BB6\u4E34\u573A\u5224\u65AD\u3002"
  },
  "two-over-one": {
    name: "2/1 \u8FDB\u5C40\u903C\u53EB",
    short: "2/1",
    summary: "\u4E94\u5F20\u9AD8\u82B1 \xB7 15\u201317 \u5F3A\u65E0\u5C06 \xB7 \u672A Pass \u624B\u724C\u7684\u65E0\u5E72\u6270\u4E8C\u76D6\u4E00\u8FDB\u5C40\u903C\u53EB",
    rules: [
      "1\u2665\uFF0F1\u2660\uFF1A12\u201321 HCP\uFF0C5+ \u5F20\uFF1B1\u2663\uFF0F1\u2666\uFF1A\u8F83\u597D\u4F4E\u82B1\uFF0C3+ \u5F20\uFF0C3\u20133 \u5F00\u6885\u82B1\uFF0C4\u20134 \u5F00\u65B9\u5757\u3002",
      "1NT\uFF1A15\u201317 \u5747\u578B\uFF1B2NT\uFF1A20\u201321 \u5747\u578B\uFF1B2\u2663\uFF1A22+ \u5F3A\u724C\uFF0C2\u2666 \u7B49\u5F85\u5E94\u53EB\uFF1B2\u2666\uFF0F2\u2665\uFF0F2\u2660\uFF1A6\u201310 HCP\u30016+ \u5F20\u5F31\u4E8C\u3002",
      "\u672A\u66FE Pass \u4E14\u65E0\u654C\u65B9\u5E72\u6270\u65F6\uFF0C1\u2666\u20132\u2663\u30011\u2665\u20132\u2663\uFF0F2\u2666\u30011\u2660\u20132\u2663\uFF0F2\u2666\uFF0F2\u2665\u4E3A\u8FDB\u5C40\u903C\u53EB\u30022\u2663\u53EF\u4E3A3+\u5F20\uFF0C2\u26664+\u5F20\uFF0C2\u26655+\u5F20\u3002",
      "1M\u20131NT\uFF1A6\u201312 HCP\uFF0C\u672A Pass \u624B\u724C\u903C\u53EB\u4E00\u8F6E\uFF1BPass \u8FC7\u7684\u5E94\u53EB\u4EBA\u5219\u4E0D\u903C\u53EB\u3002\u9AD8\u82B1\u52A0\u53EB\u5728\u786E\u8BA4\u81F3\u5C118\u5F20\u914D\u5408\u540E\u6539\u7528\u8C03\u6574\u70B9\uFF1A6\u20139\u7B80\u5355\u52A0\u53EB\uFF0C10\u201312\u9650\u5236\u6027\u8DF3\u52A0\u53EB\u3002",
      "Jacoby 2NT\uFF1A\u65E0\u5E72\u6270\u65F6\uFF0C4+\u5F20\u9AD8\u82B1\u652F\u6301\u300113+\u8C03\u6574\u70B9\u3001\u8FDB\u5C40\u903C\u53EB\uFF1B\u5F00\u53EB\u4EBA\u4E09\u9636\u65B0\u82B1\u8272\u8868\u793A\u5355\u7F3A\u3002"
    ],
    limitations: "\u8FD9\u662F\u660E\u786E\u7EA6\u5B9A\u7684\u57FA\u7840 2/1 \u914D\u7F6E\u3002\u7B2C\u56DB\u82B1\u8272\u903C\u53EB\u3001\u65B0\u4F4E\u82B1\u903C\u53EB\u3001Splinter\u3001Drury \u548C\u5B8C\u6574\u6EE1\u8D2F\u63A7\u5236\u53EB\u5C1A\u672A\u5B9E\u73B0\u3002"
  },
  precision: {
    name: "\u7CBE\u786E\u5236",
    short: "\u7CBE\u786E",
    summary: "16+ \u5F3A\u6885\u82B1 \xB7 11\u201315 \u9650\u5236\u6027\u5F00\u53EB \xB7 13\u201315 \u65E0\u5C06 \xB7 \u77ED\u65B9\u5757\u914D\u7F6E",
    rules: [
      "1\u2663\uFF1A16+ HCP \u4EBA\u4E3A\u5F3A\u5F00\u53EB\uFF0822\u201323 \u5747\u578B\u53E6\u5F002NT\uFF09\uFF1B1\u2666\uFF1A11\u201315 HCP\u30012+\u5F20\u65B9\u5757\uFF1B1\u2665\uFF0F1\u2660\uFF1A11\u201315 HCP\u30015+\u5F20\u3002",
      "1NT\uFF1A13\u201315 \u5747\u578B\uFF0C\u65E05\u5F20\u9AD8\u82B1\uFF1B2NT\uFF1A22\u201323 \u5747\u578B\u30022\u2663\uFF1A11\u201315\u30016+\u6885\u82B1\uFF0C\u62165\u6885\u82B1\u52A04\u5F20\u9AD8\u82B1\u3002",
      "2\u2666\uFF1A11\u201315\uFF0C4=4=1=4\u30014=4=0=5\u30014=3=1=5\u30013=4=1=5 \u724C\u578B\uFF1B2\u2665\uFF0F2\u2660\uFF1A6\u201310 HCP\u30016+\u5F20\u5F31\u4E8C\u3002",
      "\u5F3A1\u2663\u540E\uFF1A1\u2666\u4E3A0\u20137\u8D1F\u5E94\u53EB\uFF1B8+\u75285\u5F20\u5957\u6B63\u5E94\u53EB\uFF0C\u65E05\u5F20\u5957\u75281NT\uFF088\u201313\uFF09\uFF0F2NT\uFF0814+\uFF09\u3002\u6B63\u5E94\u53EB\u5EFA\u7ACB\u8FDB\u5C40\u903C\u53EB\u3002",
      "1\u2663\u20131\u2666\u540E\u81EA\u7136\u518D\u53EB\uFF1A1NT 16\u201318 \u5747\u578B\uFF0C2NT 19\u201321\uFF0C3NT 24+\uFF1B\u65B0\u9AD8\u82B14+\u5F20\uFF0C\u8D1F\u5E94\u53EB\u4EBA\u53EF\u75280\u20134\u70B9 Pass\u3002",
      "2\u2663\u20132\u2666\u95EE\u9AD8\u82B1\uFF1A2\u2665\uFF0F2\u2660\u8868\u793A4\u5F20\u9AD8\u82B1\uFF0C\u5426\u52192NT\u793A14\u201315\uFF0C3\u2663\u793A11\u201313\u30022\u2666\u20132NT\u95EE\u724C\u578B\uFF1A3\u2663=4414\u30013\u2666=4405\u30013\u2665=4315\u30013\u2660=3415\u3002"
    ],
    limitations: "\u8FD9\u662F\u57FA\u7840\u77ED\u65B9\u5757\u7CBE\u786E\u914D\u7F6E\uFF0C\u90E8\u5206\u5E94\u53EB\u91C7\u7528\u81EA\u7136\u5904\u7406\u3002\u590D\u6742\u5F3A\u6885\u82B1\u63A5\u529B\u3001\u63A7\u5236\u95EE\u53EB\u3001Ogust\u3001\u8D4C\u535A3NT\u548C\u7ADE\u4E89\u540E\u7684\u5B8C\u6574\u63A5\u529B\u5C1A\u672A\u5B9E\u73B0\u3002"
  },
  "natural-lite": { name: "v0.1 \u7B80\u5316\u81EA\u7136\u5236", short: "\u65E7\u81EA\u7136\u5236", summary: "\u4EC5\u7528\u4E8E\u7EE7\u7EED\u65E7\u5B58\u6863\u7684\u65E2\u6709\u7EA6\u5B9A", rules: ["\u4E94\u5F20\u9AD8\u82B1\u300115\u201317 \u65E0\u5C06\u3001\u81EA\u7136\u5E94\u53EB\u548C\u52A0\u53EB\u3002"], limitations: "\u65E7\u7248\u542F\u53D1\u5F0F\uFF0C\u4E0D\u542B\u65B0\u7248\u672C\u7EA6\u5B9A\u3002" }
};

// src/ai/bidding-semantics.ts
var bids = (auction) => auction.flatMap((entry, index) => entry.call.kind === "bid" ? [{ seat: entry.seat, call: entry.call, index }] : []);
var major = (strain) => strain === "H" || strain === "S";
var gameLevel = (strain) => strain === "NT" ? 3 : major(strain) ? 4 : 5;
var atGame = (call) => call.level >= gameLevel(call.strain);
var openerStrongClub = (call) => call.level === 2 && call.strain === "C";
var intervened = (auction, seat, from, to = auction.length) => auction.slice(from + 1, to).some((entry) => sideOf(entry.seat) !== sideOf(seat) && entry.call.kind !== "pass");
var passedBefore = (auction, seat, index) => auction.slice(0, index).some((entry) => entry.seat === seat && entry.call.kind === "pass");
function isTakeoutDoubleAt(auction, index) {
  const entry = auction[index];
  const opening = bids(auction)[0];
  if (!entry || entry.call.kind !== "double" || !opening || opening.call.strain === "NT" || opening.call.level > 3 || sideOf(entry.seat) === sideOf(opening.seat)) return false;
  const target = bids(auction.slice(0, index)).at(-1);
  if (target && isArtificialBidAt(auction, target.index)) return false;
  if (index === opening.index + 1 || index === opening.index + 3 && auction.slice(opening.index + 1, index).every((before2) => before2.call.kind === "pass")) return true;
  const before = auction.slice(0, index);
  const ourEarlierActions = before.filter((e) => sideOf(e.seat) === sideOf(entry.seat) && e.call.kind !== "pass");
  if (ourEarlierActions.some((e) => e.call.kind !== "double" || e.seat !== entry.seat) || ourEarlierActions.some((e) => !isTakeoutDoubleAt(auction.slice(0, index), before.indexOf(e)))) return false;
  const enemy = bids(before).filter((e) => sideOf(e.seat) !== sideOf(entry.seat));
  const last = enemy.at(-1);
  const naturalTwoSuitAuction = opening.call.level === 1 && enemy.length === 3 && enemy[1].call.level === 1 && enemy[1].seat !== opening.seat && enemy[2].seat === opening.seat && enemy[2].call.level === 2 && enemy[2].call.strain !== "NT";
  const sandwichAuction = opening.call.level === 1 && enemy.length === 2 && enemy[1].seat === partnerOf(opening.seat) && enemy[1].call.level === 1 && enemy[1].call.strain !== "NT" && enemy[1].call.strain !== opening.call.strain;
  return !!last && last.call.strain !== "NT" && last.call.level <= 3 && (enemy.every((e) => e.call.strain === opening.call.strain) || naturalTwoSuitAuction || sandwichAuction) && (index === last.index + 1 || index === last.index + 3 && before.slice(last.index + 1).every((e) => e.call.kind === "pass"));
}
function isNegativeDoubleAt(auction, index) {
  const opening = bids(auction.slice(0, index))[0], entry = auction[index];
  const overcall = opening && auction[opening.index + 1];
  return !!opening && entry?.call.kind === "double" && opening.call.level === 1 && opening.call.strain !== "NT" && entry.seat === partnerOf(opening.seat) && index === opening.index + 2 && overcall?.call.kind === "bid" && overcall.call.strain !== "NT" && overcall.call.strain !== opening.call.strain && bidValue(overcall.call) <= bidValue({ kind: "bid", level: 2, strain: "S" });
}
function isDelayedTakeoutSuitAnswer(auction, index) {
  const entry = auction[index];
  if (entry?.call.kind !== "bid" || entry.call.strain === "NT") return false;
  const double = auction.findLastIndex((prior, priorIndex) => priorIndex < index && prior.seat === partnerOf(entry.seat) && isTakeoutDoubleAt(auction, priorIndex));
  if (double < 0 || auction.slice(double + 1, index).some((prior) => prior.seat === entry.seat)) return false;
  const enemy = bids(auction.slice(0, double)).filter((prior) => sideOf(prior.seat) !== sideOf(entry.seat));
  return enemy.length === 3 && enemy[0].seat === enemy[2].seat && enemy[0].call.level === 1 && enemy[2].call.level === 2 && enemy[2].call.strain !== enemy[0].call.strain && entry.call.strain !== enemy[0].call.strain && entry.call.strain !== enemy[2].call.strain;
}
function publicKeycardTrumpAt(auction, questionIndex, system) {
  const question = auction[questionIndex];
  if (question?.call.kind !== "bid" || question.call.level !== 4 || question.call.strain !== "NT" || !isArtificialBidAt(auction, questionIndex, system)) return void 0;
  const prior = bids(auction).filter((entry) => entry.index < questionIndex && sideOf(entry.seat) === sideOf(question.seat));
  const natural = prior.filter((entry) => !isArtificialBidAt(auction, entry.index, system));
  const agreed = natural.findLast((entry) => entry.call.strain !== "NT" && natural.some((other) => other.seat !== entry.seat && other.call.strain === entry.call.strain));
  if (agreed) return agreed.call.strain;
  if (prior[0]?.call.level === 1 && major(prior[0].call.strain) && prior[1]?.call.level === 2 && prior[1].call.strain === "NT" && isArtificialBidAt(auction, prior[1].index, system)) return prior[0].call.strain;
  if (natural.some((entry) => entry.call.strain === "NT")) return void 0;
  return natural.findLast((entry) => entry.seat === partnerOf(question.seat) && entry.call.strain !== "NT")?.call.strain;
}
function isArtificialBidAt(auction, index, system = "sayc") {
  const target = auction[index];
  if (target?.call.kind !== "bid") return false;
  if (isDelayedTakeoutSuitAnswer(auction, index)) return false;
  const targetBid = target.call;
  const prefix = auction.slice(0, index + 1), all = bids(prefix);
  const own = all.filter((entry) => sideOf(entry.seat) === sideOf(target.seat));
  const preceding = own.at(-2);
  const ntBeforeInquiry = own.at(-3);
  if (major(targetBid.strain) && preceding?.call.strain === "C" && targetBid.level === preceding.call.level && ntBeforeInquiry?.call.strain === "NT" && preceding.call.level === ntBeforeInquiry.call.level + 1 && noTrumpRangeAt(prefix, ntBeforeInquiry.index, system)) return false;
  const jacoby = (system === "sayc" || system === "two-over-one") && own[0]?.call.level === 1 && own[0].index === all[0]?.index && major(own[0].call.strain) && own[1]?.call.level === 2 && own[1].call.strain === "NT" && !intervened(prefix, target.seat, own[0].index, own[1].index);
  if (jacoby && (own.length === 2 || own.length === 3 && targetBid.level === 3 && targetBid.strain !== "NT" && targetBid.strain !== own[0].call.strain)) return true;
  if (targetBid.level === 4 && targetBid.strain === "NT") {
    const prior = own.slice(0, -1);
    const agreedSuit = prior.some((entry) => entry.call.strain !== "NT" && prior.some((other) => other.seat !== entry.seat && other.call.strain === entry.call.strain && !isArtificialBidAt(prefix, entry.index, system) && !isArtificialBidAt(prefix, other.index, system)));
    const naturalNt = prior.some((entry) => entry.call.strain === "NT" && !isArtificialBidAt(prefix, entry.index, system));
    const partnerSuit = prior.findLast((entry) => entry.seat === partnerOf(target.seat) && entry.call.strain !== "NT" && !isArtificialBidAt(prefix, entry.index, system));
    return jacoby || agreedSuit || !naturalNt && !!partnerSuit;
  }
  if (targetBid.level === 5 && targetBid.strain !== "NT" && preceding?.call.level === 4 && preceding.call.strain === "NT") {
    const trump = publicKeycardTrumpAt(prefix, preceding.index, system);
    return isArtificialBidAt(prefix, preceding.index, system) && targetBid.strain !== trump;
  }
  if (targetBid.strain !== "NT" && all.some((entry) => entry.index < index && sideOf(entry.seat) !== sideOf(target.seat) && entry.call.strain === targetBid.strain && !isArtificialBidAt(prefix, entry.index, system)) && !own.slice(0, -1).some((entry) => entry.call.strain === targetBid.strain)) return true;
  if (preceding?.seat === partnerOf(target.seat) && preceding.call.strain === "NT" && preceding.call.level <= 2 && target.call.level === preceding.call.level + 1 && (["C", "D", "H"].includes(target.call.strain) || preceding.call.level === 1 && target.call.strain === "S") && noTrumpRangeAt(prefix, preceding.index, system) && (own.length === 2 || own.length === 4 && own[0].call.strain === "C" && (own[0].call.level === 2 || system === "precision" && own[0].call.level === 1)) && !prefix.slice(preceding.index + 1, index).some((entry) => sideOf(entry.seat) !== sideOf(target.seat) && entry.call.kind !== "pass")) return true;
  return analyzeAuctionSemantics(prefix, partnerOf(target.seat), system).currentContractArtificial;
}
function classifyDoubleAt(auction, index, system = "sayc") {
  const entry = auction[index];
  if (entry?.call.kind !== "double") return void 0;
  const before = bids(auction.slice(0, index)), opening = before[0], target = before.at(-1);
  if (target && isArtificialBidAt(auction, target.index, system)) {
    if (opening?.call.level === 1 && target.index === opening.index + 1 && index === target.index + 1 && entry.seat === partnerOf(opening.seat) && target.call.level === 2 && (opening.call.strain !== "NT" && target.call.strain === opening.call.strain || target.call.strain === "NT")) return "two-suit-strength";
    return "lead-directing";
  }
  if (isNegativeDoubleAt(auction, index)) return "negative";
  if (isTakeoutDoubleAt(auction, index)) return "takeout";
  return "penalty";
}
function isTwoOverOne(opening, response, auction) {
  const o = opening.call, r = response.call;
  return o.level === 1 && o.strain !== "NT" && r.level === 2 && r.strain !== "NT" && r.strain !== o.strain && bidValue(r) - bidValue(o) <= 5 && !passedBefore(auction, response.seat, opening.index) && !intervened(auction, opening.seat, opening.index, response.index);
}
function naturalRebidRange(system, opening, rebid) {
  if (rebid.strain !== "NT") return void 0;
  if (system === "two-over-one" || system === "sayc") {
    if (opening.level === 1 && opening.strain !== "NT" && rebid.level === 1) return { min: 12, max: 14 };
    if (opening.level === 1 && opening.strain !== "NT" && rebid.level === 2) return { min: 18, max: 19 };
  }
  if (system === "precision" && opening.level === 1 && opening.strain !== "C" && opening.strain !== "NT" && rebid.level === 1) return { min: 11, max: 12 };
  return void 0;
}
function noTrumpRangeAt(auction, entryIndex, system) {
  const target = auction[entryIndex];
  if (!target || target.call.kind !== "bid" || target.call.strain !== "NT") return void 0;
  const preceding = bids(auction).filter((entry) => entry.index <= entryIndex);
  const partnership = preceding.filter((entry) => sideOf(entry.seat) === sideOf(target.seat));
  const position = partnership.findIndex((entry) => entry.index === entryIndex);
  const ownTakeout = auction.findLastIndex((entry, index) => index < entryIndex && entry.seat === target.seat && isTakeoutDoubleAt(auction, index));
  if (system === "sayc" && ownTakeout >= 0 && !preceding.some((entry) => entry.index > ownTakeout && entry.index < entryIndex && entry.seat === target.seat)) {
    const answer = preceding.find((entry) => entry.index > ownTakeout && entry.seat === partnerOf(target.seat));
    if (answer && isArtificialBidAt(auction, answer.index, system)) return void 0;
    const previous = preceding.at(-2)?.call;
    const jumped = previous && bidValue(target.call) - bidValue(previous) > 5;
    return target.call.level === 2 && jumped ? { min: 21, max: 22 } : target.call.level <= 2 ? { min: 18, max: 20 } : void 0;
  }
  if (position === 4 && partnership[0]?.seat === target.seat && fourthSuit(partnership.slice(0, 4)) && target.call.level === 2)
    return { min: 12, max: 21 };
  if (position === 3 && partnership[1]?.seat === target.seat && reverseByOpener(partnership.slice(0, 3)) && target.call.level === 2)
    return { min: 6, max: 10 };
  if (position === 0) {
    const opposingOpening = preceding[0];
    if (opposingOpening?.index !== entryIndex) {
      if (system !== "sayc") return void 0;
      const ownDouble = auction.slice(0, entryIndex).some((entry, index) => entry.seat === target.seat && isTakeoutDoubleAt(auction, index));
      const partnerDouble = auction.slice(0, entryIndex).some((entry, index) => entry.seat === partnerOf(target.seat) && isTakeoutDoubleAt(auction, index));
      if (ownDouble) {
        const partnerResponse = preceding.find((entry) => entry.seat === partnerOf(target.seat));
        if (partnerResponse && preceding.some((entry) => entry.index < partnerResponse.index && sideOf(entry.seat) !== sideOf(target.seat) && entry.call.strain === partnerResponse.call.strain)) return void 0;
        const previous = preceding.at(-2)?.call;
        const jump = previous && bidValue(target.call) - bidValue(previous) > 5;
        return target.call.level === 2 && jump && partnerResponse?.call.strain !== opposingOpening.call.strain ? { min: 21, max: 22 } : { min: 18, max: 20 };
      }
      if (partnerDouble) return target.call.level === 1 ? { min: 6, max: 10 } : target.call.level === 2 ? { min: 11, max: 12 } : target.call.level === 3 ? { min: 13, max: 15 } : void 0;
      if (opposingOpening.call.strain === "NT") return void 0;
      if (opposingOpening.call.level === 1 && target.call.level === 2) return void 0;
      const between = auction.slice(opposingOpening.index + 1, entryIndex);
      const balancing = between.length === 2 && between.every((entry) => entry.call.kind === "pass");
      if (target.call.level === 1) return balancing ? { min: 11, max: 14 } : { min: 15, max: 18 };
      if (opposingOpening.call.level >= 2 && target.call.level <= 3) return { min: 15, max: 18 };
      return void 0;
    }
    if (target.call.level === 1) return system === "precision" ? { min: 13, max: 15 } : { min: 15, max: 17 };
    if (target.call.level === 2) return system === "precision" ? { min: 22, max: 23 } : { min: 20, max: 21 };
    if (target.call.level === 3 && system === "sayc") return { min: 25, max: 27 };
    return void 0;
  }
  const opening = partnership[0]?.call, response = partnership[1]?.call;
  if ((system === "sayc" || system === "two-over-one") && position === 3 && preceding[0].index === partnership[0].index && opening.level === 1 && opening.strain !== "NT" && target.seat === partnership[1].seat && response.level === 1 && response.strain !== "NT" && partnership[2].seat === partnership[0].seat && partnership[2].call.level <= 2 && partnership[2].call.strain !== "NT" && target.call.level === 2)
    return { min: 11, max: 12 };
  if ((system === "sayc" || system === "two-over-one") && position === 1 && preceding[0].index === partnership[0].index && opening.level === 1 && major(opening.strain) && target.call.level === 1 && !intervened(auction, target.seat, partnership[0].index, entryIndex))
    return { min: 5, max: 12 };
  if (system === "sayc" && opening.level === 1 && opening.strain !== "NT" && target.seat === partnership[0].seat && position === 1 && auction.slice(partnership[0].index + 1, entryIndex).some((entry) => entry.seat === partnerOf(target.seat) && entry.call.kind === "double")) {
    const previous = preceding.at(-2)?.call;
    const jumped = previous && bidValue(target.call) - bidValue(previous) > 5;
    return target.call.level === 1 ? { min: 12, max: 14 } : target.call.level === 2 ? jumped ? { min: 18, max: 19 } : { min: 12, max: 18 } : target.call.level === 3 ? { min: 19, max: 21 } : void 0;
  }
  if (system === "sayc" && preceding[0].index === partnership[0].index && opening.level === 1 && opening.strain !== "NT" && target.seat === partnership[0].seat && position >= 2 && target.call.level === 2 && partnership.filter((entry) => entry.seat === target.seat).length >= 3 && !partnership.slice(0, position).some((entry) => entry.seat === target.seat && entry.call.strain === "NT") && !isTwoOverOne(partnership[0], partnership[1], auction)) return { min: 18, max: 19 };
  if (position === 1 && system === "sayc" && preceding[0].index === partnership[0].index && opening.level === 1 && (opening.strain === "C" || opening.strain === "D") && !intervened(auction, target.seat, partnership[0].index, entryIndex)) {
    if (target.call.level === 2) return { min: 11, max: 12 };
    if (target.call.level === 3) return { min: 13, max: 21 };
  }
  if (position === 2 && partnership[0]?.seat === target.seat && partnership[1]?.seat !== target.seat) {
    if (preceding[0].index !== partnership[0].index) return void 0;
    if (system === "sayc" && opening.level === 1 && opening.strain !== "NT" && response.level === 2 && response.strain !== "NT" && response.strain !== opening.strain && passedBefore(auction, partnership[1].seat, partnership[0].index) && !intervened(auction, target.seat, partnership[0].index, entryIndex)) {
      return target.call.level === 2 ? { min: 12, max: 14 } : target.call.level === 3 ? { min: 18, max: 19 } : void 0;
    }
    if ((system === "two-over-one" || system === "sayc") && opening?.level === 2 && opening.strain === "C" && response?.level === 2 && response.strain === "D") {
      if (target.call.level === 2) return { min: 22, max: 24 };
      if (target.call.level === 3) return { min: 25, max: 37 };
    }
    if (system === "precision" && opening?.level === 1 && opening.strain === "C" && response?.level === 1 && response.strain === "D") {
      if (target.call.level === 1) return { min: 16, max: 18 };
      if (target.call.level === 2) return { min: 19, max: 21 };
      if (target.call.level === 3) return { min: 24, max: 37 };
    }
    if ((system === "sayc" || system === "two-over-one") && isTwoOverOne(partnership[0], partnership[1], auction) && target.call.level === 2) return { min: 12, max: 21 };
    if (preceding[0].index !== partnership[0].index || response.level !== 1) return void 0;
    return naturalRebidRange(system, partnership[0].call, target.call);
  }
  return void 0;
}
function latestNoTrumpRange(auction, seat, system, before = auction.length) {
  const candidates = bids(auction).filter((entry) => entry.index < before && sideOf(entry.seat) === sideOf(seat) && entry.call.strain === "NT");
  for (let i = candidates.length - 1; i >= 0; i--) {
    const range = noTrumpRangeAt(auction, candidates[i].index, system);
    if (range) return range;
  }
}
function reverseByOpener(partnership) {
  if (partnership.length < 3) return false;
  const [opening, response, rebid] = partnership;
  return opening.seat === rebid.seat && response.seat !== opening.seat && opening.call.level === 1 && response.call.level === 1 && rebid.call.level === 2 && rebid.call.strain !== "NT" && rebid.call.strain !== opening.call.strain && rebid.call.strain !== response.call.strain && bidValue({ kind: "bid", level: 1, strain: rebid.call.strain }) > bidValue(opening.call);
}
function fourthSuit(partnership) {
  if (partnership.length !== 4) return false;
  const natural = partnership.map((entry) => entry.call).filter((call) => call.strain !== "NT");
  return natural.length === 4 && new Set(natural.map((call) => call.strain)).size === 4 && partnership[3].call.level >= 2 && partnership[1].seat === partnership[3].seat;
}
function newMinor(partnership) {
  if (partnership.length !== 4) return false;
  const [opening, response, rebid, inquiry] = partnership;
  return opening.call.level === 1 && !major(opening.call.strain) && response.call.level === 1 && major(response.call.strain) && rebid.call.level === 1 && rebid.call.strain === "NT" && inquiry.call.level === 2 && (inquiry.call.strain === "C" || inquiry.call.strain === "D") && inquiry.call.strain !== opening.call.strain;
}
function responderTrialBid(partnership) {
  if (partnership.length !== 4) return false;
  const [opening, response, raise, trial] = partnership;
  return opening.call.level === 1 && response.call.level === 1 && response.call.strain !== "NT" && raise.seat === opening.seat && raise.call.level === 2 && raise.call.strain === response.call.strain && trial.seat === response.seat && trial.call.level <= 3 && trial.call.strain !== "NT" && trial.call.strain !== response.call.strain;
}
function artificialAnswer(partnership, system, auction) {
  if (partnership.length < 3) return false;
  const last = partnership.at(-1).call;
  const previous = partnership.at(-2).call;
  const before = partnership.at(-3).call;
  const ntIndex = partnership.length - 3;
  const ntPlatform = ntIndex === 0 || ntIndex === 2 && partnership[0].call.strain === "C" && (partnership[0].call.level === 2 || system === "precision" && partnership[0].call.level === 1);
  if (ntPlatform && before.strain === "NT" && before.level <= 3 && previous.strain === "C" && previous.level === before.level + 1 && last.level === previous.level && last.strain === "D") return true;
  if (system === "precision" && partnership[0].call.level === 2 && partnership[0].call.strain === "D" && previous.level === 2 && previous.strain === "NT" && last.level === 3) return true;
  if (previous.level === 4 && previous.strain === "NT" && last.level === 5) {
    if (!isArtificialBidAt(auction, partnership.at(-2).index, system)) return false;
    const trump = publicKeycardTrumpAt(auction, partnership.at(-2).index, system);
    return last.strain !== trump;
  }
  return false;
}
function analyzeAuctionSemantics(auction, seat, system) {
  const all = bids(auction);
  const partnership = all.filter((entry) => sideOf(entry.seat) === sideOf(seat));
  const opening = partnership[0], response = partnership[1];
  const naturalOpening = opening && all[0]?.seat === opening.seat;
  const globalOpening = all[0];
  const directAction = globalOpening ? auction[globalOpening.index + 1] : void 0;
  const responderAction = globalOpening ? auction[globalOpening.index + 2] : void 0;
  const advancerAction = globalOpening ? auction[globalOpening.index + 3] : void 0;
  if (system === "sayc" && globalOpening?.call.level === 1 && globalOpening.call.strain !== "NT" && directAction?.call.kind === "bid" && directAction.call.level === 2 && directAction.call.strain !== "NT" && directAction.call.strain !== globalOpening.call.strain && bidValue(directAction.call) - bidValue(globalOpening.call) > 5 && sideOf(directAction.seat) === sideOf(seat) && partnership[1]?.call.level === 2 && partnership[1].call.strain === "NT" && (partnership.length === 2 && directAction.seat === seat || partnership.length === 3 && directAction.seat !== seat)) {
    const answeredInTrump = partnership.length === 3 && partnership[2].call.strain === directAction.call.strain;
    return {
      forcing: answeredInTrump ? "none" : "one-round",
      convention: "weak-jump-inquiry",
      mustBid: !answeredInTrump,
      currentContractArtificial: !answeredInTrump
    };
  }
  const pendingTakeout = auction.findLastIndex((entry, index) => entry.seat === partnerOf(seat) && isTakeoutDoubleAt(auction, index));
  if (system === "sayc" && pendingTakeout >= 0 && !auction.some((entry, index) => index > pendingTakeout && entry.seat === seat) && !auction.some((entry, index) => index > pendingTakeout && sideOf(entry.seat) !== sideOf(seat) && (entry.call.kind === "bid" || entry.call.kind === "redouble"))) {
    return { forcing: "one-round", convention: "takeout-response", mustBid: true, currentContractArtificial: false };
  }
  if (system === "sayc" && globalOpening?.call.level === 1 && globalOpening.call.strain !== "NT" && globalOpening.seat === seat && directAction?.call.kind === "bid" && directAction.call.strain !== "NT" && bidValue(directAction.call) <= bidValue({ kind: "bid", level: 2, strain: "S" }) && responderAction?.seat === partnerOf(seat) && responderAction.call.kind === "double" && advancerAction?.call.kind === "pass" && !auction.some((entry, index) => index > globalOpening.index + 2 && entry.seat === seat)) {
    return { forcing: "one-round", convention: "negative-double", mustBid: true, currentContractArtificial: false };
  }
  const opposingNaturalOpening = all[0];
  const partnerIntervention = all.find((entry) => entry.index === (opposingNaturalOpening?.index ?? -2) + 1 && entry.seat === partnerOf(seat));
  const ownActionAfterIntervention = partnerIntervention ? auction.some((entry, index) => index > partnerIntervention.index && entry.seat === seat) : false;
  const naturalEnemyBidAfterIntervention = partnerIntervention ? auction.some((entry, index) => index > partnerIntervention.index && sideOf(entry.seat) !== sideOf(seat) && entry.call.kind === "bid") : false;
  if (system === "sayc" && opposingNaturalOpening?.call.level === 1 && sideOf(opposingNaturalOpening.seat) !== sideOf(seat) && partnerIntervention?.call.level === 2 && partnerIntervention.index === opposingNaturalOpening.index + 1 && !naturalEnemyBidAfterIntervention && !ownActionAfterIntervention) {
    if (opposingNaturalOpening.call.strain !== "NT" && partnerIntervention.call.strain === opposingNaturalOpening.call.strain) {
      return { forcing: "one-round", convention: "michaels-advance", mustBid: true, currentContractArtificial: true };
    }
    if (partnerIntervention.call.strain === "NT") {
      return { forcing: "one-round", convention: "unusual-advance", mustBid: true, currentContractArtificial: true };
    }
  }
  if (system === "sayc" && opposingNaturalOpening?.call.level === 1 && major(opposingNaturalOpening.call.strain) && sideOf(opposingNaturalOpening.seat) !== sideOf(seat) && directAction?.seat === seat && directAction.call.kind === "bid" && directAction.call.level === 2 && directAction.call.strain === opposingNaturalOpening.call.strain && advancerAction?.seat === partnerOf(seat) && advancerAction.call.kind === "bid" && advancerAction.call.level === 2 && advancerAction.call.strain === "NT" && !auction.some((entry, index) => index > opposingNaturalOpening.index + 3 && entry.seat === seat)) {
    return { forcing: "one-round", convention: "michaels-inquiry", mustBid: true, currentContractArtificial: true };
  }
  if (system === "sayc" && opposingNaturalOpening && opposingNaturalOpening.call.strain !== "NT" && sideOf(opposingNaturalOpening.seat) !== sideOf(seat) && directAction?.seat === seat && directAction.call.kind === "bid" && directAction.call.level <= 2 && directAction.call.strain === "NT" && (opposingNaturalOpening.call.level >= 2 || directAction.call.level === 1) && advancerAction?.seat === partnerOf(seat) && advancerAction.call.kind === "bid" && advancerAction.call.level === directAction.call.level + 1 && advancerAction.call.strain === "C" && !auction.some((entry, index) => index > opposingNaturalOpening.index + 3 && entry.seat === seat)) {
    return { forcing: "one-round", convention: "overcall-stayman", mustBid: true, currentContractArtificial: true };
  }
  if (system === "sayc" && opposingNaturalOpening && opposingNaturalOpening.call.strain !== "NT" && sideOf(opposingNaturalOpening.seat) !== sideOf(seat) && directAction?.seat === seat && directAction.call.kind === "bid" && directAction.call.level <= 2 && directAction.call.strain === "NT" && (opposingNaturalOpening.call.level >= 2 || directAction.call.level === 1) && advancerAction?.call.kind === "bid" && advancerAction.call.level === directAction.call.level + 1 && ["D", "H", "S"].includes(advancerAction.call.strain) && !auction.some((entry, index) => index > opposingNaturalOpening.index + 3 && (entry.seat === seat || sideOf(entry.seat) !== sideOf(seat) && entry.call.kind === "bid"))) {
    return { forcing: "one-round", convention: "overcall-transfer", mustBid: true, currentContractArtificial: true };
  }
  if (system === "sayc" && opposingNaturalOpening?.call.level === 1 && opposingNaturalOpening.call.strain !== "NT" && sideOf(opposingNaturalOpening.seat) !== sideOf(seat) && directAction?.seat === seat && directAction.call.kind === "bid" && directAction.call.strain !== "NT" && directAction.call.strain !== opposingNaturalOpening.call.strain && advancerAction?.seat === partnerOf(seat) && advancerAction.call.kind === "bid" && advancerAction.call.strain === opposingNaturalOpening.call.strain && !auction.some((entry, index) => index > opposingNaturalOpening.index + 3 && entry.seat === seat)) {
    return { forcing: "one-round", convention: "overcall-cue", mustBid: true, currentContractArtificial: true };
  }
  const competitiveCue = naturalOpening && response && response.seat === partnerOf(opening.seat) && !isDelayedTakeoutSuitAnswer(auction, response.index) && response.call.strain !== "NT" && all.some((entry) => entry.index > opening.index && entry.index < response.index && sideOf(entry.seat) !== sideOf(seat) && entry.call.strain === response.call.strain && !isArtificialBidAt(auction, entry.index, system));
  const jacobyGameForce = naturalOpening && response && (system === "sayc" || system === "two-over-one") && opening.call.level === 1 && major(opening.call.strain) && response.call.level === 2 && response.call.strain === "NT" && !intervened(auction, seat, opening.index, response.index);
  const gameForce = !!jacobyGameForce || !!(competitiveCue && response.call.level >= 3) || !!(naturalOpening && response && (system === "two-over-one" || system === "sayc" ? isTwoOverOne(opening, response, auction) : system === "precision" && opening.call.level === 1 && opening.call.strain === "C" && !(response.call.level === 1 && response.call.strain === "D")));
  const partnershipReachedGame = partnership.some((entry) => atGame(entry.call));
  const ntPlatformIndex = opening?.call.strain === "NT" ? 0 : opening?.call.level === 2 && opening.call.strain === "C" && partnership[2]?.call.strain === "NT" ? 2 : -1;
  if ((system === "sayc" || system === "two-over-one") && ntPlatformIndex >= 0 && !partnershipReachedGame) {
    const ntPlatform = partnership[ntPlatformIndex], transfer = partnership[ntPlatformIndex + 1];
    const acceptance = partnership[ntPlatformIndex + 2], secondMajor = partnership[ntPlatformIndex + 3];
    const target = transfer?.call.strain === "D" ? "H" : transfer?.call.strain === "H" ? "S" : void 0;
    if (target && ntPlatform.call.level <= 2 && transfer.call.level === ntPlatform.call.level + 1 && acceptance?.call.strain === target && acceptance.call.level === transfer.call.level && secondMajor?.seat === transfer.seat && secondMajor.call.level === 3 && major(secondMajor.call.strain) && secondMajor.call.strain !== target)
      return { forcing: "game", convention: "responder-second-suit", mustBid: true, currentContractArtificial: false };
  }
  if (gameForce && !partnershipReachedGame) return { forcing: "game", convention: "none", mustBid: true, currentContractArtificial: false };
  if (system === "sayc" && naturalOpening && opening.call.level === 1 && opening.call.strain === "NT" && response?.call.level === 3 && response.call.strain !== "NT" && !competitiveCue && intervened(auction, seat, opening.index, response.index) && !partnershipReachedGame)
    return { forcing: "game", convention: "nt-competitive-response", mustBid: true, currentContractArtificial: false };
  const rebid = partnership[2];
  const previousBeforeRebid = rebid && all.findLast((entry) => entry.index < rebid.index);
  const openerJumpShift = naturalOpening && response && rebid && opening.call.level === 1 && opening.call.strain !== "NT" && response.call.level === 1 && rebid.seat === opening.seat && rebid.call.strain !== "NT" && rebid.call.strain !== opening.call.strain && rebid.call.strain !== response.call.strain && previousBeforeRebid && bidValue(rebid.call) - bidValue(previousBeforeRebid.call) > 5;
  if (openerJumpShift && !partnershipReachedGame)
    return { forcing: "game", convention: "opener-jump-shift", mustBid: true, currentContractArtificial: false };
  if (naturalOpening && (system === "sayc" || system === "two-over-one") && openerStrongClub(opening.call) && response?.call.level === 2 && response.call.strain === "D" && partnership.length >= 4 && partnership[2].call.strain !== "NT") {
    const naturalSuit = partnership[2].call.strain;
    const next = partnership[3].call;
    const negative = next.level === 3 && (major(naturalSuit) ? next.strain === "C" : system === "sayc" && (naturalSuit === "C" ? next.strain === "D" : next.strain === "NT"));
    const genuineGame = partnership.some((entry, index) => !(negative && index === 3) && atGame(entry.call));
    const originalAfterNegative = negative && partnership[4]?.call.strain === naturalSuit;
    if (!genuineGame && (!negative || partnership.length >= 5 && !originalAfterNegative))
      return { forcing: "game", convention: "strong-suit-rebid", mustBid: true, currentContractArtificial: false };
  }
  if (competitiveCue && opening.seat === seat && partnership.length === 2) {
    return { forcing: "one-round", convention: "competitive-cue", mustBid: true, currentContractArtificial: true };
  }
  const opposingOpening = all[0];
  const directTakeout = opposingOpening?.call.level <= 3 && opposingOpening.call.strain !== "NT" ? auction.findIndex((entry, index) => index > opposingOpening.index && entry.seat === seat && isTakeoutDoubleAt(auction, index)) : -1;
  const partnerCue = directTakeout >= 0 ? [...all].reverse().find((entry) => entry.seat === partnerOf(seat) && entry.index > directTakeout && entry.call.strain === opposingOpening.call.strain) : void 0;
  const ownBidAfterCue = partnerCue ? all.some((entry) => entry.seat === seat && entry.index > partnerCue.index) : false;
  if (partnerCue && !ownBidAfterCue && partnership.at(-1)?.index === partnerCue.index) return { forcing: "one-round", convention: "takeout-cue", mustBid: true, currentContractArtificial: true };
  const latestPartner = partnership.at(-1);
  const latestIsMichaels = latestPartner && all[0]?.call.level === 1 && all[0].call.strain !== "NT" && sideOf(all[0].seat) !== sideOf(seat) && latestPartner.index === all[0].index + 1 && latestPartner.call.level === 2 && latestPartner.call.strain === all[0].call.strain;
  if (latestPartner?.seat === partnerOf(seat) && latestPartner.call.strain !== "NT" && !latestIsMichaels && !isDelayedTakeoutSuitAnswer(auction, latestPartner.index) && all.some((entry) => entry.index < latestPartner.index && sideOf(entry.seat) !== sideOf(seat) && entry.call.strain === latestPartner.call.strain && !isArtificialBidAt(auction, entry.index, system)) && !partnership.some((entry) => entry.index < latestPartner.index && entry.call.strain === latestPartner.call.strain))
    return { forcing: "one-round", convention: "competitive-cue", mustBid: true, currentContractArtificial: true };
  const partnerMadeLastPartnershipBid = partnership.at(-1)?.seat !== seat;
  const opener = partnership[0]?.call;
  if (naturalOpening && partnerMadeLastPartnershipBid && partnership.length === 2 && opening.call.level === 1 && opening.call.strain !== "NT" && response.call.level === 1 && response.call.strain !== "NT" && response.call.strain !== opening.call.strain && !passedBefore(auction, response.seat, opening.index) && !auction.slice(response.index + 1).some((entry) => sideOf(entry.seat) !== sideOf(seat) && entry.call.kind === "bid") && !auction.slice(opening.index + 1, response.index).some((entry) => sideOf(entry.seat) !== sideOf(seat) && entry.call.kind === "bid")) {
    return { forcing: "one-round", convention: "natural-response", mustBid: true, currentContractArtificial: false };
  }
  if (naturalOpening && opening.seat === seat && partnership.length === 2 && opening.call.level === 1 && opening.call.strain !== "NT" && response.call.strain !== "NT" && response.call.strain !== opening.call.strain && !passedBefore(auction, response.seat, opening.index)) {
    const enemyBefore = all.filter((entry) => entry.index > opening.index && entry.index < response.index && sideOf(entry.seat) !== sideOf(seat));
    const previous = all.findLast((entry) => entry.index < response.index);
    const naturalFreeResponse = previous && enemyBefore.length > 0 && !enemyBefore.some((entry) => entry.call.strain === response.call.strain && !isArtificialBidAt(auction, entry.index, system)) && bidValue(response.call) - bidValue(previous.call) <= 5;
    if (naturalFreeResponse && !auction.some((entry, index) => index > response.index && sideOf(entry.seat) !== sideOf(seat) && entry.call.kind === "bid"))
      return { forcing: "one-round", convention: "natural-response", mustBid: true, currentContractArtificial: false };
  }
  if (naturalOpening && partnerMadeLastPartnershipBid && partnership.length === 1 && ((system === "two-over-one" || system === "sayc") && opener.level === 2 && opener.strain === "C" || system === "precision" && opener.level === 1 && opener.strain === "C")) return { forcing: "one-round", convention: "strong-opening", mustBid: true, currentContractArtificial: true };
  if (naturalOpening && partnerMadeLastPartnershipBid && (system === "two-over-one" || system === "sayc") && partnership.length === 2 && opener.level === 2 && opener.strain === "C" && partnership[1].call.level === 2 && partnership[1].call.strain === "D") return { forcing: "one-round", convention: "waiting-response", mustBid: true, currentContractArtificial: true };
  if (naturalOpening && partnerMadeLastPartnershipBid && (system === "two-over-one" || system === "sayc") && partnership.length === 3 && opener.level === 2 && opener.strain === "C" && partnership[1].call.strain === "D" && partnership[2].call.strain !== "NT") return { forcing: "one-round", convention: "strong-suit-rebid", mustBid: true, currentContractArtificial: false };
  if (naturalOpening && partnerMadeLastPartnershipBid && (system === "two-over-one" || system === "sayc") && partnership.length === 4 && opener.level === 2 && opener.strain === "C" && partnership[1].call.strain === "D" && partnership[2].call.strain !== "NT" && partnership[3].call.level === 3 && partnership[3].call.strain === "C") return { forcing: "one-round", convention: "artificial-answer", mustBid: true, currentContractArtificial: true };
  if (system === "sayc" && naturalOpening && partnerMadeLastPartnershipBid && partnership.length === 4 && opener.level === 2 && opener.strain === "C" && partnership[1].call.strain === "D" && partnership[3].call.level === 3 && (partnership[2].call.strain === "C" && partnership[3].call.strain === "D" || partnership[2].call.strain === "D" && partnership[3].call.strain === "NT"))
    return { forcing: "one-round", convention: "artificial-answer", mustBid: true, currentContractArtificial: true };
  if (naturalOpening && partnerMadeLastPartnershipBid && system === "sayc" && partnership.length === 2 && (opener.level === 3 || opener.level === 2 && opener.strain !== "C") && opener.strain !== "NT" && partnership[1].call.strain !== "NT" && partnership[1].call.strain !== opener.strain && !passedBefore(auction, partnership[1].seat, opening.index) && !auction.slice(partnership[1].index + 1).some((entry) => sideOf(entry.seat) !== sideOf(seat) && entry.call.kind === "bid")) return { forcing: "one-round", convention: "preempt-new-suit", mustBid: true, currentContractArtificial: false };
  if (naturalOpening && partnerMadeLastPartnershipBid && reverseByOpener(partnership) && partnership.length === 3 && !auction.slice(partnership[2].index + 1).some((entry) => sideOf(entry.seat) !== sideOf(seat) && entry.call.kind === "bid")) return { forcing: "one-round", convention: "reverse", mustBid: true, currentContractArtificial: false };
  if (naturalOpening && partnerMadeLastPartnershipBid && fourthSuit(partnership)) return { forcing: "one-round", convention: "fourth-suit", mustBid: true, currentContractArtificial: true };
  if ((system === "sayc" || system === "two-over-one") && naturalOpening && partnerMadeLastPartnershipBid && opening.call.level === 1 && opening.call.strain !== "NT" && opening.seat === seat && latestPartner?.seat === partnerOf(seat) && latestPartner.call.level === 3 && latestPartner.call.strain !== "NT" && !partnership.slice(0, -1).some((entry) => entry.call.strain === latestPartner.call.strain) && !passedBefore(auction, latestPartner.seat, opening.index) && !all.some((entry) => sideOf(entry.seat) !== sideOf(seat) && entry.call.strain === latestPartner.call.strain) && !auction.slice(latestPartner.index + 1).some((entry) => sideOf(entry.seat) !== sideOf(seat) && entry.call.kind === "bid") && (partnership.length === 4 && response?.call.level === 1 && response.call.strain !== "NT" || partnership.length === 3 && auction.some((entry, index) => index > opening.index && index < partnership[1].index && entry.seat === partnerOf(seat) && classifyDoubleAt(auction, index, system) === "negative")))
    return { forcing: "one-round", convention: "responder-second-suit", mustBid: true, currentContractArtificial: false };
  if (system === "sayc" && naturalOpening && partnership.length === 4 && opening.seat === seat && opening.call.level === 1 && opening.call.strain !== "NT" && response.call.level === 1 && response.call.strain !== "NT" && partnership[2].call.strain === opening.call.strain && partnership[3].seat === response.seat && partnership[3].call.strain !== "NT" && !partnership.slice(0, 3).some((entry) => entry.call.strain === partnership[3].call.strain) && !passedBefore(auction, response.seat, opening.index) && !all.some((entry) => sideOf(entry.seat) !== sideOf(seat) && entry.call.strain === partnership[3].call.strain) && !auction.slice(partnership[3].index + 1).some((entry) => sideOf(entry.seat) !== sideOf(seat) && entry.call.kind === "bid"))
    return { forcing: "one-round", convention: "responder-second-suit", mustBid: true, currentContractArtificial: false };
  if (naturalOpening && partnerMadeLastPartnershipBid && system !== "sayc" && newMinor(partnership)) return { forcing: "one-round", convention: "new-minor", mustBid: true, currentContractArtificial: true };
  if (naturalOpening && partnerMadeLastPartnershipBid && responderTrialBid(partnership)) return { forcing: "one-round", convention: "trial-bid", mustBid: true, currentContractArtificial: true };
  if (partnerMadeLastPartnershipBid && partnership.at(-1)?.call.level === 5 && partnership.at(-1)?.call.strain === "NT" && partnership.some((entry) => entry.call.level === 4 && entry.call.strain === "NT" && isArtificialBidAt(auction, entry.index, system)))
    return { forcing: "one-round", convention: "king-ask", mustBid: true, currentContractArtificial: true };
  if (partnerMadeLastPartnershipBid && artificialAnswer(partnership, system, auction)) return { forcing: "one-round", convention: "artificial-answer", mustBid: true, currentContractArtificial: true };
  return { forcing: "none", convention: "none", mustBid: false, currentContractArtificial: false };
}
function naturalSuitMinimum(auction, seat, suit, system) {
  const all = bids(auction), side = all.filter((entry) => sideOf(entry.seat) === sideOf(seat));
  const opening = side[0], response = side[1];
  const rebid = side[2], beforeRebid = rebid && all.findLast((entry) => entry.index < rebid.index);
  const strongJumpShift = opening?.call.level === 1 && response?.call.level === 1 && rebid?.seat === opening.seat && rebid.call.strain !== "NT" && rebid.call.strain !== opening.call.strain && rebid.call.strain !== response.call.strain && beforeRebid && bidValue(rebid.call) - bidValue(beforeRebid.call) > 5;
  let minimum = strongJumpShift && opening.seat === seat && opening.call.strain === suit && !major(suit) ? 4 : 0;
  for (const entry of side.filter((entry2) => entry2.seat === seat)) {
    const before = side.filter((previous2) => previous2.index < entry.index);
    const previous = before.at(-1);
    const ownPrior = before.filter((previous2) => previous2.seat === seat);
    const enemyOpening = all[0];
    const directTwoSuiter = system === "sayc" && enemyOpening?.call.level === 1 && sideOf(enemyOpening.seat) !== sideOf(seat) && entry.index === enemyOpening.index + 1 && entry.call.level === 2;
    if (directTwoSuiter && enemyOpening.call.strain !== "NT" && entry.call.strain === enemyOpening.call.strain) {
      const shown = major(enemyOpening.call.strain) ? [enemyOpening.call.strain === "H" ? "S" : "H"] : ["H", "S"];
      if (shown.includes(suit)) minimum = Math.max(minimum, 5);
    }
    if (directTwoSuiter && entry.call.strain === "NT") {
      const shown = enemyOpening.call.strain === "NT" ? ["C", "D"] : ["C", "D", "H", "S"].filter((candidate) => candidate !== enemyOpening.call.strain).slice(0, 2);
      if (shown.includes(suit)) minimum = Math.max(minimum, 5);
    }
    const nt = previous?.call.strain === "NT" && noTrumpRangeAt(auction, previous.index, system);
    const ntPlatform = before.length === 1 || before.length === 3 && before[0].call.strain === "C" && (before[0].call.level === 2 || system === "precision" && before[0].call.level === 1);
    if (nt && ntPlatform && entry.call.level === previous.call.level + 1) {
      const transferred = entry.call.strain === "D" ? "H" : entry.call.strain === "H" ? "S" : void 0;
      if (transferred === suit) minimum = Math.max(minimum, 5);
    }
    const staymanPlatform = before.at(-3), staymanRequest = before.at(-2), staymanAnswer = before.at(-1);
    if (staymanPlatform?.call.strain === "NT" && staymanRequest?.seat === seat && staymanRequest.call.strain === "C" && staymanRequest.call.level === staymanPlatform.call.level + 1 && staymanAnswer?.call.level === staymanRequest.call.level && major(staymanAnswer.call.strain) && major(entry.call.strain) && entry.call.strain !== staymanAnswer.call.strain && entry.call.level === staymanAnswer.call.level && noTrumpRangeAt(auction, staymanPlatform.index, system)) {
      if (suit === entry.call.strain || suit === staymanAnswer.call.strain) minimum = Math.max(minimum, 4);
      if (entry.call.strain === suit) continue;
    }
    if (entry.call.strain !== suit || isArtificialBidAt(auction, entry.index, system)) continue;
    const inquiry = before.at(-2), platform = before.at(-3);
    if (previous?.call.strain === "C" && inquiry?.call.strain === "NT" && previous.call.level === inquiry.call.level + 1 && entry.call.level === previous.call.level && major(suit) && noTrumpRangeAt(auction, inquiry.index, system)) {
      minimum = Math.max(minimum, 4);
      continue;
    }
    if (previous && platform === void 0 && inquiry?.call.strain === "NT" && previous.call.level === inquiry.call.level + 1 && (previous.call.strain === "D" && suit === "H" || previous.call.strain === "H" && suit === "S")) {
      minimum = Math.max(minimum, 2);
      continue;
    }
    if (previous && inquiry?.call.strain === "NT" && noTrumpRangeAt(auction, inquiry.index, system) && previous.call.level === inquiry.call.level + 1 && (previous.call.strain === "D" && suit === "H" || previous.call.strain === "H" && suit === "S")) {
      minimum = Math.max(minimum, 2);
      continue;
    }
    if (all[0]?.index === entry.index) {
      minimum = Math.max(minimum, entry.call.level === 1 ? major(suit) ? 5 : 3 : entry.call.level === 2 ? 6 : entry.call.level === 3 ? 7 : 8);
      continue;
    }
    const repeated = ownPrior.some((prior) => prior.call.strain === suit && !isArtificialBidAt(auction, prior.index, system));
    const original = ownPrior.find((prior) => prior.call.strain !== "NT" && !isArtificialBidAt(auction, prior.index, system));
    if (repeated) {
      if (original?.call.strain === suit) {
        if ((system === "sayc" || system === "two-over-one") && opening?.seat === seat && opening.call.level === 2 && opening.call.strain === "C" && !major(suit)) {
          minimum = Math.max(minimum, 4);
          continue;
        }
        if (ownPrior.some((prior) => prior.call.strain === "NT" && noTrumpRangeAt(auction, prior.index, system))) {
          minimum = Math.max(minimum, 3);
          continue;
        }
        const otherSuit = ownPrior.some((prior) => prior.call.strain !== "NT" && prior.call.strain !== suit && !isArtificialBidAt(auction, prior.index, system));
        const gameForce = opening && response && isTwoOverOne(opening, response, auction);
        const lastBefore = all.findLast((prior) => prior.index < entry.index);
        const jumpMinor = !major(suit) && lastBefore && bidValue(entry.call) - bidValue(lastBefore.call) > 5;
        const nonJump = lastBefore && bidValue(entry.call) - bidValue(lastBefore.call) <= 5;
        const originalIsOvercall = all[0] && sideOf(all[0].seat) !== sideOf(seat);
        const competitiveRepeat = all.some((prior) => prior.index > original.index && prior.index < entry.index && sideOf(prior.seat) !== sideOf(seat) && !isArtificialBidAt(auction, prior.index, system));
        const raisedFit = before.some((prior) => prior.seat === partnerOf(seat) && prior.call.strain === suit && !isArtificialBidAt(auction, prior.index, system));
        minimum = Math.max(minimum, otherSuit && strongJumpShift && !major(suit) ? 4 : otherSuit || gameForce || major(suit) && nonJump && (originalIsOvercall || competitiveRepeat || raisedFit) ? 5 : major(suit) || jumpMinor ? 6 : 5);
      }
      continue;
    }
    if (opening && opening.seat === partnerOf(seat) && opening.index !== all[0]?.index && isArtificialBidAt(auction, opening.index, system) && naturalSuitMinimum(auction.slice(0, entry.index), partnerOf(seat), suit, system) >= 5) {
      minimum = Math.max(minimum, 3);
      continue;
    }
    const partnerSuit = before.findLast((prior) => prior.seat === partnerOf(seat) && prior.call.strain === suit && !isArtificialBidAt(auction, prior.index, system));
    if (partnerSuit) {
      const previousBid = all.findLast((prior) => prior.index < entry.index);
      const openerRaise = opening?.seat === seat && partnerSuit.index === response?.index && ownPrior.length === 1;
      const preference = !openerRaise && ownPrior.length > 0 && previousBid && (partnerSuit.call.strain === opening?.call.strain || !major(suit)) && bidValue(entry.call) - bidValue(previousBid.call) <= 5;
      minimum = Math.max(minimum, preference ? 2 : major(suit) ? openerRaise ? 4 : 3 : ownPrior.length === 0 && opening?.index === partnerSuit.index ? 5 : 4);
      if (major(suit) && opening?.call.strain !== suit && !openerRaise && opening?.seat !== seat) minimum = Math.max(minimum, 4);
      continue;
    }
    const ownDouble = auction.findLastIndex((prior, index) => index < entry.index && prior.seat === seat && isTakeoutDoubleAt(auction, index));
    if (ownDouble >= 0 && ownPrior.length === 0) {
      const advance = before.find((prior) => prior.index > ownDouble && prior.seat === partnerOf(seat));
      if (advance && isArtificialBidAt(auction, advance.index, system)) {
        minimum = Math.max(minimum, 3);
        continue;
      }
      const lastBeforeAdvance = advance && all.findLast((prior) => prior.index < advance.index);
      const minimumAdvance = advance && lastBeforeAdvance && bidValue(advance.call) - bidValue(lastBeforeAdvance.call) <= 5;
      minimum = Math.max(minimum, minimumAdvance ? 5 : 4);
      continue;
    }
    const takeout = auction.findLastIndex((prior, index) => index < entry.index && prior.seat === partnerOf(seat) && isTakeoutDoubleAt(auction, index));
    const lastBid = all.findLast((prior) => prior.index < entry.index);
    if (takeout >= 0 && ownPrior.length === 0) {
      const jump = lastBid && bidValue(entry.call) - bidValue(lastBid.call) > 5;
      const enemySuits = new Set(all.filter((prior) => prior.index < takeout && sideOf(prior.seat) !== sideOf(seat) && prior.call.strain !== "NT" && !isArtificialBidAt(auction, prior.index, system)).map((prior) => prior.call.strain));
      minimum = Math.max(minimum, jump || enemySuits.size > 1 ? 4 : 3);
      continue;
    }
    if (system === "precision" && opening?.call.level === 1 && opening.call.strain === "C" && response?.index === entry.index && major(suit)) {
      minimum = Math.max(minimum, 5);
      continue;
    }
    if (opening?.index === all[0]?.index && opening.call.level === 1 && (opening.call.strain === "C" || opening.call.strain === "D") && response?.index === entry.index && suit === "S" && entry.call.level === 1 && all.some((prior) => prior.index > opening.index && prior.index < entry.index && sideOf(prior.seat) !== sideOf(seat) && prior.call.strain === "H" && !isArtificialBidAt(auction, prior.index, system))) {
      minimum = Math.max(minimum, 5);
      continue;
    }
    if ((system === "sayc" || system === "two-over-one") && opening?.seat === seat && opening.call.level === 2 && opening.call.strain === "C" && !major(suit) && !ownPrior.some((prior) => !isArtificialBidAt(auction, prior.index, system))) {
      minimum = Math.max(minimum, 4);
      continue;
    }
    minimum = Math.max(minimum, ownPrior.some((prior) => !isArtificialBidAt(auction, prior.index, system)) || opening?.seat !== seat && opening?.index === all[0]?.index && entry.call.level === 1 ? 4 : 5);
  }
  return minimum;
}

// src/ai/suit-evaluation.ts
var highCardPoints = (hand) => hand.reduce((sum, card) => sum + Math.max(0, card.rank - 10), 0);
function evaluateSuitFit(hand, trump, partnerTrumpMinimum) {
  const trumpLength = hand.filter((card) => card.suit === trump).length;
  const knownCombinedTrumps = trumpLength + Math.max(0, partnerTrumpMinimum);
  const hcp = highCardPoints(hand);
  if (knownCombinedTrumps < 8) return { hcp, shortnessPoints: 0, extraTrumpPoints: 0, adjustmentPoints: 0, totalPoints: hcp, knownCombinedTrumps };
  const shortnessPoints = ["C", "D", "H", "S"].filter((suit) => suit !== trump).reduce((sum, suit) => {
    const length = hand.filter((card) => card.suit === suit).length;
    if (length === 0) return sum + 4;
    if (length === 1) return sum + (trumpLength >= 4 ? 3 : 2);
    if (length === 2) return sum + 1;
    return sum;
  }, 0);
  const extraTrumpPoints = Math.max(0, knownCombinedTrumps - 8);
  const adjustmentPoints = shortnessPoints + extraTrumpPoints;
  return { hcp, shortnessPoints, extraTrumpPoints, adjustmentPoints, totalPoints: hcp + adjustmentPoints, knownCombinedTrumps };
}
function countKeycards(hand, trump) {
  return hand.filter((card) => card.rank === 14 || card.suit === trump && card.rank === 13).length;
}
var hasTrumpQueen = (hand, trump) => hand.some((card) => card.suit === trump && card.rank === 12);
function rkcb1430Response(keycards, trumpQueen) {
  if (keycards === 1 || keycards === 4) return { kind: "bid", level: 5, strain: "C" };
  if (keycards === 0 || keycards === 3) return { kind: "bid", level: 5, strain: "D" };
  return { kind: "bid", level: 5, strain: trumpQueen ? "S" : "H" };
}

// src/ai/competition.ts
var bid2 = (level, strain) => ({ kind: "bid", level, strain });
var major2 = (suit) => suit === "H" || suit === "S";
function chooseCompetitiveCall(obs, system) {
  const { hcp, lengths, balanced } = evaluateHand(obs.hand);
  const available = (call) => obs.legalCalls.some((legal) => sameCall(legal, call));
  const cheapest = (strain) => {
    for (let level = 1; level <= 7; level++) if (available(bid2(level, strain))) return bid2(level, strain);
  };
  const jump = (strain) => {
    const low = cheapest(strain);
    return low && low.level < 7 && available(bid2(low.level + 1, strain)) ? bid2(low.level + 1, strain) : void 0;
  };
  const stopper = (suit) => obs.hand.some((card) => card.suit === suit && (card.rank === 14 || card.rank === 13 && lengths[suit] >= 2 || card.rank === 12 && lengths[suit] >= 3));
  const reasonablePreemptSuit = (suit) => {
    const ranks = obs.hand.filter((card) => card.suit === suit).map((card) => card.rank);
    return ranks.length >= 7 || ranks.filter((rank) => rank >= 10).length >= 2 && ranks.some((rank) => rank >= 12);
  };
  const reasonableOvercallSuit = (suit, level) => {
    const ranks = obs.hand.filter((card) => card.suit === suit).map((card) => card.rank);
    if (level === 1) return ranks.some((rank) => rank >= 12) || ranks.length >= 6;
    return ranks.filter((rank) => rank >= 10).length >= 2 && ranks.some((rank) => rank >= 12) || ranks.length >= 6 && ranks.some((rank) => rank >= 13);
  };
  const strongTakeoutShape = (opened) => hcp >= 17 && (SUITS.some((suit) => suit !== opened && lengths[suit] >= 5) || hcp >= 18 && balanced && stopper(opened));
  const quickTricks = () => SUITS.reduce((total, suit) => {
    const ranks = obs.hand.filter((card) => card.suit === suit).map((card) => card.rank);
    const ace = ranks.includes(14);
    const king = ranks.includes(13);
    const queen = ranks.includes(12);
    if (ace && king) return total + 2;
    if (ace && queen) return total + 1.5;
    if (ace) return total + 1;
    if (king && queen) return total + 1;
    if (king && ranks.length >= 2) return total + 0.5;
    return total;
  }, 0);
  const longest = (suits) => [...suits].sort((a, b) => lengths[b] - lengths[a] || SUITS.indexOf(b) - SUITS.indexOf(a))[0];
  const firstBid = obs.auction.findIndex((entry) => entry.call.kind === "bid");
  const raw = firstBid < 0 ? obs.auction : obs.auction.slice(firstBid);
  const semantics = system === "sayc" ? analyzeAuctionSemantics(obs.auction, obs.seat, system) : void 0;
  const meaning = semantics?.convention ?? "none";
  const firstNatural = raw.find((entry) => entry.call.kind === "bid");
  const enemyNaturalSuits = new Set(obs.auction.flatMap((entry, index) => sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.kind === "bid" && entry.call.strain !== "NT" && !isArtificialBidAt(obs.auction, index, system) ? [entry.call.strain] : []));
  const current = obs.auction.findLast((entry) => entry.call.kind === "bid");
  if (!semantics?.mustBid && current?.call.kind === "bid" && current.call.strain !== "NT" && current.call.level <= 2 && sideOf(current.seat) !== sideOf(obs.seat) && lengths[current.call.strain] <= 1 && hcp >= 18 && firstNatural?.seat === obs.seat && firstNatural.call.kind === "bid") {
    const ownNatural = obs.auction.filter((entry, index) => entry.seat === obs.seat && entry.call.kind === "bid" && entry.call.strain !== "NT" && !isArtificialBidAt(obs.auction, index, system));
    const second = ownNatural.at(-1);
    const originalSuit = firstNatural.call.strain;
    if (ownNatural.length >= 2 && second?.call.kind === "bid" && second.call.strain !== "NT" && second.call.strain !== originalSuit && lengths[second.call.strain] >= 5 && reasonableOvercallSuit(second.call.strain, 3)) {
      const repeat = cheapest(second.call.strain);
      if (repeat && repeat.level <= 3) return repeat;
    }
  }
  if (current?.call.kind === "bid" && sideOf(current.seat) !== sideOf(obs.seat) && isArtificialBidAt(obs.auction, obs.auction.indexOf(current), system) && !semantics?.mustBid) {
    const role = classifyDoubleAt([...obs.auction, { seat: obs.seat, call: { kind: "double" } }], obs.auction.length, system);
    if (role === "two-suit-strength" && firstNatural?.call.kind === "bid" && firstNatural.call.level === 1 && firstNatural.call.strain === "NT" && hcp >= 10) {
      const naturalMajor = longest(["H", "S"].filter((suit) => lengths[suit] >= 5));
      if (naturalMajor && available(bid2(3, naturalMajor))) return bid2(3, naturalMajor);
    }
    if (role !== "two-suit-strength") {
      if (current.call.strain !== "NT" && available({ kind: "double" })) {
        const leadSuit = current.call.strain;
        const ranks = obs.hand.filter((card) => card.suit === leadSuit).map((card) => card.rank);
        const leadHolding = ranks.length >= 4 && ranks.filter((rank) => rank >= 11).length >= 2 && ranks.some((rank) => rank >= 12) || ranks.length >= 3 && [14, 13].every((rank) => ranks.includes(rank));
        if (leadHolding && hcp >= 8) return { kind: "double" };
      }
      return PASS;
    }
  }
  if (meaning === "weak-jump-inquiry" && raw[1]?.call.kind === "bid" && raw[1].call.strain !== "NT") {
    const trump = raw[1].call.strain;
    if (obs.seat === raw[1].seat) {
      const feature = hcp >= 9 ? SUITS.find((suit) => suit !== trump && obs.hand.some((card) => card.suit === suit && card.rank >= 13)) : void 0;
      return feature ? cheapest(feature) : cheapest(trump);
    }
    const answer = raw.filter((entry) => sideOf(entry.seat) === sideOf(obs.seat) && entry.call.kind === "bid").at(-1);
    const minimum = answer.call.kind === "bid" && answer.call.strain !== trump ? 9 : 5;
    if (lengths[trump] >= 2 && evaluateSuitFit(obs.hand, trump, 6).totalPoints + minimum >= (major2(trump) ? 25 : 29))
      return bid2(major2(trump) ? 4 : 5, trump);
    const enemy = firstNatural?.call.kind === "bid" ? firstNatural.call.strain : "NT";
    if (balanced && enemy !== "NT" && stopper(enemy) && hcp + minimum >= 25 && available(bid2(3, "NT")))
      return bid2(3, "NT");
    return answer.call.kind === "bid" && answer.call.strain === trump ? PASS : cheapest(trump);
  }
  if (meaning === "unusual-advance" && firstNatural?.call.kind === "bid") {
    const opened = firstNatural.call.strain;
    const shown = SUITS.filter((suit) => suit !== opened).slice(0, 2);
    return cheapest(lengths[shown[1]] > lengths[shown[0]] ? shown[1] : shown[0]);
  }
  const ourFirst = obs.auction.find((entry) => sideOf(entry.seat) === sideOf(obs.seat) && entry.call.kind === "bid");
  if (firstNatural?.call.kind === "bid" && firstNatural.call.level === 1 && firstNatural.call.strain !== "NT" && !semantics?.mustBid && ourFirst?.call.kind === "bid" && ourFirst.seat === partnerOf(obs.seat) && ourFirst.call.level === 2 && ourFirst.call.strain === firstNatural.call.strain && isArtificialBidAt(obs.auction, obs.auction.indexOf(ourFirst), system) && !obs.auction.some((entry) => entry.seat === obs.seat && entry.call.kind === "bid")) {
    const shown = major2(firstNatural.call.strain) ? [firstNatural.call.strain === "H" ? "S" : "H"] : ["H", "S"];
    const preferred = longest(shown);
    const response = cheapest(preferred);
    if (lengths[preferred] >= 3 && response) {
      const points = evaluateSuitFit(obs.hand, preferred, 5).totalPoints + 6;
      return response.level <= 3 || points >= 25 ? response : PASS;
    }
    const minor = longest(["C", "D"].filter((suit) => lengths[suit] >= 5));
    if (minor) {
      const response2 = cheapest(minor);
      return response2 && response2.level <= 3 ? response2 : PASS;
    }
    return PASS;
  }
  if (firstNatural?.call.kind === "bid" && sideOf(firstNatural.seat) !== sideOf(obs.seat) && ourFirst?.call.kind === "bid" && ourFirst.call.strain !== "NT" && !obs.auction.some((entry, index) => index < obs.auction.indexOf(ourFirst) && sideOf(entry.seat) === sideOf(obs.seat) && entry.call.kind === "double") && !isArtificialBidAt(obs.auction, obs.auction.indexOf(ourFirst), system)) {
    const ours = obs.auction.filter((entry) => sideOf(entry.seat) === sideOf(obs.seat) && entry.call.kind === "bid");
    const trump = ourFirst.call.strain;
    const previousBid = obs.auction.slice(0, obs.auction.indexOf(ourFirst)).findLast((entry) => entry.call.kind === "bid");
    const weakJump = previousBid?.call.kind === "bid" && bidValue(ourFirst.call) - bidValue(previousBid.call) > 5;
    if (ours.length === 1 && ourFirst.seat === partnerOf(obs.seat) && !weakJump && lengths[trump] >= 3) {
      const points = evaluateSuitFit(obs.hand, trump, 5).totalPoints;
      const between = obs.auction.slice(obs.auction.indexOf(firstNatural) + 1, obs.auction.indexOf(ourFirst));
      const balancing = between.length === 2 && between.every((entry) => entry.call.kind === "pass");
      const overcallMinimum = ourFirst.call.level === 1 ? balancing ? 7 : 8 : firstNatural.call.level >= 2 ? 12 : 10;
      if (points + overcallMinimum >= (major2(trump) ? 25 : 29)) {
        const game = bid2(major2(trump) ? 4 : 5, trump);
        if (available(game)) return game;
      }
      if (hcp >= 10 && firstNatural.call.strain !== "NT") {
        const cue = cheapest(firstNatural.call.strain);
        if (cue) return cue;
      }
      if (points >= 10 && major2(trump) && ourFirst.call.level === 1 && available(bid2(3, trump))) return bid2(3, trump);
      const raise = bid2(ourFirst.call.level + 1, trump);
      if (points >= 6 && available(raise)) return raise;
    }
    const latestPartner = ours.at(-1);
    if (latestPartner?.seat === partnerOf(obs.seat) && latestPartner.call.kind === "bid" && !semantics?.mustBid && !isArtificialBidAt(obs.auction, obs.auction.indexOf(latestPartner), system) && latestPartner.call.strain !== "NT" && latestPartner.call.level <= 3 && lengths[latestPartner.call.strain] <= 1) {
      if (ourFirst.seat === obs.seat && lengths[trump] >= 6) return cheapest(trump);
      const escape = longest(SUITS.filter((suit) => lengths[suit] >= 5 && !enemyNaturalSuits.has(suit)));
      if (escape && hcp >= 8) return cheapest(escape);
    }
  }
  const ntPosition = raw[3]?.call.kind === "bid" && raw[3].call.strain === "NT" && raw[1]?.call.kind === "pass" && raw[2]?.call.kind === "pass" ? 3 : 1;
  const ntOvercall = raw[ntPosition];
  if (raw[0]?.call.kind === "bid" && raw[0].call.strain !== "NT" && ntOvercall?.call.kind === "bid" && ntOvercall.call.level <= 2 && ntOvercall.call.strain === "NT" && (raw[0].call.level >= 2 || ntOvercall.call.level === 1)) {
    const base = ntOvercall.call.level + 1;
    const ourNtSide = sideOf(ntOvercall.seat) === sideOf(obs.seat);
    const sideBids = raw.filter((entry) => sideOf(entry.seat) === sideOf(obs.seat) && entry.call.kind === "bid");
    const request = sideBids[1]?.call;
    if (ourNtSide && obs.seat === partnerOf(ntOvercall.seat) && sideBids.length === 1 && raw.length === ntPosition + 2 && raw[ntPosition + 1].call.kind === "pass") {
      const m = longest(["H", "S"].filter((suit) => lengths[suit] >= 5));
      if (m) return bid2(base, m === "H" ? "D" : "H");
      const minimum = ntPosition === 3 && base === 2 ? 11 : 15;
      const game = 25 - minimum, invitation = ntPosition === 3 ? 11 : 23 - minimum;
      if (hcp >= invitation && (lengths.H >= 4 || lengths.S >= 4)) return bid2(base, "C");
      if (hcp >= game) return bid2(3, "NT");
      if (base === 2 && hcp >= invitation) return bid2(2, "NT");
      if (base === 2 && Math.max(lengths.C, lengths.D) >= 6) return bid2(2, "S");
      return PASS;
    }
    if (ourNtSide && obs.seat === ntOvercall.seat && sideBids.length === 2 && request?.kind === "bid") {
      if (request.level === base && request.strain === "C") return cheapest(lengths.H >= 4 ? "H" : lengths.S >= 4 ? "S" : "D");
      if (request.level === base && request.strain === "D") return cheapest("H");
      if (request.level === base && request.strain === "H") return cheapest("S");
      if (base === 2 && request.level === 2 && request.strain === "S") return cheapest("C");
      if (request.level === 2 && request.strain === "NT") return hcp >= (ntPosition === 3 ? 14 : 17) ? bid2(3, "NT") : PASS;
    }
    if (ourNtSide && obs.seat === partnerOf(ntOvercall.seat) && sideBids.length === 3 && request?.kind === "bid") {
      if (request.level === 2 && request.strain === "S") return lengths.D > lengths.C ? cheapest("D") : PASS;
      if (request.level === base && request.strain === "C") {
        const answer = sideBids[2].call;
        if (answer.strain !== "NT" && major2(answer.strain) && lengths[answer.strain] >= 4)
          return bid2(hcp >= (ntPosition === 3 ? 14 : 10) ? 4 : 3, answer.strain);
        return bid2(hcp >= (ntPosition === 3 ? 14 : 10) ? 3 : 2, "NT");
      }
      if (request.level === base && (request.strain === "D" || request.strain === "H")) {
        const m = request.strain === "D" ? "H" : "S";
        if (hcp >= (ntPosition === 3 ? 14 : 10)) return lengths[m] >= 6 ? bid2(4, m) : bid2(3, "NT");
        if (base === 2 && hcp >= (ntPosition === 3 ? 11 : 8)) return lengths[m] >= 6 ? bid2(3, m) : bid2(2, "NT");
        return PASS;
      }
    }
    if (ourNtSide && obs.seat === ntOvercall.seat && sideBids.length === 4 && request?.kind === "bid" && (request.strain === "D" || request.strain === "H")) {
      const continuation = sideBids[3].call;
      const m = request.strain === "D" ? "H" : "S";
      if (continuation.strain === "NT" && continuation.level === 3 && lengths[m] >= 3) return bid2(4, m);
      if (continuation.level < 3 && hcp >= (ntPosition === 3 ? 14 : 17)) return lengths[m] >= 3 ? bid2(4, m) : bid2(3, "NT");
      return PASS;
    }
  }
  if (firstNatural?.call.kind === "bid" && firstNatural.call.strain !== "NT") {
    const opened = firstNatural.call.strain;
    if (meaning === "takeout-response") {
      const doubleIndex = obs.auction.findLastIndex((entry, index) => entry.seat === partnerOf(obs.seat) && isTakeoutDoubleAt(obs.auction, index));
      const enemyBefore = obs.auction.slice(0, doubleIndex).filter((entry, index) => entry.call.kind === "bid" && sideOf(entry.seat) !== sideOf(obs.seat) && !isArtificialBidAt(obs.auction, index, system));
      const twoSuitOpening = enemyBefore.length === 3 && enemyBefore[0].seat === enemyBefore[2].seat && enemyBefore[0].call.kind === "bid" && enemyBefore[2].call.kind === "bid" && enemyBefore[0].call.level === 1 && enemyBefore[2].call.level === 2;
      const excluded = twoSuitOpening ? new Set([enemyBefore[0].call, enemyBefore[2].call].flatMap((call) => call.kind === "bid" && call.strain !== "NT" ? [call.strain] : [])) : enemyNaturalSuits;
      const unbid = SUITS.filter((suit2) => !excluded.has(suit2));
      const preferred = longest(unbid.filter((suit2) => major2(suit2) && lengths[suit2] >= 4));
      if (firstNatural.call.level === 3 && hcp < 19 && preferred && lengths[preferred] >= 4 && major2(preferred) && available(bid2(4, preferred))) return bid2(4, preferred);
      if (hcp >= 12) return cheapest(opened);
      if (balanced && stopper(opened)) {
        if (hcp >= 13 && available(bid2(3, "NT"))) return bid2(3, "NT");
        if (hcp >= 11 && available(bid2(2, "NT"))) return bid2(2, "NT");
        if (hcp >= 6 && available(bid2(1, "NT"))) return bid2(1, "NT");
      }
      const suit = longest(unbid);
      const low = cheapest(suit);
      return low && hcp >= 9 && lengths[suit] >= 4 && low.level <= 3 && low.level < (major2(suit) ? 4 : 5) && available(bid2(low.level + 1, suit)) ? bid2(low.level + 1, suit) : low;
    }
    if (meaning === "negative-double") {
      if (hcp >= 16 && lengths[opened] >= 6) {
        const rebid = bid2(3, opened);
        if (available(rebid)) return rebid;
      }
      const enemyOvercall = raw[1]?.call;
      if (enemyOvercall?.kind === "bid") {
        const shown = longest(["H", "S"].filter((suit) => suit !== opened && suit !== enemyOvercall.strain && lengths[suit] >= 4));
        if (shown) {
          const points = evaluateSuitFit(obs.hand, shown, 4).totalPoints + (enemyOvercall.level === 1 ? 6 : 8);
          if (points >= 25 && available(bid2(4, shown))) return bid2(4, shown);
          if (points >= 23 && available(bid2(3, shown))) return bid2(3, shown);
          return cheapest(shown);
        }
        if ((balanced || hcp >= 18) && stopper(enemyOvercall.strain)) {
          if (hcp >= 19 && available(bid2(3, "NT"))) return bid2(3, "NT");
          if (hcp >= 18 && available(bid2(2, "NT"))) return bid2(2, "NT");
          if (hcp >= 12) {
            const nt = cheapest("NT");
            if (nt && nt.level <= 2) return nt;
          }
        }
        const side = longest(SUITS.filter((suit) => suit !== opened && suit !== enemyOvercall.strain && lengths[suit] >= 4));
        if (side && (lengths[opened] < 5 || hcp >= 17)) return cheapest(side);
      }
      return cheapest(opened);
    }
    if (meaning === "michaels-inquiry") return cheapest(lengths.D > lengths.C ? "D" : "C");
    if (meaning === "overcall-stayman") return cheapest(lengths.H >= 4 ? "H" : lengths.S >= 4 ? "S" : "D");
    if (meaning === "overcall-cue") {
      const overcall = raw[1]?.call;
      if (overcall?.kind === "bid" && overcall.strain !== "NT") {
        if (hcp <= 10) return cheapest(overcall.strain);
        const enemySuits = raw.filter((entry) => sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.kind === "bid" && entry.call.strain !== "NT").map((entry) => entry.call.strain);
        if (balanced && enemySuits.every(stopper)) {
          const nt = cheapest("NT");
          if (nt) return nt;
        }
        const side = longest(SUITS.filter((suit) => !enemySuits.includes(suit) && suit !== overcall.strain && lengths[suit] >= 4));
        if (side) return cheapest(side);
        const low = cheapest(overcall.strain);
        if (hcp <= 12) return low;
        return low && low.level < 7 && available(bid2(low.level + 1, overcall.strain)) ? bid2(low.level + 1, overcall.strain) : low;
      }
    }
  }
  if (raw.length === 1 && raw[0].call.kind === "bid" && raw[0].call.level === 1 && raw[0].call.strain !== "NT" && sideOf(raw[0].seat) !== sideOf(obs.seat)) {
    const opened = raw[0].call.strain;
    if (system === "precision" && opened === "C") return void 0;
    const unbid = SUITS.filter((suit) => suit !== opened);
    const twoLowest = [...unbid].sort((a, b) => SUITS.indexOf(a) - SUITS.indexOf(b)).slice(0, 2);
    const otherMajor = opened === "H" ? "S" : opened === "S" ? "H" : void 0;
    if (!major2(opened) && lengths.H >= 5 && lengths.S >= 5 && hcp >= 8 && available(bid2(2, opened))) return bid2(2, opened);
    if (otherMajor && lengths[otherMajor] >= 5 && Math.max(lengths.C, lengths.D) >= 5 && hcp >= 10 && available(bid2(2, opened))) return bid2(2, opened);
    if (hcp >= 5 && twoLowest.every((suit) => lengths[suit] >= 5) && available(bid2(2, "NT"))) return bid2(2, "NT");
    if (balanced && hcp >= 15 && hcp <= 18 && stopper(opened) && available(bid2(1, "NT"))) return bid2(1, "NT");
    const weakJumpSuit = longest(unbid.filter((suit) => reasonablePreemptSuit(suit)));
    if (weakJumpSuit) {
      const call = jump(weakJumpSuit);
      const maximum = call?.level === 2 ? 11 : 10;
      const requiredLength = call ? call.level + 4 : 14;
      if (call && lengths[weakJumpSuit] >= requiredLength && hcp >= 5 && hcp <= maximum) return call;
    }
    const shapeTakeout = lengths[opened] <= 2 && unbid.every((suit) => lengths[suit] >= 3);
    if ((strongTakeoutShape(opened) || hcp >= 12 && shapeTakeout) && available({ kind: "double" })) return { kind: "double" };
    const simple = longest(unbid.filter((suit) => {
      const call = cheapest(suit);
      return lengths[suit] >= 5 && call && hcp >= (call.level === 1 ? 8 : 10) && reasonableOvercallSuit(suit, call.level);
    }));
    if (simple && hcp <= 16) {
      const call = cheapest(simple);
      if (call && hcp >= (call.level === 1 ? 8 : 10) && reasonableOvercallSuit(simple, call.level)) return call;
    }
    return void 0;
  }
  if (raw.length === 1 && raw[0].call.kind === "bid" && raw[0].call.level === 1 && raw[0].call.strain === "NT" && sideOf(raw[0].seat) !== sideOf(obs.seat)) {
    if (hcp >= 15 && quickTricks() >= 3 && available({ kind: "double" })) return { kind: "double" };
    if (hcp >= 5 && lengths.C >= 5 && lengths.D >= 5 && available(bid2(2, "NT"))) return bid2(2, "NT");
    const suit = longest(SUITS.filter((candidate) => lengths[candidate] >= 6));
    if (suit && hcp >= 8) return cheapest(suit);
    return void 0;
  }
  if (raw.length === 3 && raw[0].call.kind === "bid" && raw[0].call.level === 1 && raw[0].call.strain !== "NT" && raw[1].call.kind === "pass" && raw[2].call.kind === "pass" && sideOf(raw[0].seat) !== sideOf(obs.seat)) {
    const opened = raw[0].call.strain;
    const unbid = SUITS.filter((suit2) => suit2 !== opened);
    if (balanced && hcp >= 11 && hcp <= 14 && stopper(opened) && available(bid2(1, "NT"))) return bid2(1, "NT");
    const shapeTakeout = lengths[opened] <= 2 && unbid.every((suit2) => lengths[suit2] >= 3);
    if ((strongTakeoutShape(opened) || hcp >= 9 && shapeTakeout) && available({ kind: "double" })) return { kind: "double" };
    const suit = longest(unbid.filter((candidate) => lengths[candidate] >= 5));
    if (suit && hcp >= 7) return cheapest(suit);
    if (hcp >= 15 && hcp <= 17) return PASS;
    return void 0;
  }
  if (raw.length === 2 && raw[0].call.kind === "bid" && raw[0].call.level === 1 && raw[0].call.strain !== "NT" && sideOf(raw[0].seat) === sideOf(obs.seat) && raw[1].call.kind === "double") {
    const opened = raw[0].call.strain;
    if (hcp >= 10 && available({ kind: "redouble" })) return { kind: "redouble" };
    if (lengths[opened] >= (major2(opened) ? 3 : 5) && evaluateSuitFit(obs.hand, opened, major2(opened) ? 5 : 3).totalPoints >= 6) {
      const raise = cheapest(opened);
      if (raise) return raise;
    }
    const oneLevel = longest(SUITS.filter((candidate) => candidate !== opened && lengths[candidate] >= 4 && cheapest(candidate)?.level === 1));
    if (oneLevel && hcp >= 6) return cheapest(oneLevel);
    const longEscape = longest(SUITS.filter((candidate) => candidate !== opened && (lengths[candidate] >= 6 || lengths[candidate] >= 5 && reasonableOvercallSuit(candidate, 2))));
    if (longEscape && hcp >= 6) return cheapest(longEscape);
    return PASS;
  }
  if (raw.length === 2 && raw[0].call.kind === "bid" && raw[0].call.level === 1 && raw[0].call.strain !== "NT" && sideOf(raw[0].seat) === sideOf(obs.seat) && raw[1].call.kind === "bid" && sideOf(raw[1].seat) !== sideOf(obs.seat)) {
    const opened = raw[0].call.strain;
    const michaels = raw[1].call.level === 2 && raw[1].call.strain === opened;
    const unusual = raw[1].call.level === 2 && raw[1].call.strain === "NT";
    if (michaels || unusual) {
      if (unusual && hcp >= 10) {
        const shown = SUITS.filter((suit) => suit !== opened).slice(0, 2);
        const naturalMajor = longest(["H", "S"].filter((suit) => suit !== opened && !shown.includes(suit) && lengths[suit] >= 5));
        if (naturalMajor) return cheapest(naturalMajor);
      }
      if (hcp >= 10 && available({ kind: "double" })) return { kind: "double" };
      if (hcp >= 6 && lengths[opened] >= (major2(opened) ? 3 : 5)) return cheapest(opened);
      const natural = longest(SUITS.filter((candidate) => candidate !== opened && lengths[candidate] >= 5));
      if (natural && hcp >= 10) return cheapest(natural);
      return PASS;
    }
  }
  if ((raw.length === 1 || raw.length === 3 && raw[1].call.kind === "pass" && raw[2].call.kind === "pass") && raw[0].call.kind === "bid" && raw[0].call.level >= 2 && raw[0].call.level <= 3 && raw[0].call.strain !== "NT" && sideOf(raw[0].seat) !== sideOf(obs.seat)) {
    const openingCall = raw[0].call;
    const opened = openingCall.strain;
    const unbid = SUITS.filter((suit) => suit !== opened);
    if (balanced && hcp >= 15 && hcp <= 18 && stopper(opened)) {
      const nt = cheapest("NT");
      if (nt) return nt;
    }
    const shapeTakeout = lengths[opened] <= 2 && unbid.every((suit) => lengths[suit] >= 3);
    if ((strongTakeoutShape(opened) || hcp >= (openingCall.level === 2 ? 13 : 15) && shapeTakeout) && available({ kind: "double" })) return { kind: "double" };
    const natural = longest(unbid.filter((suit) => {
      const call = cheapest(suit);
      const ranks = obs.hand.filter((card) => card.suit === suit).map((card) => card.rank);
      const exceptionalLength = lengths[suit] >= 8 && hcp >= 7 && ranks.filter((rank) => rank >= 10).length >= 3 && ranks.some((rank) => rank >= 13);
      if (!call || lengths[suit] < (openingCall.level === 2 ? 5 : 6)) return false;
      return exceptionalLength || hcp >= (call.level === 2 ? 12 : 14) && reasonableOvercallSuit(suit, call.level) && (call.level <= 2 || lengths[suit] >= 6 || ranks.filter((rank) => rank >= 12).length >= 2);
    }));
    if (natural) return cheapest(natural);
    return PASS;
  }
  if (raw.length === 2 && raw[0].call.kind === "bid" && raw[1].call.kind === "bid" && raw[0].call.level === 1 && raw[0].call.strain !== "NT" && raw[1].call.strain !== "NT" && sideOf(raw[0].seat) === sideOf(obs.seat) && sideOf(raw[1].seat) !== sideOf(obs.seat) && bidValue(raw[1].call) <= bidValue(bid2(2, "S"))) {
    const opened = raw[0].call.strain;
    const overcalled = raw[1].call.strain;
    const points = raw[1].call.level === 1 ? 6 : 8;
    const unbidMajors = ["H", "S"].filter((suit) => suit !== opened && suit !== overcalled);
    const support = major2(opened) && lengths[opened] >= 3 ? evaluateSuitFit(obs.hand, opened, 5).totalPoints : 0;
    if (support >= 13 && available(bid2(4, opened))) return bid2(4, opened);
    if (support >= 10 && available(bid2(3, opened))) return bid2(3, opened);
    if (support >= 6 && available(bid2(2, opened))) return bid2(2, opened);
    const longMajor = longest(unbidMajors.filter((suit) => lengths[suit] >= 5));
    const naturalMajor = longMajor ? cheapest(longMajor) : void 0;
    if (naturalMajor && naturalMajor.level <= 2 && (hcp >= (naturalMajor.level === 1 ? 6 : 10) || hcp >= 8 && lengths[longMajor] >= 6)) return naturalMajor;
    if (opened !== "H" && opened !== "S" && overcalled === "H" && lengths.S >= 5 && hcp >= points && available(bid2(1, "S"))) return bid2(1, "S");
    if (opened !== "H" && opened !== "S" && overcalled === "S" && lengths.H >= 5 && hcp >= 10 && available(bid2(2, "H"))) return bid2(2, "H");
    if (hcp >= points && unbidMajors.length && unbidMajors.every((suit) => lengths[suit] >= 4) && available({ kind: "double" })) return { kind: "double" };
    if (hcp >= points && !unbidMajors.length) {
      const unbidMinors = ["C", "D"].filter((suit) => suit !== opened && suit !== overcalled);
      if (unbidMinors.length && unbidMinors.every((suit) => lengths[suit] >= 4) && available({ kind: "double" })) return { kind: "double" };
    }
    const freeMajor = longest(unbidMajors.filter((suit) => lengths[suit] >= 4 && hcp >= 6 && cheapest(suit)?.level === 1 && !(overcalled === "H" && !major2(opened) && suit === "S" && lengths.S === 4)));
    if (freeMajor) return cheapest(freeMajor);
    const freeSuit = longest(SUITS.filter((suit) => suit !== opened && suit !== overcalled && lengths[suit] >= 5 && hcp >= 10 && cheapest(suit)?.level === 2));
    if (freeSuit) return cheapest(freeSuit);
    if (balanced && stopper(overcalled) && hcp >= 6) {
      if (hcp >= 13 && available(bid2(3, "NT"))) return bid2(3, "NT");
      if (hcp >= 11 && available(bid2(2, "NT"))) return bid2(2, "NT");
      if (hcp <= 10 && available(bid2(1, "NT"))) return bid2(1, "NT");
    }
  }
  if (raw.length === 2 && raw[0].call.kind === "bid" && raw[1].call.kind === "bid" && raw[0].call.level === 1 && raw[0].call.strain !== "NT" && raw[1].call.level === 3 && raw[1].call.strain !== "NT" && sideOf(raw[0].seat) === sideOf(obs.seat) && sideOf(raw[1].seat) !== sideOf(obs.seat)) {
    const opened = raw[0].call.strain;
    const overcalled = raw[1].call.strain;
    if (hcp >= 12) {
      if (balanced && stopper(overcalled) && available(bid2(3, "NT"))) return bid2(3, "NT");
      const natural = longest(SUITS.filter((suit) => suit !== opened && suit !== overcalled && lengths[suit] >= 5));
      if (natural) {
        const call = cheapest(natural);
        if (call && call.level <= 4) return call;
      }
      if (!major2(opened) && lengths[opened] >= 4 && available(bid2(5, opened))) return bid2(5, opened);
      const cue = cheapest(overcalled);
      if (cue) return cue;
    }
    return void 0;
  }
  if (raw.length === 4 && raw[0].call.kind === "bid" && raw[0].call.level === 1 && raw[0].call.strain !== "NT" && raw[0].seat === obs.seat && raw[1].call.kind === "bid" && sideOf(raw[1].seat) !== sideOf(obs.seat) && raw[2].seat === partnerOf(obs.seat) && raw[2].call.kind === "double" && raw[3].call.kind === "bid" && sideOf(raw[3].seat) !== sideOf(obs.seat)) {
    const opened = raw[0].call.strain;
    const overcalled = raw[1].call.strain;
    const unbidMajors = ["H", "S"].filter((suit) => suit !== opened && suit !== overcalled);
    const shown = longest(unbidMajors.filter((suit) => lengths[suit] >= 4));
    if (shown) {
      const call = cheapest(shown);
      if (call) return call;
    }
    if (hcp >= 16 && stopper(overcalled)) {
      const nt = cheapest("NT");
      if (nt) return nt;
    }
    const fallback = cheapest(opened);
    return fallback ?? PASS;
  }
  if (raw.length === 3 && raw[0].call.kind === "bid" && raw[0].call.strain !== "NT" && raw[1].seat === partnerOf(obs.seat) && raw[1].call.kind === "double" && isTakeoutDoubleAt(obs.auction, firstBid + 1) && raw[2].call.kind !== "pass") {
    const opened = raw[0].call.strain;
    if (hcp >= 12) return cheapest(opened);
    if (hcp < 6) return PASS;
    const enemySuit = raw[2].call.kind === "bid" ? raw[2].call.strain : opened;
    const suit = longest(SUITS.filter((s) => s !== opened && s !== enemySuit && lengths[s] >= 4));
    return suit ? cheapest(suit) : PASS;
  }
  if (raw.length === 3 && raw[0].call.kind === "bid" && raw[0].call.level <= 3 && raw[0].call.strain !== "NT" && sideOf(raw[0].seat) !== sideOf(obs.seat) && raw[1].seat === partnerOf(obs.seat) && raw[1].call.kind === "bid" && raw[1].call.strain !== "NT" && raw[1].call.strain !== raw[0].call.strain && bidValue(raw[1].call) - bidValue(raw[0].call) <= 5 && raw[2].call.kind === "bid") {
    const trump = raw[1].call.strain;
    const minimum = raw[1].call.level === 1 ? 8 : raw[1].call.level === 2 ? 10 : 12;
    const supported = evaluateSuitFit(obs.hand, trump, 5).totalPoints;
    if (lengths[trump] >= 3) {
      const level = major2(trump) ? 4 : 5;
      if (supported + minimum >= (major2(trump) ? 25 : 29) && available(bid2(level, trump))) return bid2(level, trump);
      if (!major2(trump) && supported + minimum >= 25 && available(bid2(4, trump))) return bid2(4, trump);
      if (hcp >= 10 && raw[0].call.level === 1) return cheapest(raw[0].call.strain);
      if (supported >= 6) return cheapest(trump);
    }
  }
  if (raw.length === 3 && raw[0].call.kind === "bid" && raw[0].call.level >= 2 && raw[0].call.level <= 3 && raw[0].call.strain !== "NT" && raw[1].seat === partnerOf(obs.seat) && raw[1].call.kind === "bid" && raw[1].call.strain !== "NT" && raw[1].call.strain !== raw[0].call.strain && raw[2].call.kind === "pass") {
    const trump = raw[1].call.strain;
    if (lengths[trump] >= 3) {
      const points = evaluateSuitFit(obs.hand, trump, 5).totalPoints + (raw[0].call.level === 2 ? 12 : 14);
      if (points >= (major2(trump) ? 25 : 29) && available(bid2(major2(trump) ? 4 : 5, trump)))
        return bid2(major2(trump) ? 4 : 5, trump);
      if (points >= 23 && major2(trump) && available(bid2(3, trump))) return bid2(3, trump);
      if (points >= 25 && !major2(trump) && available(bid2(4, trump))) return bid2(4, trump);
      if (evaluateSuitFit(obs.hand, trump, 5).totalPoints >= 6) return cheapest(trump);
    }
  }
  if (raw.length === 3 && raw[0].call.kind === "bid" && raw[0].call.level === 1 && raw[0].call.strain !== "NT" && (raw[2].call.kind === "pass" || raw[2].call.kind === "double") && sideOf(raw[0].seat) !== sideOf(obs.seat) && raw[1].seat === partnerOf(obs.seat) && sideOf(raw[2].seat) !== sideOf(obs.seat)) {
    const opened = raw[0].call.strain;
    if (raw[1].call.kind === "double") {
      const unbid = SUITS.filter((suit2) => suit2 !== opened);
      const suit = longest(unbid);
      if (hcp >= 12) return cheapest(opened);
      if (balanced && stopper(opened)) {
        if (hcp >= 13 && available(bid2(3, "NT"))) return bid2(3, "NT");
        if (hcp >= 11 && available(bid2(2, "NT"))) return bid2(2, "NT");
        if (hcp >= 6 && available(bid2(1, "NT"))) return bid2(1, "NT");
      }
      const low = cheapest(suit);
      if (low && hcp >= 9 && lengths[suit] >= 4 && low.level < 7 && available(bid2(low.level + 1, suit))) return bid2(low.level + 1, suit);
      return low ?? PASS;
    }
    if (raw[1].call.kind !== "bid") return void 0;
    const intervention = raw[1].call;
    const michaels = intervention.level === 2 && intervention.strain === opened && !(system === "precision" && opened === "C");
    if (michaels) {
      if (!major2(opened)) {
        const fit = lengths.S >= lengths.H ? "S" : "H";
        if (lengths[fit] >= 3 && evaluateSuitFit(obs.hand, fit, 5).totalPoints + 8 >= 25 && available(bid2(4, fit))) return bid2(4, fit);
        return cheapest(fit);
      }
      const other = opened === "H" ? "S" : "H";
      if (lengths[other] >= 3) {
        if (evaluateSuitFit(obs.hand, other, 5).totalPoints + 10 >= 25 && available(bid2(4, other))) return bid2(4, other);
        return cheapest(other);
      }
      return available(bid2(2, "NT")) ? bid2(2, "NT") : cheapest(other);
    }
    if (intervention.level === 2 && intervention.strain === "NT") {
      const shown = SUITS.filter((suit) => suit !== opened).sort((a, b) => SUITS.indexOf(a) - SUITS.indexOf(b)).slice(0, 2);
      return cheapest(lengths[shown[1]] > lengths[shown[0]] ? shown[1] : shown[0]);
    }
    if (raw[2].call.kind === "double") return void 0;
    if (intervention.strain === "NT") {
      if ((lengths.H >= 4 || lengths.S >= 4) && hcp >= 8 && available(bid2(2, "C"))) return bid2(2, "C");
      const natural = longest(SUITS.filter((suit) => lengths[suit] >= 5));
      if (natural && available(bid2(2, natural))) return bid2(2, natural);
      if (hcp >= 10 && available(bid2(3, "NT"))) return bid2(3, "NT");
      if (hcp >= 8 && available(bid2(2, "NT"))) return bid2(2, "NT");
      return PASS;
    }
    const overcalled = intervention.strain;
    const naturalLevel = bidValue(bid2(1, overcalled)) > bidValue(raw[0].call) ? 1 : 2;
    const jumpOvercall = intervention.level > naturalLevel;
    if (jumpOvercall) {
      if (hcp >= 15) {
        const ask = cheapest("NT");
        if (ask) return ask;
      }
      if (lengths[overcalled] >= 3) {
        const raise = cheapest(overcalled);
        if (raise) return raise;
      }
      return void 0;
    }
    if (lengths[overcalled] >= 3) {
      if (hcp >= 10 && available(bid2(2, opened))) return bid2(2, opened);
      const raise = bid2(Math.min(7, intervention.level + 1), overcalled);
      if (evaluateSuitFit(obs.hand, overcalled, 5).totalPoints >= 6 && available(raise)) return raise;
    }
    const newSuit = longest(SUITS.filter((suit) => suit !== opened && suit !== overcalled && lengths[suit] >= 5));
    if (newSuit && hcp >= 8) return cheapest(newSuit);
    if (balanced && stopper(opened) && hcp >= 9) return hcp >= 13 && available(bid2(3, "NT")) ? bid2(3, "NT") : cheapest("NT");
    return void 0;
  }
  if (raw.length === 5 && raw[0].call.kind === "bid" && raw[0].call.level === 1 && raw[0].call.strain !== "NT" && raw[1].seat === obs.seat && raw[1].call.kind === "bid" && raw[1].call.level === 1 && raw[1].call.strain === "NT" && raw[2].call.kind === "pass" && raw[3].seat === partnerOf(obs.seat) && raw[3].call.kind === "bid" && raw[3].call.level === 2 && raw[3].call.strain === "C" && raw[4].call.kind === "pass") {
    if (lengths.H >= 4) return bid2(2, "H");
    if (lengths.S >= 4) return bid2(2, "S");
    return bid2(2, "D");
  }
  if (raw.length === 5 && raw[0].call.kind === "bid" && raw[0].call.level === 1 && raw[0].call.strain !== "NT" && major2(raw[0].call.strain) && raw[1].seat === obs.seat && raw[1].call.kind === "bid" && raw[1].call.level === 2 && raw[1].call.strain === raw[0].call.strain && raw[2].call.kind === "pass" && raw[3].seat === partnerOf(obs.seat) && raw[3].call.kind === "bid" && raw[3].call.level === 2 && raw[3].call.strain === "NT" && raw[4].call.kind === "pass") return cheapest(lengths.D > lengths.C ? "D" : "C");
  if (raw.length === 5 && raw[0].call.kind === "bid" && raw[0].call.level === 1 && raw[0].call.strain !== "NT" && raw[1].seat === obs.seat && raw[1].call.kind === "bid" && raw[1].call.strain !== raw[0].call.strain && raw[1].call.strain !== "NT" && raw[2].call.kind === "pass" && raw[3].seat === partnerOf(obs.seat) && raw[3].call.kind === "bid" && raw[3].call.level === 2 && raw[3].call.strain === raw[0].call.strain && raw[4].call.kind === "pass") {
    const opened = raw[0].call.strain;
    const overcall = raw[1].call;
    const suit = overcall.strain;
    if (hcp <= 10) return cheapest(suit);
    if (balanced && stopper(opened)) {
      const nt = cheapest("NT");
      if (nt) return nt;
    }
    const side = longest(SUITS.filter((candidate) => candidate !== suit && candidate !== opened && lengths[candidate] >= 4));
    if (side) return cheapest(side);
    const low = cheapest(suit);
    const invitational = low && low.level < 7 ? bid2(low.level + 1, suit) : void 0;
    if (hcp <= 12) return low;
    return invitational && available(invitational) ? invitational : low;
  }
  const ownTakeout = firstNatural?.call.kind === "bid" && firstNatural.call.level <= 3 && firstNatural.call.strain !== "NT" ? raw.findIndex((entry, index) => entry.seat === obs.seat && isTakeoutDoubleAt(obs.auction, firstBid + index)) : -1;
  const partnerResponse = ownTakeout >= 0 ? raw.find((entry, index) => index > ownTakeout && entry.seat === partnerOf(obs.seat) && entry.call.kind === "bid") : void 0;
  if (ownTakeout >= 0 && !partnerResponse && hcp < 17) {
    const lastNonpass = raw.findLast((entry) => entry.call.kind !== "pass");
    if (lastNonpass?.call.kind === "redouble" && firstNatural?.call.kind === "bid" && firstNatural.call.strain !== "NT") {
      const opened = firstNatural.call.strain;
      if (lengths[opened] < 4 || quickTricks() < 3) {
        const unbid = SUITS.filter((suit) => suit !== opened && lengths[suit] >= 4);
        const preferred = longest(unbid.filter(major2)) ?? longest(unbid);
        return preferred ? cheapest(preferred) : cheapest(longest(SUITS.filter((suit) => suit !== opened)));
      }
    }
    return PASS;
  }
  if (firstNatural?.call.kind === "bid" && ownTakeout >= 0 && partnerResponse?.call.kind === "bid") {
    const opened = firstNatural.call.strain;
    const response = partnerResponse.call;
    const responseIndex = raw.indexOf(partnerResponse);
    const bidBeforeResponse = raw.slice(0, responseIndex).findLast((entry) => entry.call.kind === "bid").call;
    const naturalResponseLevel = bidBeforeResponse.level + (bidValue(bid2(1, response.strain)) <= bidValue(bid2(1, bidBeforeResponse.strain)) ? 1 : 0);
    const partnerCue = response.strain === opened;
    const partnerWeak = !partnerCue && response.level <= naturalResponseLevel;
    const opponentBidAfterResponse = raw.some((entry, index) => index > responseIndex && sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.kind === "bid");
    const ownBidsAfterDouble = raw.filter((entry, index) => index > ownTakeout && entry.seat === obs.seat && entry.call.kind === "bid");
    if (!opponentBidAfterResponse && ownBidsAfterDouble.length === 0 && !partnerCue && response.level >= (response.strain === "NT" ? 3 : major2(response.strain) ? 4 : 5)) return PASS;
    if (partnerWeak && ownBidsAfterDouble.some((entry) => entry.call.kind === "bid" && entry.call.strain === "NT") && opponentBidAfterResponse) return PASS;
    if (opponentBidAfterResponse && ownBidsAfterDouble.length === 0 && !partnerCue) {
      if (response.strain !== "NT" && major2(response.strain) && hcp >= 17 && lengths[response.strain] >= 5 && available(bid2(3, response.strain))) return bid2(3, response.strain);
      const ownSuit = longest(SUITS.filter((suit) => !enemyNaturalSuits.has(suit) && lengths[suit] >= 5));
      if (hcp >= 17 && ownSuit) return cheapest(ownSuit);
      const opponentSuits = [...new Set(raw.filter((entry) => sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.kind === "bid" && entry.call.strain !== "NT").map((entry) => entry.call.strain))];
      if (!partnerWeak && balanced && hcp >= 18 && hcp <= 20 && opponentSuits.every(stopper)) return cheapest("NT") ?? PASS;
      return PASS;
    }
    if (!opponentBidAfterResponse && ownBidsAfterDouble.length === 0 && !partnerCue) {
      if (response.strain !== "NT" && lengths[response.strain] >= 4) {
        const previous = raw.slice(0, responseIndex).findLast((entry) => entry.call.kind === "bid")?.call;
        const invited = previous?.kind === "bid" && bidValue(response) - bidValue(previous) > 5;
        const supported = evaluateSuitFit(obs.hand, response.strain, invited ? 4 : 3).totalPoints + (invited ? 9 : 0);
        if (invited && supported >= (major2(response.strain) ? 25 : 29) && available(bid2(major2(response.strain) ? 4 : 5, response.strain)))
          return bid2(major2(response.strain) ? 4 : 5, response.strain);
        const gameLevel3 = major2(response.strain) ? 4 : 5;
        const level = Math.min(gameLevel3, hcp >= 22 ? gameLevel3 : hcp >= 19 ? response.level + 2 : hcp >= 16 ? response.level + 1 : response.level);
        if (level > response.level && available(bid2(level, response.strain))) return bid2(level, response.strain);
      }
      if (balanced && stopper(opened) && hcp >= 18) {
        const strongNt = bid2(2, "NT");
        const ntRange = noTrumpRangeAt([...obs.auction, { seat: obs.seat, call: strongNt }], obs.auction.length, system);
        if (hcp >= (ntRange?.min ?? 18) && available(strongNt)) return strongNt;
        const nt = cheapest("NT");
        if (nt) return nt;
      }
      if (response.strain === "NT" && response.level === 2 && hcp >= 14 && available(bid2(3, "NT"))) return bid2(3, "NT");
      const strongSuit = longest(SUITS.filter((suit) => !enemyNaturalSuits.has(suit) && lengths[suit] >= 5));
      if (hcp >= 17 && strongSuit) return cheapest(strongSuit);
    }
  }
  const partnerTakeout = obs.auction.findIndex((entry, index) => entry.seat === partnerOf(obs.seat) && isTakeoutDoubleAt(obs.auction, index));
  const afterPartnerTakeout = partnerTakeout >= 0 ? obs.auction.filter((entry, index) => index > partnerTakeout && sideOf(entry.seat) === sideOf(obs.seat) && entry.call.kind === "bid") : [];
  const ourAdvance = afterPartnerTakeout[0], strongRebid = afterPartnerTakeout[1];
  const beforeAdvance = ourAdvance && obs.auction.slice(0, obs.auction.indexOf(ourAdvance)).findLast((entry) => entry.call.kind === "bid")?.call;
  const minimumAdvance = ourAdvance?.call.kind === "bid" && beforeAdvance?.kind === "bid" && bidValue(ourAdvance.call) - bidValue(beforeAdvance) <= 5;
  if (afterPartnerTakeout.length === 2 && ourAdvance?.seat === obs.seat && ourAdvance.call.kind === "bid" && enemyNaturalSuits.has(ourAdvance.call.strain) && strongRebid?.seat === partnerOf(obs.seat) && strongRebid.call.kind === "bid" && strongRebid.call.strain !== "NT" && !enemyNaturalSuits.has(strongRebid.call.strain) && lengths[strongRebid.call.strain] >= 5 && firstNatural?.call.kind === "bid") {
    const trump = strongRebid.call.strain;
    const minimum = firstNatural.call.level === 1 ? 12 : firstNatural.call.level === 2 ? 13 : 15;
    const points = evaluateSuitFit(obs.hand, trump, 3).totalPoints + minimum;
    if (points >= (major2(trump) ? 25 : 29) && available(bid2(major2(trump) ? 4 : 5, trump)))
      return bid2(major2(trump) ? 4 : 5, trump);
  }
  if (afterPartnerTakeout.length === 2 && minimumAdvance && ourAdvance?.seat === obs.seat && ourAdvance.call.kind === "bid" && ourAdvance.call.strain !== "NT" && !enemyNaturalSuits.has(ourAdvance.call.strain) && strongRebid?.seat === partnerOf(obs.seat) && strongRebid.call.kind === "bid" && strongRebid.call.strain !== "NT" && strongRebid.call.strain !== ourAdvance.call.strain && !enemyNaturalSuits.has(strongRebid.call.strain) && lengths[strongRebid.call.strain] >= 3) {
    const trump = strongRebid.call.strain;
    const points = evaluateSuitFit(obs.hand, trump, 5).totalPoints + 17;
    if (points >= (major2(trump) ? 25 : 29) && available(bid2(major2(trump) ? 4 : 5, trump)))
      return bid2(major2(trump) ? 4 : 5, trump);
    if (points >= 23 && major2(trump) && available(bid2(3, trump))) return bid2(3, trump);
  }
  const directOvercall = raw[1];
  const cueAdvance = raw[3];
  if (firstNatural?.call.kind === "bid" && firstNatural.call.level === 1 && firstNatural.call.strain !== "NT" && directOvercall?.call.kind === "bid" && directOvercall.call.strain !== "NT" && directOvercall.call.strain !== firstNatural.call.strain && cueAdvance?.call.kind === "bid" && cueAdvance.call.strain === firstNatural.call.strain && sideOf(directOvercall.seat) === sideOf(obs.seat)) {
    const sideCalls = raw.filter((entry) => sideOf(entry.seat) === sideOf(obs.seat) && entry.call.kind === "bid");
    if (obs.seat === cueAdvance.seat && sideCalls.length === 3) {
      const rebid = sideCalls[2].call;
      const suit = directOvercall.call.strain;
      const low = bidValue(bid2(1, suit)) > bidValue(firstNatural.call) ? 1 : 2;
      const min = rebid.strain === suit && rebid.level === low + 1 ? low === 1 ? 8 : 10 : 13;
      const supportedPoints = evaluateSuitFit(obs.hand, suit, 5).totalPoints + min;
      if (lengths[suit] >= 3 && supportedPoints >= (major2(suit) ? 25 : 29)) return bid2(major2(suit) ? 4 : 5, suit);
      if (hcp + min >= 25 && stopper(firstNatural.call.strain)) return bid2(3, "NT");
      if (major2(suit) && lengths[suit] >= 3 && supportedPoints >= 23 && available(bid2(3, suit))) return bid2(3, suit);
      if (rebid.strain !== suit && lengths[suit] >= 3) return cheapest(suit);
      return PASS;
    }
    if (obs.seat === directOvercall.seat && sideCalls.length === 4) {
      const advance = sideCalls[3].call;
      if (advance.strain === "NT" && advance.level === 2 && hcp >= 15) return bid2(3, "NT");
      if (advance.strain === directOvercall.call.strain && advance.level === 3 && major2(advance.strain) && hcp >= 15) return bid2(4, advance.strain);
    }
  }
  if (raw.length === 5 && raw[0].call.kind === "bid" && raw[0].call.level === 1 && raw[0].call.strain !== "NT" && raw[1].seat === obs.seat && raw[1].call.kind === "double" && raw[2].call.kind === "pass" && raw[3].seat === partnerOf(obs.seat) && raw[3].call.kind === "bid" && raw[4].call.kind === "pass" && hcp >= 17) {
    const ownSuit = longest(SUITS.filter((suit) => !enemyNaturalSuits.has(suit) && lengths[suit] >= 5));
    if (ownSuit) return cheapest(ownSuit);
  }
  if (firstNatural?.call.kind === "bid" && firstNatural.call.strain !== "NT" && sideOf(firstNatural.seat) !== sideOf(obs.seat) && directOvercall?.call.kind === "bid" && directOvercall.call.strain !== "NT" && directOvercall.call.strain !== firstNatural.call.strain && sideOf(directOvercall.seat) === sideOf(obs.seat) && bidValue(directOvercall.call) - bidValue(firstNatural.call) <= 5) {
    const ours = raw.filter((entry) => sideOf(entry.seat) === sideOf(obs.seat) && entry.call.kind === "bid");
    const partner = ours.findLast((entry) => entry.seat === partnerOf(obs.seat));
    const enemies = new Set(raw.filter((entry) => sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.kind === "bid" && entry.call.strain !== "NT").map((entry) => entry.call.strain));
    if (partner?.call.kind === "bid" && partner.call.strain !== "NT" && ours.at(-1) === partner && !enemies.has(partner.call.strain) && partner.call.level < (major2(partner.call.strain) ? 4 : 5)) {
      const trump = partner.call.strain;
      const raisedOvercall = trump === directOvercall.call.strain && partner.seat !== directOvercall.seat;
      const partnerLength = raisedOvercall ? 3 : 5;
      const partnerMin = partner.seat === directOvercall.seat ? directOvercall.call.level === 1 ? 8 : 10 : cueAdvance?.call.kind === "bid" && cueAdvance.call.strain === firstNatural.call.strain ? 10 : raisedOvercall ? 6 : 8;
      const points = evaluateSuitFit(obs.hand, trump, partnerLength).totalPoints + partnerMin;
      if (lengths[trump] + partnerLength >= 8) {
        const gameLevel3 = major2(trump) ? 4 : 5;
        if (points >= (major2(trump) ? 25 : 29) && available(bid2(gameLevel3, trump))) return bid2(gameLevel3, trump);
        if (points >= 23 && major2(trump) && available(bid2(3, trump))) return bid2(3, trump);
      }
      if (balanced && hcp + partnerMin >= 25 && [...enemies].every(stopper) && available(bid2(3, "NT"))) return bid2(3, "NT");
      if (balanced && hcp + partnerMin >= 23 && [...enemies].every(stopper) && available(bid2(2, "NT"))) return bid2(2, "NT");
    }
  }
  if (firstNatural?.call.kind === "bid" && ownTakeout >= 0) {
    const opened = firstNatural.call.strain;
    const partnerCue = [...raw].reverse().find((entry) => entry.seat === partnerOf(obs.seat) && entry.call.kind === "bid" && entry.call.strain === opened && raw.indexOf(entry) > ownTakeout);
    const lastOwnAction = [...raw].reverse().find((entry) => sideOf(entry.seat) === sideOf(obs.seat) && entry.call.kind !== "pass");
    if (partnerCue?.call.kind === "bid" && lastOwnAction === partnerCue) {
      const shownEnemySuits = [...new Set(raw.filter((entry) => sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.kind === "bid" && entry.call.strain !== "NT").map((entry) => entry.call.strain))];
      if (balanced && hcp >= 18 && hcp <= 20 && shownEnemySuits.every(stopper)) {
        const nt = cheapest("NT");
        if (nt) return nt;
      }
      const opponentSuits = raw.filter((entry) => sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.kind === "bid" && entry.call.strain !== "NT").map((entry) => entry.call.strain);
      const natural = longest(SUITS.filter((suit) => !opponentSuits.includes(suit) && lengths[suit] >= 4));
      if (natural) return cheapest(natural);
      return cheapest(opened) ?? PASS;
    }
  }
  const lastBidEntry = [...obs.auction].reverse().find((entry) => entry.call.kind === "bid");
  if (lastBidEntry?.call.kind === "bid" && sideOf(lastBidEntry.seat) !== sideOf(obs.seat) && available({ kind: "double" }) && lastBidEntry.call.level >= 1) {
    const ourNaturalBids = obs.auction.filter((entry) => sideOf(entry.seat) === sideOf(obs.seat) && entry.call.kind === "bid");
    const opponentBids = obs.auction.filter((entry) => sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.kind === "bid");
    const firstOurBid = ourNaturalBids[0]?.call;
    const targetStrain = lastBidEntry.call.strain;
    const artificialCue = isArtificialBidAt(obs.auction, obs.auction.indexOf(lastBidEntry), system) || firstOurBid?.kind === "bid" && targetStrain !== "NT" && ourNaturalBids.some((entry) => entry.call.kind === "bid" && entry.call.strain === targetStrain && obs.auction.indexOf(entry) < obs.auction.indexOf(lastBidEntry)) && !opponentBids.slice(0, -1).some((entry) => entry.call.kind === "bid" && entry.call.strain === targetStrain);
    const opponentsVulnerable = obs.vulnerability === "Both" || obs.vulnerability === "NS" && sideOf(lastBidEntry.seat) === "NS" || obs.vulnerability === "EW" && sideOf(lastBidEntry.seat) === "EW";
    if (!artificialCue && ourNaturalBids.length >= 1 && opponentBids.length >= 1 && (ourNaturalBids.length >= 2 || obs.auction.indexOf(lastBidEntry) >= (firstNatural ? obs.auction.indexOf(firstNatural) + 3 : 3))) {
      const contract = lastBidEntry.call;
      if (contract.strain === "NT") {
        const threshold = opponentsVulnerable ? 15 : 16;
        if (contract.level >= 3 && hcp >= threshold && quickTricks() >= 3.5) return { kind: "double" };
      } else {
        const trump = contract.strain;
        const trumpRanks = obs.hand.filter((card) => card.suit === trump).map((card) => card.rank);
        const topTrumpHonors = trumpRanks.filter((rank) => rank >= 11).length;
        const hasTopTrump = trumpRanks.some((rank) => rank >= 12);
        const ownStrengthRedouble = obs.auction.some((entry) => sideOf(entry.seat) === sideOf(obs.seat) && entry.call.kind === "redouble");
        const threshold = (contract.level >= 4 ? 15 : ownStrengthRedouble ? 10 : 14) - (opponentsVulnerable ? 1 : 0);
        const requiredQuickTricks = contract.level >= 4 ? 3 : 2.5;
        let topTrumpRun = 0;
        for (let rank = 14; rank >= 2 && trumpRanks.includes(rank); rank--) topTrumpRun++;
        const trumpQuickTricks = trumpRanks.includes(14) ? trumpRanks.includes(13) ? 2 : trumpRanks.includes(12) ? 1.5 : 1 : trumpRanks.includes(13) ? trumpRanks.includes(12) ? 1 : trumpRanks.length >= 2 ? 0.5 : 0 : 0;
        const defensiveTricks = quickTricks() + Math.max(0, topTrumpRun - trumpQuickTricks);
        if (lengths[trump] >= 4 && topTrumpHonors >= 2 && hasTopTrump && hcp >= threshold && defensiveTricks >= requiredQuickTricks) return { kind: "double" };
      }
    }
  }
  return void 0;
}

// src/ai/bidding.ts
var bid3 = (level, strain) => ({ kind: "bid", level, strain });
var major3 = (strain) => strain === "H" || strain === "S";
var gameLevel2 = (strain) => strain === "NT" ? 3 : major3(strain) ? 4 : 5;
var atGame2 = (call) => call.level >= gameLevel2(call.strain);
var entries = (auction) => auction.flatMap((entry, index) => entry.call.kind === "bid" ? [{ seat: entry.seat, call: entry.call, index }] : []);
var intervened2 = (auction, seat, from, to = auction.length) => auction.slice(from + 1, to).some((entry) => sideOf(entry.seat) !== sideOf(seat) && entry.call.kind !== "pass");
var passedBefore2 = (auction, seat, index) => auction.slice(0, index).some((entry) => entry.seat === seat && entry.call.kind === "pass");
function twoOverOne(opening, response, auction) {
  const o = opening.call, r = response.call;
  return o.level === 1 && o.strain !== "NT" && r.level === 2 && r.strain !== "NT" && r.strain !== o.strain && bidValue(r) - bidValue(o) <= 5 && !passedBefore2(auction, response.seat, opening.index) && !intervened2(auction, opening.seat, opening.index, response.index);
}
function secondNegative(us, index, system) {
  if (system === "precision" || index !== 3 || us[0]?.call.level !== 2 || us[0].call.strain !== "C" || us[1]?.call.strain !== "D" || us[1].call.level !== 2 || us[2]?.call.strain === "NT") return false;
  const call = us[index]?.call;
  if (!call || call.level !== 3) return false;
  if (major3(us[2].call.strain)) return call.strain === "C";
  return system === "sayc" && (us[2].call.strain === "C" ? call.strain === "D" : call.strain === "NT");
}
function knownFit(us, lengths, system, seat) {
  const strongClub = us[0]?.call.strain === "C" && (system === "precision" ? us[0].call.level === 1 : us[0].call.level === 2);
  const ntIndex = us.findIndex((entry, index) => entry.call.strain === "NT" && (index === 0 || index === 2 && strongClub));
  if (ntIndex >= 0) {
    const nt = us[ntIndex], request = us[ntIndex + 1], answer = us[ntIndex + 2];
    const base = nt.call.level + 1;
    if (request?.call.level === base && (request.call.strain === "D" || request.call.strain === "H")) {
      const target = request.call.strain === "D" ? "H" : "S";
      return us.slice(ntIndex + 3).some((entry) => entry.call.strain === target && entry.call.level >= 3) ? target : void 0;
    }
    if (request?.call.strain === "C" && request.call.level === base) {
      return answer && major3(answer.call.strain) && lengths[answer.call.strain] >= 4 && (seat !== nt.seat || us.slice(ntIndex + 3).some((entry) => entry.call.strain === answer.call.strain)) ? answer.call.strain : void 0;
    }
    return void 0;
  }
  const relevant = us.filter((entry, index) => entry.call.strain !== "NT" && !secondNegative(us, index, system) && !(strongClub && (index === 0 || index === 1 && entry.call.strain === "D")));
  const jacobyMajor = us[0]?.call.level === 1 && major3(us[0].call.strain) && us[1]?.call.level === 2 && us[1].call.strain === "NT" ? us[0].call.strain : void 0;
  if (jacobyMajor && lengths[jacobyMajor] >= 3) return jacobyMajor;
  const competitiveMinorTry = us[0]?.call.level === 1 && (us[0].call.strain === "C" || us[0].call.strain === "D") && us[1]?.call.level === 3 && us[1].call.strain === "NT" && us[2]?.call.level === 4 && us[2].call.strain === us[0].call.strain ? us[0].call.strain : void 0;
  if (competitiveMinorTry && lengths[competitiveMinorTry] >= 2) return competitiveMinorTry;
  const preemptFit = us[0]?.call.level === 3 && us[0].call.strain !== "NT" && us[1]?.call.level === 3 && us[1].call.strain !== "NT" && us[1].call.strain !== us[0].call.strain && us[2]?.call.level === 4 && us[2].call.strain === us[0].call.strain ? us[0].call.strain : void 0;
  if (preemptFit && lengths[preemptFit] >= 2) return preemptFit;
  return ["S", "H", "D", "C"].find((suit) => lengths[suit] >= 2 && new Set(relevant.filter((e) => e.call.strain === suit).map((e) => e.seat)).size === 2);
}
function declaredTrump(us, system, genuineOpening = true) {
  const opening = us[0];
  if (!opening) return void 0;
  if (opening.call.level === 1 && major3(opening.call.strain) && us[1]?.call.level === 2 && us[1].call.strain === "NT") return opening.call.strain;
  const nt = us.find((entry) => entry.call.strain === "NT" && entry.call.level <= 3);
  const ntIndex = nt ? us.indexOf(nt) : -1;
  const transfer = us[ntIndex + 1];
  const transferSuit = nt && transfer?.call.level === nt.call.level + 1 ? transfer.call.strain === "D" ? "H" : transfer.call.strain === "H" ? "S" : void 0 : void 0;
  if (transferSuit && us.some((entry) => entry.index > transfer.index && entry.call.strain === transferSuit && entry.call.level >= 3)) return transferSuit;
  const staymanAnswer = us[ntIndex + 2];
  if (nt && transfer?.call.strain === "C" && transfer.call.level === nt.call.level + 1 && staymanAnswer && major3(staymanAnswer.call.strain) && us.some((entry) => entry.index > staymanAnswer.index && entry.call.strain === staymanAnswer.call.strain)) return staymanAnswer.call.strain;
  const natural = us.filter((entry, index) => entry.call.strain !== "NT" && !secondNegative(us, index, system) && !(genuineOpening && index === 0 && (opening.call.level === 2 && opening.call.strain === "C" && system !== "precision" || opening.call.level === 1 && opening.call.strain === "C" && system === "precision")) && !(genuineOpening && index === 1 && (opening.call.level === 2 && opening.call.strain === "C" && entry.call.strain === "D" || system === "precision" && opening.call.strain === "C" && entry.call.strain === "D")) && !(nt && entry.index > nt.index && index <= ntIndex + 2));
  const raise = [...natural].reverse().find((entry) => natural.some((before) => before.index < entry.index && before.seat !== entry.seat && before.call.strain === entry.call.strain));
  if (raise && raise.call.strain !== "NT") return raise.call.strain;
  if (opening.call.level === 3 && opening.call.strain !== "NT" && us[2]?.call.strain === opening.call.strain) return opening.call.strain;
  if (opening.call.level === 1 && !major3(opening.call.strain) && opening.call.strain !== "NT" && us[1]?.call.strain === "NT" && us[1].call.level === 3 && us[2]?.call.strain === opening.call.strain && us[2].call.level === 4) return opening.call.strain;
  return void 0;
}
function keycardTrump(us, system, asker, auction) {
  const declared = declaredTrump(us, system, entries(auction)[0]?.index === us[0]?.index);
  if (declared) return declared;
  if (us.some((entry) => entry.call.strain === "NT")) return void 0;
  const partner = [...us].reverse().find((entry) => entry.seat === partnerOf(asker) && entry.call.strain !== "NT");
  if (!partner) return void 0;
  const index = us.indexOf(partner), opening = us[0];
  const strong = opening?.call.strain === "C" && (system === "precision" ? opening.call.level === 1 : opening.call.level === 2);
  if (strong && (index === 0 || index === 1 && partner.call.strain === "D")) return void 0;
  if (secondNegative(us, index, system)) return void 0;
  if (entries(auction).some((entry) => sideOf(entry.seat) !== sideOf(asker) && entry.call.strain === partner.call.strain)) return void 0;
  return partner.call.strain;
}
function chooseBid2(obs, system = "two-over-one") {
  if (system === "natural-lite") return chooseBid(obs);
  const { hcp, lengths, balanced } = evaluateHand(obs.hand);
  const semantics = analyzeAuctionSemantics(obs.auction, obs.seat, system);
  const available = (call) => obs.legalCalls.some((c) => sameCall(c, call));
  const forcedFallback = () => {
    const enemySuits = new Set(all.filter((e) => sideOf(e.seat) !== sideOf(obs.seat) && !all.some((prior) => prior.index < e.index && sideOf(prior.seat) === sideOf(obs.seat) && prior.call.strain === e.call.strain)).map((e) => e.call.strain));
    const partnerSuits = us.filter((e) => e.seat === partnerOf(obs.seat) && e.call.strain !== "NT" && !enemySuits.has(e.call.strain) && !(e.call.level === 2 && e.call.strain === "C" && e === opening && naturalOpening));
    const candidates = obs.legalCalls.filter((c) => c.kind === "bid");
    const score = (c) => c.strain === "NT" ? (balanced && [...enemySuits].every(hasStopper) ? 9 : 0) - c.level * 2 : lengths[c.strain] * 2 + (partnerSuits.some((e) => e.call.strain === c.strain) ? 4 : 0) - (enemySuits.has(c.strain) ? 15 : 0) - c.level * 2;
    return candidates.sort((a, b) => score(b) - score(a) || bidValue(a) - bidValue(b))[0] ?? PASS;
  };
  const safePass = () => semantics.mustBid ? forcedFallback() : PASS;
  const pick = (...calls) => calls.find(available) ?? safePass();
  const cheapest = (strain, maximum = 7) => {
    for (let level = 1; level <= maximum; level++) if (available(bid3(level, strain))) return bid3(level, strain);
  };
  const sorted = [...SUITS].sort((a, b) => lengths[b] - lengths[a] || SUITS.indexOf(b) - SUITS.indexOf(a));
  const naturalMajorOrder = ["H", "S"].sort((a, b) => lengths[b] - lengths[a] || (lengths[a] === 4 ? SUITS.indexOf(a) - SUITS.indexOf(b) : SUITS.indexOf(b) - SUITS.indexOf(a)));
  const longest = sorted[0];
  const openingMajor = sorted.find((suit) => major3(suit) && lengths[suit] >= 5);
  const minor = lengths.C === lengths.D ? lengths.C === 3 ? "C" : "D" : lengths.C > lengths.D ? "C" : "D";
  const saycOpeningStrength = hcp >= 13 || hcp === 12 && lengths[sorted[0]] + lengths[sorted[1]] >= 8;
  const hasStopper = (strain) => strain === "NT" || obs.hand.some((c) => c.suit === strain && (c.rank === 14 || c.rank === 13 && lengths[c.suit] >= 2 || c.rank === 12 && lengths[c.suit] >= 3));
  const reasonablePreemptSuit = (suit) => {
    const ranks = obs.hand.filter((card) => card.suit === suit).map((card) => card.rank);
    return ranks.length >= 7 || ranks.filter((rank) => rank >= 10).length >= 2 && ranks.some((rank) => rank >= 12);
  };
  const all = entries(obs.auction);
  const us = all.filter((e) => sideOf(e.seat) === sideOf(obs.seat));
  const opening = us[0];
  const response = us[1];
  const p = us.filter((e) => e.seat === partnerOf(obs.seat)).at(-1);
  const own = us.filter((e) => e.seat === obs.seat);
  const last = all.at(-1);
  const naturalOpening = !!opening && all[0]?.index === opening.index;
  const range = (call) => call.level === 2 ? system === "precision" ? [22, 23] : [20, 21] : system === "precision" ? [13, 15] : [15, 17];
  const responder = opening ? partnerOf(opening.seat) : null;
  const isOpener = opening?.seat === obs.seat;
  const partnerTrumpMinimum = (trump) => {
    const partner = partnerOf(obs.seat);
    const negativeIndex = obs.auction.findIndex((entry, index) => entry.seat === partner && classifyDoubleAt(obs.auction, index, system) === "negative");
    const negativeEnemy = negativeIndex >= 0 ? all.findLast((entry) => entry.index < negativeIndex && sideOf(entry.seat) !== sideOf(obs.seat)) : void 0;
    if (naturalOpening && major3(trump) && negativeEnemy && trump !== opening.call.strain && trump !== negativeEnemy.call.strain) return 4;
    const partnerBids = us.filter((entry) => entry.seat === partner);
    const ownDoubleIndex = obs.auction.findIndex((entry, index) => entry.seat === obs.seat && isTakeoutDoubleAt(obs.auction, index));
    const firstReply = partnerBids[0];
    if (ownDoubleIndex >= 0 && firstReply?.index > ownDoubleIndex && firstReply.call.strain === trump && !partnerBids.some((entry) => entry.index > firstReply.index && entry.call.strain === trump)) {
      const previous = all.findLast((entry) => entry.index < firstReply.index)?.call;
      return previous && bidValue(firstReply.call) - bidValue(previous) > 5 ? 4 : 0;
    }
    if (naturalOpening && opening?.seat === obs.seat && major3(opening.call.strain) && response?.call.level === 1 && response.call.strain === "NT" && us[2]?.call.level === 3 && us[2].call.strain !== opening.call.strain && partnerBids.at(-1)?.call.strain === trump && major3(trump) && partnerBids.at(-1).index > us[2].index) return 6;
    if (opening?.seat === obs.seat && major3(opening.call.strain) && opening.call.strain === trump && partnerBids.some((entry) => entry.call.level === 2 && entry.call.strain === "NT")) return 4;
    if (naturalOpening && opening?.seat === obs.seat && opening.call.level === 1 && opening.call.strain === trump && !major3(trump) && response?.call.strain === trump) return 5;
    if (naturalOpening && opening?.seat === obs.seat && opening.call.strain === trump && response?.call.level === 1 && response.call.strain !== trump && us[2]?.call.level === 2 && us[2].call.strain !== trump && partnerBids.some((entry) => entry.index > us[2].index && entry.call.level === 2 && entry.call.strain === trump)) return 2;
    if (naturalOpening && opening?.seat === partner && response?.seat === obs.seat && response.call.level === 1 && response.call.strain === trump && opening.call.strain !== trump && us[2]?.seat === partner && us[2].call.strain === trump) return 4;
    return naturalSuitMinimum(obs.auction, partner, trump, system);
  };
  const fitPoints = (trump, promised = partnerTrumpMinimum(trump)) => evaluateSuitFit(obs.hand, trump, promised).totalPoints;
  if (!last) {
    if (system === "precision") {
      if (balanced && hcp >= 22 && hcp <= 23) return pick(bid3(2, "NT"));
      if (hcp >= 16) return pick(bid3(1, "C"));
      if (hcp >= 11) {
        if (openingMajor) return pick(bid3(1, openingMajor));
        if (balanced && hcp >= 13) return pick(bid3(1, "NT"));
        if (lengths.C >= 6 || lengths.C === 5 && (lengths.H === 4 || lengths.S === 4)) return pick(bid3(2, "C"));
        if (lengths.D <= 1 && lengths.H >= 3 && lengths.S >= 3 && lengths.C >= 4) return pick(bid3(2, "D"));
        return pick(bid3(1, "D"));
      }
    } else {
      if (system === "sayc" && balanced && hcp >= 25 && hcp <= 27) return pick(bid3(3, "NT"));
      if (hcp >= 22) return pick(bid3(2, "C"));
      if (balanced && hcp >= 20 && hcp <= 21) return pick(bid3(2, "NT"));
      if (balanced && hcp >= 15 && hcp <= 17) return pick(bid3(1, "NT"));
      if (system === "sayc" ? saycOpeningStrength : hcp >= 12) return pick(bid3(1, openingMajor ?? minor));
    }
    if (system === "sayc" && hcp >= 5 && hcp <= 10 && lengths[longest] >= 8) return pick(bid3(4, longest));
    if (system === "sayc" && hcp >= 5 && hcp <= 10 && lengths[longest] >= 7) return pick(bid3(3, longest));
    if (system === "sayc" && hcp >= 5 && hcp <= 11 && lengths[longest] >= 6 && longest !== "C" && reasonablePreemptSuit(longest)) return pick(bid3(2, longest));
    if (system !== "sayc" && hcp >= 6 && hcp <= 10 && lengths[longest] >= 6 && (system === "precision" ? major3(longest) : longest !== "C")) return pick(bid3(2, longest));
    if (system !== "sayc" && hcp >= 6 && hcp <= 10 && lengths[longest] >= 7) return pick(bid3(3, longest));
    return safePass();
  }
  const strongNtPlatform = naturalOpening && (system === "sayc" || system === "two-over-one") && opening?.call.level === 2 && opening.call.strain === "C" && response?.call.level === 2 && response.call.strain === "D" && us[2]?.call.strain === "NT" ? us[2] : void 0;
  const questionNt = naturalOpening && opening?.call.strain === "NT" ? opening : strongNtPlatform;
  const questionEntries = questionNt ? us.slice(us.indexOf(questionNt)) : [];
  const question = questionEntries[1];
  if (questionNt && questionNt.seat === obs.seat && questionEntries.length === 2 && question && question.call.level === questionNt.call.level + 1 && questionNt.call.level <= 2 && obs.auction.slice(questionNt.index + 1, question.index).every((entry) => entry.call.kind === "pass") && obs.auction.slice(question.index + 1).every((entry) => entry.call.kind === "pass" || entry.call.kind === "double")) {
    if (question.call.strain === "C") return pick(bid3(question.call.level, lengths.H >= 4 ? "H" : lengths.S >= 4 ? "S" : "D"));
    if (question.call.strain === "D" || question.call.strain === "H")
      return pick(bid3(question.call.level, question.call.strain === "D" ? "H" : "S"));
  }
  const quietStrongClub = naturalOpening && (system === "sayc" || system === "two-over-one") && opening?.call.level === 2 && opening.call.strain === "C" && !obs.auction.slice(opening.index + 1).some((entry) => sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.kind === "bid");
  if (quietStrongClub && obs.seat === responder && !own.length) return pick(bid3(2, "D"));
  if (quietStrongClub && isOpener && us.length === 2 && response?.call.level === 2 && response.call.strain === "D") {
    if (balanced) return pick(bid3(hcp >= 25 ? 3 : 2, "NT"));
    if (lengths[longest] === 4) {
      const minor2 = ["D", "C"].find((suit) => lengths[suit] >= 4);
      if (minor2) return pick(bid3(3, minor2));
    }
    return pick(cheapest(longest, 3) ?? safePass());
  }
  if (system === "sayc") {
    const competitive = chooseCompetitiveCall(obs, system);
    const enemySuits = [...new Set(all.filter((entry) => sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.strain !== "NT" && !isArtificialBidAt(obs.auction, entry.index, system)).map((entry) => entry.call.strain))];
    const continuationAfterInterference = naturalOpening && opening.call.level === 1 && opening.call.strain !== "NT" && response?.call.level === 1 && response.call.strain !== "NT" && own.length >= 1 && !us.some((entry) => atGame2(entry.call));
    if ((!competitive || competitive.kind === "pass") && continuationAfterInterference && all.some((entry) => sideOf(entry.seat) !== sideOf(obs.seat))) {
      if (obs.seat === responder && hcp + 12 >= 25) {
        if (p?.call.strain === "NT" && p.index === last?.index && own.some((entry) => entry.call.strain !== "NT" && isArtificialBidAt(obs.auction, entry.index, system)))
          return pick(bid3(3, "NT"));
        const fit = sorted.find((suit) => us.some((entry) => entry.seat === partnerOf(obs.seat) && entry.call.strain === suit && !isArtificialBidAt(obs.auction, entry.index, system)) && lengths[suit] + partnerTrumpMinimum(suit) >= 8);
        if (fit && fitPoints(fit) + 12 >= (major3(fit) ? 25 : 29)) return pick(bid3(gameLevel2(fit), fit));
        if (enemySuits.every(hasStopper)) return pick(bid3(3, "NT"));
        const cue = enemySuits.find((suit) => cheapest(suit, 3));
        if (cue) return pick(cheapest(cue, 3) ?? safePass());
        const second = sorted.find((suit) => suit !== response.call.strain && !enemySuits.includes(suit) && lengths[suit] >= 4 && cheapest(suit, 3));
        if (second) return pick(cheapest(second, 3) ?? safePass());
      }
      if (isOpener && own.length === 1) {
        if (balanced && hcp >= 18 && enemySuits.every(hasStopper)) return pick(bid3(2, "NT"));
        const newMajor = naturalMajorOrder.find((suit) => suit !== opening.call.strain && suit !== response.call.strain && !enemySuits.includes(suit) && lengths[suit] >= 4 && available(bid3(1, suit)));
        if (newMajor) return hcp >= 19 && opening.call.strain !== "NT" && lengths[opening.call.strain] >= 4 && available(bid3(2, newMajor)) ? bid3(2, newMajor) : bid3(1, newMajor);
        if (major3(opening.call.strain) && lengths[opening.call.strain] >= 6)
          return pick(cheapest(opening.call.strain, 3) ?? safePass());
      }
    }
    if (competitive && available(competitive) && (competitive.kind !== "pass" || !semantics.mustBid && !(naturalOpening && own.length > 0))) return competitive;
  }
  if (p?.call.strain === "NT" && p.call.level === 4) {
    const fit = knownFit(us.slice(0, -1), lengths, system, p.seat) ?? keycardTrump(us.slice(0, -1), system, p.seat, obs.auction);
    if (fit) {
      const answer = rkcb1430Response(countKeycards(obs.hand, fit), hasTrumpQueen(obs.hand, fit));
      return pick(bid3(answer.level, answer.strain));
    }
    const quantitativeRange = latestNoTrumpRange(obs.auction, obs.seat, system, p.index);
    return balanced && quantitativeRange && hcp >= quantitativeRange.max ? pick(bid3(6, "NT")) : safePass();
  }
  const ownLast = own.at(-1);
  const fourNt = [...us].reverse().find((entry) => entry.call.level === 4 && entry.call.strain === "NT");
  const rkcbFit = fourNt ? knownFit(us.filter((entry) => entry.index < fourNt.index), lengths, system, fourNt.seat) ?? keycardTrump(us.filter((entry) => entry.index < fourNt.index), system, fourNt.seat, obs.auction) : void 0;
  const kingAsk = !!(rkcbFit && fourNt && ownLast && p && p.call.level === 5 && p.call.strain === "NT" && fourNt.seat === p.seat && ownLast.index > fourNt.index && ownLast.index < p.index && ownLast.call.level === 5 && ownLast.call.strain !== "NT");
  if (kingAsk && rkcbFit) {
    const sideKing = ["C", "D", "H", "S"].find((suit) => suit !== rkcbFit && obs.hand.some((card) => card.suit === suit && card.rank === 13));
    return pick(sideKing ? bid3(6, sideKing) : bid3(6, rkcbFit));
  }
  const kingReply = !!(rkcbFit && fourNt && ownLast && p && ownLast.call.level === 5 && ownLast.call.strain === "NT" && ownLast.index > fourNt.index && p.index > ownLast.index && p.call.level === 6 && p.call.strain !== "NT");
  if (kingReply && rkcbFit && p) return p.call.strain === rkcbFit ? safePass() : pick(bid3(7, rkcbFit), bid3(6, rkcbFit));
  const rkcbAnswer = fourNt ? us.find((entry) => entry.index > fourNt.index && entry.seat === partnerOf(fourNt.seat) && entry.call.level === 5 && (entry.call.strain === "C" || entry.call.strain === "D")) : void 0;
  const queenInquiryByUs = !!(rkcbFit && fourNt && fourNt.seat === obs.seat && ownLast && rkcbAnswer && p && rkcbAnswer.index < ownLast.index && ownLast.index < p.index && (rkcbAnswer.call.strain === "C" && ownLast.call.level === 5 && ownLast.call.strain === "D" || rkcbAnswer.call.strain === "D" && ownLast.call.level === 5 && ownLast.call.strain === "H"));
  if (queenInquiryByUs && rkcbFit && p && p.call.level === 6 && p.call.strain !== rkcbFit && bidValue(p.call) < bidValue(bid3(6, rkcbFit))) return pick(bid3(6, rkcbFit));
  if (queenInquiryByUs && rkcbFit && p && p.call.strain === rkcbFit && (p.call.level === 5 || p.call.level === 6)) return safePass();
  const queenAsk = !!(rkcbFit && ownLast && p && ownLast.index < p.index && ownLast.call.level === 5 && (ownLast.call.strain === "C" && p.call.level === 5 && p.call.strain === "D" || ownLast.call.strain === "D" && p.call.level === 5 && p.call.strain === "H"));
  if (queenAsk && rkcbFit) {
    if (!hasTrumpQueen(obs.hand, rkcbFit)) return pick(cheapest(rkcbFit, 6) ?? safePass());
    const sixTrump = bid3(6, rkcbFit);
    const sideKing = ["C", "D", "H", "S"].find((suit) => suit !== rkcbFit && obs.hand.some((card) => card.suit === suit && card.rank === 13) && bidValue(bid3(6, suit)) < bidValue(sixTrump) && available(bid3(6, suit)));
    return pick(sideKing ? bid3(6, sideKing) : sixTrump);
  }
  if (own.at(-1)?.call.strain === "NT" && own.at(-1)?.call.level === 4 && p?.call.level === 5) {
    const fit = knownFit(us.slice(0, -2), lengths, system, obs.seat) ?? keycardTrump(us.slice(0, -2), system, obs.seat, obs.auction);
    if (fit) {
      const ownKeycards = countKeycards(obs.hand, fit);
      const signoff = (level2) => p.call.strain === fit && p.call.level === level2 ? PASS : pick(bid3(level2, fit));
      const openingBid = us[0];
      const responseBid = us[1];
      const publicPartnerMin = openingBid?.seat === obs.seat ? responseBid?.call.level === 2 && responseBid.call.strain === "NT" ? 13 : system === "precision" && openingBid.call.strain === "C" && responseBid && !(responseBid.call.level === 1 && responseBid.call.strain === "D") ? 8 : responseBid?.call.level === 3 ? 10 : 6 : !naturalOpening ? openingBid?.call.level === 1 ? 8 : 10 : (system === "two-over-one" || system === "sayc") && openingBid?.call.level === 2 && openingBid.call.strain === "C" ? 22 : system === "precision" && openingBid?.call.level === 1 && openingBid.call.strain === "C" ? 16 : system === "precision" ? 11 : 12;
      const allFiveKnown = p.call.strain === "C" && ownKeycards === 4 || p.call.strain === "D" && ownKeycards === 5 || (p.call.strain === "H" || p.call.strain === "S") && ownKeycards === 3;
      const trumpQueenKnown = hasTrumpQueen(obs.hand, fit) || p.call.strain === "S";
      if (allFiveKnown && trumpQueenKnown && fitPoints(fit) + publicPartnerMin >= 37 && available(bid3(5, "NT"))) return bid3(5, "NT");
      if (p.call.strain === "C" || p.call.strain === "D") {
        const knownTotal = ownKeycards + (p.call.strain === "C" ? 1 : 0);
        if (knownTotal < 4) return p.call.strain === fit ? PASS : pick(cheapest(fit, 6) ?? safePass());
        if (hasTrumpQueen(obs.hand, fit)) return pick(bid3(6, fit));
        const question2 = bid3(5, p.call.strain === "C" ? "D" : "H");
        return bidValue(question2) < bidValue(bid3(5, fit)) ? pick(question2) : pick(cheapest(fit, 6) ?? safePass());
      }
      const totalKeycards = ownKeycards + 2;
      const hasQueen = trumpQueenKnown;
      const level = totalKeycards === 5 && hasQueen && fitPoints(fit) + publicPartnerMin >= 37 ? 7 : totalKeycards >= 4 && hasQueen ? 6 : 5;
      return signoff(level);
    }
  }
  const directUncontested = opening && !intervened2(obs.auction, obs.seat, opening.index);
  const gameForcing = semantics.forcing === "game" && (!directUncontested || semantics.convention === "strong-suit-rebid" || semantics.convention === "opener-jump-shift") || !!(naturalOpening && response && (system === "two-over-one" || system === "sayc" ? twoOverOne(opening, response, obs.auction) : system === "precision" && opening.call.level === 1 && opening.call.strain === "C" && !(response.call.level === 1 && response.call.strain === "D")));
  const competitiveThreeNt = !!(opening && response && opening.call.level === 1 && (opening.call.strain === "C" || opening.call.strain === "D") && response.call.level === 3 && response.call.strain === "NT" && intervened2(obs.auction, opening.seat, opening.index, response.index));
  if (competitiveThreeNt && isOpener && own.length === 1 && p?.index === response?.index && lengths[opening.call.strain] >= 6 && hcp >= 16) return pick(bid3(4, opening.call.strain));
  if (competitiveThreeNt && obs.seat === responder && own.length === 1 && p?.call.level === 4 && p.call.strain === opening.call.strain && lengths[opening.call.strain] >= 2 && hcp >= 13 && available(bid3(4, "NT"))) return bid3(4, "NT");
  const closeGame = () => {
    const partnerSuits = us.filter((e) => e.seat === partnerOf(obs.seat) && e.call.strain !== "NT" && !isArtificialBidAt(obs.auction, e.index, system));
    const fit = [...new Map(partnerSuits.map((entry) => [entry.call.strain, entry])).values()].map((entry) => ({ entry, combined: lengths[entry.call.strain] + partnerTrumpMinimum(entry.call.strain) })).filter((candidate) => candidate.combined >= 8).sort((a, b) => b.combined - a.combined || (major3(b.entry.call.strain) ? 1 : 0) - (major3(a.entry.call.strain) ? 1 : 0))[0]?.entry;
    if (fit) return pick(bid3(gameLevel2(fit.call.strain), fit.call.strain), bid3(3, "NT"));
    const ownLongSuit = sorted.find((suit) => lengths[suit] >= 6);
    return pick(bid3(3, "NT"), ownLongSuit ? bid3(gameLevel2(ownLongSuit), ownLongSuit) : bid3(4, "S"), bid3(5, longest));
  };
  const partnerMinimum = () => {
    const supportMinimum = () => {
      if (!p || p.call.strain === "NT") return 10;
      const previousOwn = own.findLast((entry) => entry.index < p.index && entry.call.strain === p.call.strain);
      const preceding = all.findLast((entry) => entry.index < p.index);
      const enemyAdvanced = previousOwn && all.some((entry) => entry.index > previousOwn.index && entry.index < p.index && sideOf(entry.seat) !== sideOf(obs.seat) && !isArtificialBidAt(obs.auction, entry.index, system));
      return enemyAdvanced && preceding && bidValue(p.call) - bidValue(preceding.call) <= 5 ? 6 : 10;
    };
    if (naturalOpening && !isOpener && p?.seat === opening.seat && response?.call.level === 1 && major3(response.call.strain) && p.call.strain === response.call.strain && p.call.level === 3 && p.index === us[2]?.index) return 16;
    if (naturalOpening && !isOpener && p?.seat === opening.seat && p.call.strain === opening.call.strain && p.call.strain !== "NT" && p.call.level === 3 && p.index === us[2]?.index && response?.call.level === 1 && response.call.strain !== opening.call.strain) return 16;
    if (naturalOpening && !isOpener && p?.seat === opening.seat && major3(p.call.strain) && p.call.level === 3 && response?.call.strain === opening.call.strain && response.call.level === 2) return 16;
    if (p?.call.strain === "NT") {
      const publicRange = noTrumpRangeAt(obs.auction, p.index, system);
      if (publicRange) return publicRange.min;
    }
    const ourNegative = obs.auction.findIndex((entry, index) => entry.seat === obs.seat && classifyDoubleAt(obs.auction, index, system) === "negative");
    if (ourNegative >= 0 && p && major3(p.call.strain) && p.call.level === 3 && p.index > ourNegative && !own.length) {
      const beforeReply = all.findLast((entry) => entry.index < p.index)?.call;
      if (beforeReply && bidValue(p.call) - bidValue(beforeReply) > 5) return 16;
    }
    if (naturalOpening && isOpener && p && p.call.level === 3 && p.call.strain !== "NT" && !major3(p.call.strain) && p.call.strain === opening.call.strain && own.some((entry) => entry.index < p.index && entry.call.level === 2 && entry.call.strain === p.call.strain))
      return supportMinimum();
    if ((system === "sayc" || system === "two-over-one") && naturalOpening && !isOpener && p?.index === us[2]?.index && p.call.strain !== "NT" && response?.call.level === 1 && p.call.strain !== opening.call.strain && p.call.strain !== response.call.strain && !all.some((entry) => entry.index < p.index && sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.strain === p.call.strain && !isArtificialBidAt(obs.auction, entry.index, system))) {
      const preceding = all.findLast((entry) => entry.index < p.index)?.call;
      if (preceding && bidValue(p.call) - bidValue(preceding) > 5) return 19;
    }
    if (naturalOpening && p && p.call.strain !== "NT" && major3(p.call.strain) && p.call.level === 3) {
      const previous = all.findLast((entry) => entry.index < p.index)?.call;
      if (!isOpener && p.seat === opening.seat && p.call.strain === opening.call.strain && previous && bidValue(p.call) - bidValue(previous) > 5) return 16;
      if (isOpener && own.some((entry) => entry.index < p.index && entry.call.strain === p.call.strain)) return supportMinimum();
      if (isOpener && response?.call.level === 1 && response.call.strain === p.call.strain && p.index > response.index) return 10;
    }
    if (naturalOpening && isOpener && response?.call.strain === opening.call.strain && response.call.strain !== "NT") return response.call.level === 2 ? 6 : response.call.level === 3 ? 10 : 0;
    if (naturalOpening && !isOpener && p && p.index === us[2]?.index && p.call.level === 2 && p.call.strain !== "NT" && p.call.strain !== opening.call.strain && p.call.strain !== response?.call.strain && bidValue(bid3(1, p.call.strain)) > bidValue(opening.call)) return 17;
    if (naturalOpening && opening?.seat === obs.seat && response?.call.level === 1 && major3(response.call.strain) && us[2]?.call.level === 2 && us[2].call.strain === response.call.strain && p && p.index > us[2].index && p.call.level === 3 && p.call.strain === response.call.strain) return 10;
    const takeoutIndex = obs.auction.findIndex((entry, index) => entry.seat === obs.seat && isTakeoutDoubleAt(obs.auction, index));
    if (p && takeoutIndex >= 0 && p.index > takeoutIndex) {
      const opposingOpening = all[0]?.call;
      const firstReply = all.find((entry) => entry.seat === partnerOf(obs.seat) && entry.index > takeoutIndex);
      if (!firstReply) return 0;
      if (opposingOpening && firstReply.call.strain === opposingOpening.strain) return 12;
      if (firstReply.call.strain === "NT") return firstReply.call.level === 1 ? 6 : firstReply.call.level === 2 ? 11 : 13;
      const previous = all.findLast((entry) => entry.index < firstReply.index)?.call;
      return previous && bidValue(firstReply.call) - bidValue(previous) > 5 ? 9 : 0;
    }
    if (!opening || opening.seat === obs.seat) {
      if (!response || response.seat !== partnerOf(obs.seat)) return 0;
      if ((system === "sayc" || system === "two-over-one") && opening?.call.level === 2 && opening.call.strain === "C" && response.call.strain === "D" && response.call.level === 2) return 0;
      if (system === "precision" && opening?.call.level === 1 && opening.call.strain === "C") return response.call.level === 1 && response.call.strain === "D" ? 0 : 8;
      if ((system === "two-over-one" || system === "sayc") && opening && twoOverOne(opening, response, obs.auction)) return 13;
      if (opening && major3(opening.call.strain) && response.call.level === 2 && response.call.strain === "NT") return 13;
      if (opening && major3(opening.call.strain) && response.call.level === 3 && response.call.strain === opening.call.strain) return 10;
      if (system === "sayc" && opening && major3(opening.call.strain) && response.call.level === 1 && response.call.strain === "NT") return 5;
      if (opening && opening.call.level === 2 && opening.call.strain !== "C" && opening.call.strain !== "NT" && response.call.strain !== opening.call.strain && response.call.strain !== "NT") return 13;
      if (opening && opening.call.level === 1 && response.call.level === 2 && response.call.strain !== "NT" && response.call.strain !== opening.call.strain) return 10;
      return response.call.level === 1 ? 6 : 8;
    }
    if (system === "two-over-one" && response && twoOverOne(opening, response, obs.auction)) {
      const openerRebid = us[2];
      if (openerRebid?.seat === opening.seat && openerRebid.call.level === 3 && openerRebid.call.strain === response.call.strain && major3(response.call.strain)) return 15;
    }
    if (!naturalOpening) return opening.call.level === 1 ? 8 : 10;
    if (opening.call.level >= 3 && opening.call.strain !== "NT") return 5;
    if (opening.call.level === 2 && opening.call.strain !== "NT" && opening.call.strain !== "C") return 5;
    if ((system === "two-over-one" || system === "sayc") && opening.call.level === 2 && opening.call.strain === "C") return 22;
    if (system === "precision" && opening.call.level === 1 && opening.call.strain === "C") return 16;
    if (opening.call.level === 2 && opening.call.strain === "NT") return system === "precision" ? 22 : 20;
    if (opening.call.level === 1 && opening.call.strain === "NT") return system === "precision" ? 13 : 15;
    return system === "precision" ? 11 : 12;
  };
  const partnerHcpMinimum = () => {
    if (naturalOpening && isOpener && p && p.call.level === 3 && p.call.strain !== "NT" && !major3(p.call.strain) && p.call.strain === opening.call.strain && own.some((entry) => entry.index < p.index && entry.call.level === 2 && entry.call.strain === p.call.strain))
      return 0;
    if (isOpener && p && p.call.level === 3 && major3(p.call.strain) && own.some((entry) => entry.index < p.index && entry.call.strain === p.call.strain)) return 0;
    if (naturalOpening && isOpener && response && (response.call.strain === opening.call.strain || major3(opening.call.strain) && response.call.level === 2 && response.call.strain === "NT")) return 0;
    return partnerMinimum();
  };
  const explicitFit = () => {
    const fitLengths = Object.fromEntries(SUITS.map((suit) => [
      suit,
      lengths[suit] + partnerTrumpMinimum(suit) >= 8 ? lengths[suit] : 0
    ]));
    const established = knownFit(us, fitLengths, system, obs.seat);
    if (established && lengths[established] + partnerTrumpMinimum(established) >= 8) return established;
    if (system === "precision" && opening?.call.level === 1 && opening.call.strain === "C" && response && response.call.strain !== "NT" && response.call.strain !== "D" && lengths[response.call.strain] >= 3) return response.call.strain;
    const openerRebid = us[2];
    if (opening && response && obs.seat === responder && openerRebid?.seat === opening.seat && openerRebid.call.strain !== "NT") {
      if (openerRebid.call.strain === opening.call.strain && major3(opening.call.strain) && lengths[opening.call.strain] + partnerTrumpMinimum(opening.call.strain) >= 8) return opening.call.strain;
      if (openerRebid.call.strain !== opening.call.strain && lengths[openerRebid.call.strain] + partnerTrumpMinimum(openerRebid.call.strain) >= 8) return openerRebid.call.strain;
    }
    if (naturalOpening && (system === "two-over-one" || system === "sayc") && opening?.call.level === 2 && opening.call.strain === "C" && obs.seat !== opening.seat && !us.some((entry, index) => index === 2 && entry.call.strain === "NT")) {
      const openerSuit = us.find((entry, index) => index >= 2 && entry.seat === opening.seat && entry.call.strain !== "NT");
      const openerStrain = openerSuit?.call.strain;
      if (openerStrain && openerStrain !== "NT" && lengths[openerStrain] >= 3) return openerStrain;
    }
    return void 0;
  };
  if (naturalOpening && isOpener && response && semantics.convention === "preempt-new-suit") {
    if (response.call.strain !== "NT" && lengths[response.call.strain] >= 3) return pick(cheapest(response.call.strain, 5) ?? safePass());
    return pick(cheapest(opening.call.strain, 5) ?? safePass());
  }
  if (naturalOpening && system === "sayc" && isOpener && own.length === 1 && response && opening.call.level === 1 && opening.call.strain !== "NT" && passedBefore2(obs.auction, response.seat, opening.index) && response.call.level === 2 && response.call.strain !== "NT" && response.call.strain !== opening.call.strain && directUncontested && !gameForcing) {
    if (hcp >= 15 && balanced || hcp >= 19 && SUITS.filter((suit) => suit !== response.call.strain).every(hasStopper)) return pick(bid3(3, "NT"));
    if (lengths[response.call.strain] >= (major3(response.call.strain) ? 3 : 4))
      return hcp >= 18 ? pick(bid3(gameLevel2(response.call.strain), response.call.strain)) : hcp >= 15 ? pick(cheapest(response.call.strain, 3) ?? safePass()) : safePass();
    if (major3(opening.call.strain) && lengths[opening.call.strain] >= 6)
      return pick(cheapest(opening.call.strain, 2) ?? safePass());
    if (hcp >= 15) {
      const second = sorted.find((suit) => suit !== opening.call.strain && suit !== response.call.strain && lengths[suit] >= 4 && cheapest(suit, 3));
      if (second) return pick(cheapest(second, 3) ?? safePass());
      return pick(cheapest(opening.call.strain, 3) ?? safePass());
    }
  }
  if (system === "sayc" && opening && opening.call.level === 3 && opening.call.strain !== "NT") {
    if (obs.seat === responder && own.length === 0 && p?.index === opening.index && hcp >= 15) {
      const forcingSuit = sorted.find((suit) => suit !== opening.call.strain && lengths[suit] >= 5 && !!cheapest(suit, 4));
      if (forcingSuit) return pick(cheapest(forcingSuit, 4) ?? safePass());
      if (balanced && hcp >= 16) return pick(bid3(3, "NT"), cheapest(opening.call.strain, 5) ?? safePass());
      if (lengths[opening.call.strain] >= 2 && hcp >= 18 && available(bid3(4, "NT"))) return bid3(4, "NT");
    }
    if (isOpener && semantics.convention === "preempt-new-suit" && response) {
      if (lengths[response.call.strain] >= 3) return pick(cheapest(response.call.strain, 4) ?? safePass());
      return pick(cheapest(opening.call.strain, 4) ?? safePass());
    }
    if (obs.seat === responder && own.length === 1 && us.length === 3 && p?.call.level === 4 && p.call.strain === opening.call.strain && lengths[opening.call.strain] >= 2 && hcp >= 18 && available(bid3(4, "NT"))) return bid3(4, "NT");
  }
  const latestPartnerNt = [...us].reverse().find((entry) => entry.seat === partnerOf(obs.seat) && entry.call.strain === "NT");
  const latestDefinedPartnerNt = [...us].reverse().find((entry) => entry.seat === partnerOf(obs.seat) && noTrumpRangeAt(obs.auction, entry.index, system));
  const ntRange = latestDefinedPartnerNt ? noTrumpRangeAt(obs.auction, latestDefinedPartnerNt.index, system) : void 0;
  if (ntRange && balanced) {
    const combinedMinimum = hcp + ntRange.min;
    if (combinedMinimum >= 37) return pick(bid3(7, "NT"));
    const majorSearchCompleted = us.some((entry) => entry.seat === obs.seat && entry.call.strain === "C" && latestPartnerNt && entry.index > us[0].index && entry.index < latestPartnerNt.index);
    if (combinedMinimum >= 31 && combinedMinimum < 33 && hcp + ntRange.max >= 33 && (lengths.H < 4 && lengths.S < 4 || majorSearchCompleted)) return pick(bid3(4, "NT"));
    if (combinedMinimum >= 33) return pick(bid3(6, "NT"));
    if (combinedMinimum >= 25 && lengths.H < 4 && lengths.S < 4) return pick(bid3(3, "NT"));
  }
  const slamFit = explicitFit();
  if (slamFit && fitPoints(slamFit) + partnerMinimum() >= 33 && !us.some((entry) => entry.call.level === 4 && entry.call.strain === "NT") && available(bid3(4, "NT"))) return bid3(4, "NT");
  if (p && !atGame2(p.call) && own.length >= 1 && !(gameForcing && isOpener && own.length === 1) && semantics.convention !== "fourth-suit" && semantics.convention !== "new-minor" && semantics.convention !== "weak-jump-inquiry" && !isArtificialBidAt(obs.auction, p.index, system)) {
    const fit = sorted.find((suit) => major3(suit) && lengths[suit] + partnerTrumpMinimum(suit) >= 8 && us.some((entry) => entry.seat === partnerOf(obs.seat) && entry.call.strain === suit && !isArtificialBidAt(obs.auction, entry.index, system)));
    if (fit && fitPoints(fit) + partnerMinimum() >= 25) return pick(bid3(4, fit));
  }
  const partnerDouble = obs.auction.findLast((e, index) => e.seat === partnerOf(obs.seat) && isTakeoutDoubleAt(obs.auction, index));
  const partnerNegative = naturalOpening && opening.seat === obs.seat && obs.auction[opening.index + 1]?.call.kind === "bid" && obs.auction[opening.index + 2]?.seat === partnerOf(obs.seat) && obs.auction[opening.index + 2]?.call.kind === "double";
  if (partnerDouble && !p && !own.length && last.call.strain !== "NT" && last.call.level <= 2) {
    const suit = sorted.find((s) => s !== last.call.strain);
    const low = cheapest(suit, 3);
    if (hcp >= 12) return pick(cheapest(last.call.strain, 3) ?? safePass(), bid3(3, "NT"));
    if (low?.kind === "bid" && hcp >= 9) return pick(bid3(low.level + 1, suit), low);
    return pick(low ?? safePass());
  }
  if (partnerNegative && !p && own.length === 1 && opening?.seat === obs.seat && last.call.level <= 2) {
    const opponent = all.findLast((entry) => sideOf(entry.seat) !== sideOf(obs.seat));
    if (opponent && major3(opponent.call.strain)) {
      const other = opponent.call.strain === "H" ? "S" : "H";
      if (lengths[other] >= 4) return pick(cheapest(other, 3) ?? safePass());
    }
    if (opening.call.strain !== "NT" && lengths[opening.call.strain] >= 6 && hcp >= 16 && available(bid3(3, opening.call.strain))) return bid3(3, opening.call.strain);
    return pick(cheapest(longest, 3) ?? safePass());
  }
  if (system === "sayc" && naturalOpening && opening.call.strain === "NT" && opening.call.level <= 2 && p && p.call.strain !== "NT" && semantics.convention === "competitive-cue" && isOpener) {
    const naturalMajor = sorted.find((suit) => major3(suit) && lengths[suit] >= 4 && cheapest(suit, 4));
    if (naturalMajor) return pick(cheapest(naturalMajor, 4) ?? safePass());
    if (hasStopper(p.call.strain)) return pick(bid3(3, "NT"));
    return forcedFallback();
  }
  if (system === "sayc" && naturalOpening && opening.call.strain === "NT" && opening.call.level === 1 && !own.length && p?.index === opening.index && last.call.strain !== "NT" && sideOf(last.seat) !== sideOf(obs.seat) && last.call.level <= 3) {
    const newMajor = sorted.find((suit) => major3(suit) && suit !== last.call.strain && lengths[suit] >= 5);
    if (newMajor && hcp >= 10 && available(bid3(3, newMajor))) return bid3(3, newMajor);
    if (hcp >= 10 && (lengths.H >= 4 || lengths.S >= 4))
      return pick(cheapest(last.call.strain, 3) ?? safePass());
    if (hcp >= 10 && hasStopper(last.call.strain)) return pick(bid3(3, "NT"));
    if (newMajor && lengths[newMajor] >= 6 && hcp >= 6) return pick(cheapest(newMajor, 2) ?? safePass());
  }
  if (naturalOpening && isOpener && own.length === 1 && !directUncontested && response && p?.index === response.index && response.call.strain !== "NT" && response.call.strain !== opening.call.strain && (semantics.convention === "natural-response" || passedBefore2(obs.auction, response.seat, opening.index) && lengths[response.call.strain] <= 2)) {
    const r = response.call.strain;
    if (lengths[r] >= (response.call.level === 1 ? 4 : major3(r) ? 3 : 4))
      return pick(cheapest(r, 5) ?? safePass());
    const second = sorted.find((suit) => suit !== opening.call.strain && suit !== r && lengths[suit] >= 4 && !all.some((entry) => sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.strain === suit) && cheapest(suit, 3) && (bidValue(bid3(1, suit)) < bidValue(opening.call) || hcp >= 17));
    const enemyNatural = all.filter((entry) => sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.strain !== "NT");
    const nt = cheapest("NT", 2);
    if (balanced && nt?.kind === "bid" && (nt.level === 1 || hcp >= 18) && enemyNatural.every((entry) => hasStopper(entry.call.strain))) return nt;
    if (second) return pick(cheapest(second, 3) ?? safePass());
    if (opening.call.strain !== "NT" && lengths[opening.call.strain] >= 5) return pick(cheapest(opening.call.strain, 3) ?? safePass());
    return forcedFallback();
  }
  if (system === "sayc" && naturalOpening && isOpener && own.length === 1 && !directUncontested && response?.seat === partnerOf(obs.seat) && response.call.level === 1 && response.call.strain !== "NT" && p?.index === response.index && hcp >= 17 && opening.call.strain !== "NT") {
    const enemySuits = new Set(all.filter((entry) => sideOf(entry.seat) !== sideOf(obs.seat) && !isArtificialBidAt(obs.auction, entry.index, system)).map((entry) => entry.call.strain));
    const second = sorted.find((suit) => suit !== opening.call.strain && suit !== response.call.strain && !enemySuits.has(suit) && lengths[suit] >= 4 && cheapest(suit, 3));
    const low = second ? cheapest(second, 3) : void 0;
    if (low?.kind === "bid" && lengths[opening.call.strain] >= 4 && (hcp >= 19 || bidValue(bid3(1, low.strain)) > bidValue(opening.call)))
      return pick(bid3(low.level === 1 && hcp >= 19 ? 2 : low.level, low.strain));
  }
  if (sideOf(last.seat) !== sideOf(obs.seat)) {
    if (gameForcing && !us.some((entry) => atGame2(entry.call))) return closeGame();
    const opponent = last.call;
    const stopped = hasStopper(opponent.strain);
    if (naturalOpening && opening && opening.call.strain !== "NT" && p && own.length === 0 && opening.call.level === 1 && opponent.level <= 2 && last.index === opening.index + 1 && obs.auction.length === opening.index + 2) {
      const otherMajor = opponent.strain === "H" ? "S" : opponent.strain === "S" ? "H" : null;
      if (otherMajor && lengths[otherMajor] === 4 && hcp >= (opponent.level === 1 ? 6 : 8)) return pick({ kind: "double" });
    }
    const artificialPartnerOpening = !!(naturalOpening && p && opening && p.index === opening.index && (system === "precision" && p.call.level === 1 && p.call.strain === "C" || (system === "two-over-one" || system === "sayc") && p.call.level === 2 && p.call.strain === "C"));
    if (artificialPartnerOpening) {
      const positiveSuit = sorted.find((suit) => suit !== opponent.strain && lengths[suit] >= 5);
      if (hcp >= 8 && positiveSuit) return pick(cheapest(positiveSuit, 3) ?? safePass());
      if (hcp >= 8 && balanced) return pick(cheapest("NT", 3) ?? safePass());
      return pick({ kind: "double" }, forcedFallback());
    }
    if (naturalOpening && !isOpener && !own.length && opening.call.level === 1 && opening.call.strain !== "NT" && p?.index === opening.index && opponent.level === 2 && hcp >= 13) {
      const natural = sorted.find((suit) => suit !== opening.call.strain && suit !== opponent.strain && lengths[suit] >= 5 && cheapest(suit, 3));
      if (natural) return pick(cheapest(natural, 3) ?? safePass());
    }
    if (naturalOpening && isOpener && own.length === 1 && opening.call.strain !== "NT" && major3(opening.call.strain) && lengths[opening.call.strain] >= 7 && hcp >= 12 && obs.hand.filter((card) => card.suit === opening.call.strain && card.rank >= 11).length >= 3) {
      const repeat = cheapest(opening.call.strain, 3);
      if (repeat) return repeat;
    }
    if (p && !artificialPartnerOpening && p.call.strain !== "NT" && lengths[p.call.strain] >= 3 && fitPoints(p.call.strain) >= 6) {
      const ownTakeout = obs.auction.findIndex((entry, index) => entry.seat === obs.seat && isTakeoutDoubleAt(obs.auction, index));
      const forcedTakeoutResponse = ownTakeout >= 0 && p.index > ownTakeout;
      const partnerMin2 = forcedTakeoutResponse ? 0 : partnerMinimum();
      const total = fitPoints(p.call.strain) + partnerMin2;
      const supportNeeded = major3(p.call.strain) ? p.call.level === 1 && p.index !== opening?.index ? 4 : 3 : p.index === opening?.index ? 5 : 4;
      if (lengths[p.call.strain] >= supportNeeded && total >= (major3(p.call.strain) ? 25 : 29) && available(bid3(gameLevel2(p.call.strain), p.call.strain))) return bid3(gameLevel2(p.call.strain), p.call.strain);
      const competitiveRaise = lengths[p.call.strain] >= supportNeeded ? cheapest(p.call.strain, 3) : void 0;
      if (competitiveRaise) return competitiveRaise;
    }
    if (naturalOpening && isOpener && own.length === 1 && (!p || p.index === opening.index)) {
      const o = opening.call.strain;
      const enemyNatural = all.filter((entry) => sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.strain !== "NT");
      if (balanced && hcp >= 18 && enemyNatural.every((entry) => hasStopper(entry.call.strain)))
        return pick(cheapest("NT", 3) ?? safePass());
      const second = sorted.find((suit) => suit !== o && !enemyNatural.some((entry) => entry.call.strain === suit) && lengths[suit] >= 4 && cheapest(suit, 3));
      if (second && (hcp >= 18 || hcp >= 17 && bidValue(bid3(1, second)) > bidValue(opening.call)))
        return pick(cheapest(second, 3) ?? safePass());
      if (o !== "NT" && lengths[o] >= 6 && hcp >= 16) {
        const repeat = cheapest(o, 4);
        if (repeat) return repeat;
      }
      if (second && (hcp >= 18 || hcp >= 17 && lengths[second] >= 6)) return pick(cheapest(second, 3) ?? safePass());
      if (o !== "NT" && lengths[o] >= 5 && hcp >= 18) return pick(cheapest(o, 4) ?? safePass());
      if (balanced && hcp >= 18 && stopped) return pick(cheapest("NT", 3) ?? safePass());
    }
    const balancing = all.length === 1 && obs.auction.slice(last.index + 1).length === 2 && obs.auction.slice(last.index + 1).every((entry) => entry.call.kind === "pass");
    const ntMinimum = balancing ? 11 : 15, ntMaximum = balancing ? 14 : 18;
    const artificialEnemy = isArtificialBidAt(obs.auction, last.index, system);
    if (!artificialEnemy && !own.length && balanced && hcp >= ntMinimum && hcp <= ntMaximum && stopped && available(bid3(1, "NT"))) return bid3(1, "NT");
    const enemySuits = new Set(all.filter((entry) => sideOf(entry.seat) !== sideOf(obs.seat)).map((entry) => entry.call.strain));
    const overcallSuit = sorted.find((suit) => !enemySuits.has(suit) && lengths[suit] >= 5);
    if (!own.length && overcallSuit) {
      const call = cheapest(overcallSuit, 2);
      const ranks = obs.hand.filter((card) => card.suit === overcallSuit).map((card) => card.rank);
      const sound = call?.kind === "bid" && (call.level === 1 ? ranks.some((rank) => rank >= 12) || ranks.length >= 6 : ranks.filter((rank) => rank >= 10).length >= 2 && ranks.some((rank) => rank >= 12) || ranks.length >= 6 && ranks.some((rank) => rank >= 13));
      if (call?.kind === "bid" && hcp >= (call.level === 1 ? 8 : 12) && sound) return call;
    }
    const unbid = SUITS.filter((s) => s !== opponent.strain);
    if (!artificialEnemy && !own.length && opponent.strain !== "NT" && opponent.level <= 2 && classifyDoubleAt([...obs.auction, { seat: obs.seat, call: { kind: "double" } }], obs.auction.length, system) === "takeout" && (hcp >= 18 && (lengths[opponent.strain] <= 2 || unbid.some((s) => lengths[s] >= 5)) || hcp >= 12 && lengths[opponent.strain] <= 2 && unbid.every((s) => lengths[s] >= 3))) return pick({ kind: "double" });
    return safePass();
  }
  if (!opening || !p) return safePass();
  if (semantics.convention === "competitive-cue" && p.call.strain !== "NT" && balanced && hasStopper(p.call.strain)) return pick(cheapest("NT", 3) ?? forcedFallback());
  const responderNegativeIndex = obs.auction.findIndex((entry, index) => entry.seat === obs.seat && entry.call.kind === "double" && index === opening.index + 2 && obs.auction[opening.index + 1]?.call.kind === "bid");
  if (naturalOpening && !isOpener && responderNegativeIndex >= 0 && !own.length && p.index > responderNegativeIndex) {
    if (p.call.strain !== "NT" && lengths[p.call.strain] + partnerTrumpMinimum(p.call.strain) >= 8 && fitPoints(p.call.strain) + partnerMinimum() >= (major3(p.call.strain) ? 25 : 29))
      return pick(bid3(gameLevel2(p.call.strain), p.call.strain));
    const enemyNatural = all.filter((entry) => sideOf(entry.seat) !== sideOf(obs.seat) && !isArtificialBidAt(obs.auction, entry.index, system));
    if (balanced && hcp + partnerHcpMinimum() >= 25 && enemyNatural.every((entry) => hasStopper(entry.call.strain)))
      return pick(bid3(3, "NT"));
    if (p.call.strain !== "NT" && major3(p.call.strain) && lengths[p.call.strain] >= 4) {
      const total = evaluateSuitFit(obs.hand, p.call.strain, 4).totalPoints + 12;
      return pick(bid3(total >= 25 ? 4 : total >= 23 ? 3 : 2, p.call.strain));
    }
    const shownRange = p.call.strain === "NT" ? noTrumpRangeAt(obs.auction, p.index, system) : void 0;
    if (shownRange && balanced) return hcp + shownRange.min >= 25 ? pick(bid3(3, "NT")) : hcp + shownRange.max >= 25 ? pick(bid3(2, "NT")) : safePass();
    if (p.call.strain !== "NT" && lengths[p.call.strain] <= 1) {
      const enemySuits = new Set(all.filter((entry) => sideOf(entry.seat) !== sideOf(obs.seat)).map((entry) => entry.call.strain));
      const escape = sorted.find((suit) => !enemySuits.has(suit) && lengths[suit] >= 5 && cheapest(suit, 3));
      if (escape) return pick(cheapest(escape, 3) ?? safePass());
    }
  }
  if (semantics.convention === "new-minor" && isOpener) {
    const respondersMajor = response && major3(response.call.strain) ? response.call.strain : void 0;
    if (respondersMajor && lengths[respondersMajor] >= 3) return pick(cheapest(respondersMajor, 3) ?? safePass());
    const otherMajor = ["H", "S"].find((suit) => suit !== respondersMajor && lengths[suit] >= 4);
    if (otherMajor) return pick(cheapest(otherMajor, 3) ?? safePass());
    return pick(cheapest("NT", 3) ?? safePass(), cheapest(opening.call.strain, 3) ?? safePass());
  }
  if (semantics.convention === "fourth-suit" && isOpener) {
    const respondersSuit = response?.call.strain;
    if (respondersSuit && respondersSuit !== "NT" && lengths[respondersSuit] >= (major3(respondersSuit) ? 3 : 4)) return pick(cheapest(respondersSuit, 3) ?? safePass());
    if (hasStopper(p.call.strain)) return pick(cheapest("NT", 3) ?? safePass());
    const ownNatural = own.filter((entry) => entry.call.strain !== "NT").at(-1)?.call.strain;
    return pick(ownNatural ? cheapest(ownNatural, 3) ?? safePass() : safePass());
  }
  if (semantics.convention === "trial-bid" && isOpener && response && major3(response.call.strain) && p.call.strain !== "NT") {
    const accept = hcp >= 14 || lengths[p.call.strain] <= 1 || hasStopper(p.call.strain);
    return pick(bid3(accept ? 4 : 3, response.call.strain));
  }
  const naturalRebidRange2 = p.call.strain === "NT" ? latestNoTrumpRange(obs.auction, obs.seat, system, p.index + 1) : void 0;
  const responseToNaturalOneLevel = !isOpener && own.length === 1 && opening.call.level === 1 && opening.call.strain !== "NT" && !(system === "precision" && opening.call.strain === "C") && response?.seat === obs.seat && response.call.level === 1 && response.call.strain !== "NT" && p.seat === opening.seat;
  if (responseToNaturalOneLevel && naturalRebidRange2) {
    if (major3(response.call.strain) && lengths[response.call.strain] >= 6) {
      const supported = fitPoints(response.call.strain, 2);
      if (supported + naturalRebidRange2.min >= 25) return pick(bid3(4, response.call.strain));
      if (hcp >= 10 && supported + naturalRebidRange2.max >= 25) return pick(bid3(3, response.call.strain));
    }
    if (!balanced && hcp <= 9) {
      const escape = sorted.find((suit) => suit !== response.call.strain && lengths[suit] >= 5 && cheapest(suit, 2));
      if (escape) return pick(cheapest(escape, 2) ?? safePass());
      if (lengths[response.call.strain] >= 6) return pick(cheapest(response.call.strain, 2) ?? safePass());
    }
    if (hcp + naturalRebidRange2.min >= 25) return pick(bid3(3, "NT"));
    if (hcp >= 10 || hcp + naturalRebidRange2.max >= 25) return pick(bid3(2, "NT"));
    return safePass();
  }
  if (system === "sayc" && responseToNaturalOneLevel && us.length === 3 && p.call.strain === opening.call.strain && p.call.strain !== "NT" && p.call.level === 3 && hcp + partnerHcpMinimum() >= 25 && lengths[p.call.strain] + partnerTrumpMinimum(p.call.strain) < 8) {
    if (balanced) return pick(bid3(3, "NT"));
    const side = sorted.find((suit) => suit !== response.call.strain && suit !== p.call.strain && lengths[suit] >= 4 && cheapest(suit, 3));
    if (side) return pick(cheapest(side, 3) ?? safePass());
    return pick(bid3(3, "NT"));
  }
  if (system === "sayc" && responseToNaturalOneLevel && us.length === 3 && p.call.strain === opening.call.strain && p.call.strain !== "NT" && hcp >= 10 && hcp <= 12) {
    const second = sorted.find((suit) => suit !== response.call.strain && suit !== opening.call.strain && lengths[suit] >= 4 && cheapest(suit, 3));
    if (second) return pick(cheapest(second, 3) ?? safePass());
    if (lengths[response.call.strain] >= 6) return pick(bid3(3, response.call.strain));
    if (available(bid3(2, "NT"))) return bid3(2, "NT");
  }
  const strongRebidNT = opening && us[2]?.call.strain === "NT" && ((system === "two-over-one" || system === "sayc") && opening.call.level === 2 && opening.call.strain === "C" || system === "precision" && opening.call.level === 1 && opening.call.strain === "C" && response?.call.strain === "D" && response.call.level === 1);
  const ntOpening = opening?.call.strain === "NT" ? opening : strongRebidNT ? us[2] : void 0;
  const ntUs = ntOpening ? us.slice(us.indexOf(ntOpening)) : [];
  const ntResponse = ntUs[1];
  if (naturalOpening && directUncontested && system === "sayc" && ntOpening?.call.level === 3) {
    if (obs.seat === responder && ntUs.length === 1) {
      if (openingMajor) return pick(bid3(4, openingMajor === "H" ? "D" : "H"));
      if (lengths.H >= 4 || lengths.S >= 4) return pick(bid3(4, "C"));
      return safePass();
    }
    if (isOpener && ntUs.length === 2) {
      if (p.call.level === 4 && p.call.strain === "C") return pick(bid3(4, lengths.H >= 4 ? "H" : lengths.S >= 4 ? "S" : "D"));
      if (p.call.level === 4 && (p.call.strain === "D" || p.call.strain === "H")) return pick(bid3(4, p.call.strain === "D" ? "H" : "S"));
    }
  }
  const ntQuestionsOnlyDoubled = !!ntOpening && obs.auction.slice(ntOpening.index + 1).every((entry, offset) => sideOf(entry.seat) === sideOf(obs.seat) || entry.call.kind === "pass" || entry.call.kind === "double" && isArtificialBidAt(obs.auction, ntOpening.index + offset, system));
  if (naturalOpening && (directUncontested || ntQuestionsOnlyDoubled) && ntOpening && ntOpening.call.level <= 2) {
    const [minimum, maximum] = strongRebidNT ? system === "precision" ? ntOpening.call.level === 1 ? [16, 18] : [19, 21] : [22, 24] : range(ntOpening.call);
    const base = ntOpening.call.level + 1;
    const invite = Math.max(0, 23 - minimum);
    const gamePoints = Math.max(0, 25 - minimum);
    if (obs.seat === responder && ntUs.length === 1) {
      if (openingMajor) return pick(bid3(base, openingMajor === "H" ? "D" : "H"));
      const staymanPoints = ntOpening.call.level === 2 ? gamePoints : invite;
      if ((lengths.H >= 4 || lengths.S >= 4) && hcp >= staymanPoints) return pick(bid3(base, "C"));
      if (hcp >= gamePoints) return pick(bid3(3, "NT"));
      if (ntOpening.call.level === 1 && hcp >= invite) return pick(bid3(2, "NT"));
      return safePass();
    }
    if (isOpener && ntUs.length === 2) {
      if (p.call.strain === "C" && p.call.level === base) return pick(bid3(base, lengths.H >= 4 ? "H" : lengths.S >= 4 ? "S" : "D"));
      if (p.call.level === base && (p.call.strain === "D" || p.call.strain === "H")) return pick(bid3(base, p.call.strain === "D" ? "H" : "S"));
      if (p.call.strain === "NT" && p.call.level === 2) return hcp >= Math.ceil((minimum + maximum) / 2) ? pick(bid3(3, "NT")) : safePass();
      return safePass();
    }
    if (obs.seat === responder && ntUs.length === 3 && ntResponse) {
      if (ntResponse.call.level === base && (ntResponse.call.strain === "D" || ntResponse.call.strain === "H")) {
        const target = ntResponse.call.strain === "D" ? "H" : "S";
        const fit = lengths[target] + partnerTrumpMinimum(target) >= 8;
        const support = fitPoints(target);
        const secondMajor = target === "H" ? "S" : "H";
        if (hcp >= gamePoints && lengths[secondMajor] >= 5 && available(bid3(3, secondMajor))) return bid3(3, secondMajor);
        if (fit && support + minimum >= 25) return pick(bid3(4, target));
        if (hcp >= gamePoints) return pick(bid3(3, "NT"));
        if (hcp >= invite || fit && support + maximum >= 25)
          return fit ? pick(bid3(3, target)) : pick(bid3(2, "NT"));
        return safePass();
      }
      if (ntResponse.call.strain === "C" && ntResponse.call.level === base) {
        if (major3(p.call.strain) && lengths[p.call.strain] >= 4)
          return pick(bid3(fitPoints(p.call.strain, 4) + minimum >= 25 ? 4 : 3, p.call.strain));
        const otherMajor = ["H", "S"].find((suit) => suit !== p.call.strain && lengths[suit] >= 4 && cheapest(suit, 3));
        if (otherMajor && hcp < gamePoints) return pick(cheapest(otherMajor, 3) ?? safePass());
        return hcp >= gamePoints ? pick(bid3(3, "NT")) : ntOpening.call.level === 1 ? pick(bid3(2, "NT")) : safePass();
      }
    }
    if (isOpener && ntUs.length >= 4 && ntResponse) {
      const target = ntResponse.call.strain === "D" ? "H" : ntResponse.call.strain === "H" ? "S" : null;
      if (ntResponse.call.strain === "C" && p.call.level === 2 && major3(p.call.strain) && lengths[p.call.strain] >= 4) return fitPoints(p.call.strain, 4) + invite >= 25 ? pick(bid3(4, p.call.strain)) : pick(bid3(3, p.call.strain));
      if (p.call.strain === "NT" && p.call.level === 3 && target && lengths[target] >= 3) return pick(bid3(4, target));
      if (p.call.strain === "NT" && p.call.level === 2) {
        if (target && lengths[target] >= 3 && fitPoints(target, 5) + invite >= 25) return pick(bid3(4, target));
        return hcp + invite >= 25 ? pick(bid3(3, "NT")) : safePass();
      }
      if (major3(p.call.strain) && p.call.level === 3) {
        const promised = ntResponse.call.strain === "C" ? 4 : 6;
        return lengths[p.call.strain] + promised >= 8 && fitPoints(p.call.strain, promised) + invite >= 25 ? pick(bid3(4, p.call.strain)) : safePass();
      }
      return safePass();
    }
  }
  if (naturalOpening && directUncontested && system === "precision" && opening.call.level === 1 && opening.call.strain === "C") {
    if (obs.seat === responder && !own.length) {
      if (hcp <= 7) return pick(bid3(1, "D"));
      if (openingMajor) return pick(bid3(1, openingMajor));
      if (lengths[longest] >= 5) return pick(bid3(2, longest));
      return pick(bid3(hcp >= 14 ? 2 : 1, "NT"));
    }
    if (isOpener && us.length === 2 && response) {
      const negative = response.call.strain === "D" && response.call.level === 1;
      if (negative) {
        if (balanced) return pick(bid3(hcp >= 24 ? 3 : hcp >= 19 ? 2 : 1, "NT"));
        const suit = openingMajor ?? sorted.find((s) => major3(s) && lengths[s] >= 4) ?? longest;
        return pick(cheapest(suit, 3) ?? safePass());
      }
      if (response.call.strain !== "NT" && lengths[response.call.strain] >= (major3(response.call.strain) ? 3 : 4)) return pick(bid3(gameLevel2(response.call.strain), response.call.strain), bid3(3, "NT"));
      if (!balanced && openingMajor) return pick(cheapest(openingMajor, 3) ?? bid3(3, "NT"));
      return pick(bid3(3, "NT"));
    }
    if (obs.seat === responder && us.length === 3 && response?.call.strain === "D" && response.call.level === 1) {
      if (p.call.strain === "NT") return p.call.level === 2 && hcp >= 6 ? pick(bid3(3, "NT")) : p.call.level === 1 && hcp >= 7 ? pick(bid3(2, "NT")) : safePass();
      if (major3(p.call.strain) && lengths[p.call.strain] >= 3 && hcp >= 5) return pick(bid3(2, p.call.strain));
      if (hcp >= 5 && lengths.S >= 4 && available(bid3(1, "S"))) return bid3(1, "S");
      return hcp >= 5 ? pick(bid3(1, "NT")) : safePass();
    }
  }
  if (quietStrongClub && opening.call.level === 2 && opening.call.strain === "C" && (system === "two-over-one" || system === "sayc")) {
    if (obs.seat === responder && !own.length) return pick(bid3(2, "D"));
    if (isOpener && us.length === 2) {
      if (balanced) return pick(bid3(hcp >= 25 ? 3 : 2, "NT"));
      if (lengths[longest] === 4) return pick(bid3(3, minor));
      return pick(cheapest(longest, 3) ?? safePass());
    }
    if (obs.seat === responder && us.length === 3) {
      if (p.call.strain === "NT") {
        if (p.call.level === 2 && openingMajor) return pick(bid3(3, openingMajor === "H" ? "D" : "H"));
        if (p.call.level === 2 && (lengths.H >= 4 || lengths.S >= 4) && hcp >= 3) return pick(bid3(3, "C"));
        return hcp >= 3 ? pick(bid3(3, "NT")) : safePass();
      }
      if (system === "sayc" && hcp <= 3) {
        const negative = p.call.strain === "C" ? bid3(3, "D") : p.call.strain === "D" ? bid3(3, "NT") : bid3(3, "C");
        return pick(negative);
      }
      if (lengths[p.call.strain] >= (major3(p.call.strain) ? 3 : 4)) return pick(bid3(gameLevel2(p.call.strain), p.call.strain));
      if (system === "sayc" && hcp >= 4) {
        const positive = sorted.find((suit) => suit !== p.call.strain && lengths[suit] >= 5 && cheapest(suit, 4));
        if (positive) {
          const low = cheapest(positive, 4);
          const reservedNegative = major3(p.call.strain) ? "C" : p.call.strain === "C" ? "D" : "NT";
          if (low?.kind === "bid" && low.level === 3 && low.strain === reservedNegative)
            return pick(bid3(4, positive));
          return pick(low ?? safePass());
        }
      }
      if (hcp <= 3) return pick(bid3(3, "C"));
      return pick(bid3(3, "NT"));
    }
    if (system === "sayc" && isOpener && us.length === 4 && hcp <= 26 && (us[2].call.strain === "C" && p.call.level === 3 && p.call.strain === "D" || us[2].call.strain === "D" && p.call.level === 3 && p.call.strain === "NT"))
      return pick(cheapest(us[2].call.strain, 5) ?? safePass());
    if (isOpener && p.call.level === 3 && p.call.strain === "C" && own.at(-1)?.call.strain === "NT") return pick(bid3(3, lengths.H >= 4 ? "H" : lengths.S >= 4 ? "S" : "D"));
    if (isOpener && p.call.level === 3 && (p.call.strain === "D" || p.call.strain === "H") && own.at(-1)?.call.strain === "NT") return pick(bid3(3, p.call.strain === "D" ? "H" : "S"));
    if (isOpener && p.call.level === 3 && p.call.strain === "C" && own.at(-1)?.call.strain !== "NT") {
      if (hcp >= 25) {
        const second = sorted.find((suit) => suit !== own.at(-1).call.strain && lengths[suit] >= 4 && cheapest(suit, 4));
        if (second) return pick(cheapest(second, 4) ?? safePass());
        return pick(bid3(4, own.at(-1).call.strain), bid3(3, "NT"));
      }
      return pick(cheapest(own.at(-1).call.strain, 4) ?? bid3(3, "NT"));
    }
  }
  if (naturalOpening && directUncontested && system === "precision" && opening.call.level === 2 && (opening.call.strain === "C" || opening.call.strain === "D")) {
    const clubs = opening.call.strain === "C";
    const ask = clubs ? bid3(2, "D") : bid3(2, "NT");
    if (obs.seat === responder && !own.length) {
      if (hcp >= 11) return pick(ask);
      if (clubs && lengths.C >= 3 && hcp >= 6) return pick(bid3(3, "C"));
      if (!clubs) {
        const suit = lengths.S >= lengths.H ? "S" : "H";
        if (lengths[suit] >= 4) return pick(bid3(2, suit));
      }
      return safePass();
    }
    if (isOpener && us.length === 2 && sameCall(response.call, ask)) {
      if (clubs) return lengths.H >= 4 ? pick(bid3(2, "H")) : lengths.S >= 4 ? pick(bid3(2, "S")) : hcp >= 14 ? pick(bid3(2, "NT")) : pick(bid3(3, "C"));
      return pick(bid3(3, lengths.D === 0 ? "D" : lengths.H === 3 ? "H" : lengths.S === 3 ? "S" : "C"));
    }
    if (obs.seat === responder && us.length === 3 && sameCall(response.call, ask)) {
      const shownMajor = clubs ? major3(p.call.strain) ? p.call.strain : null : lengths.S >= 4 && p.call.strain !== "S" ? "S" : lengths.H >= 4 && p.call.strain !== "H" ? "H" : null;
      if (shownMajor && lengths[shownMajor] >= 4) return pick(bid3(hcp >= 14 ? 4 : 3, shownMajor));
      return clubs && hcp < 14 ? pick(bid3(3, "C"), bid3(3, "NT")) : pick(bid3(3, "NT"), bid3(4, "C"));
    }
  }
  if (naturalOpening && directUncontested && opening.call.level === 2 && opening.call.strain !== "NT" && (system === "precision" ? major3(opening.call.strain) : opening.call.strain !== "C")) {
    if (obs.seat === responder && !own.length) {
      const supportTotal = fitPoints(opening.call.strain, 6);
      if (lengths[opening.call.strain] >= 2 && supportTotal + 5 >= (major3(opening.call.strain) ? 25 : 29))
        return pick(bid3(gameLevel2(opening.call.strain), opening.call.strain));
      if (system === "sayc") {
        const forcingSuit = sorted.find((suit) => suit !== opening.call.strain && lengths[suit] >= 5 && hcp >= 13 && cheapest(suit, 3));
        if (forcingSuit) return pick(cheapest(forcingSuit, 3) ?? safePass());
      }
      if (hcp >= 15) return pick(bid3(2, "NT"));
      if (lengths[opening.call.strain] >= 3 && supportTotal >= 6) return pick(bid3(3, opening.call.strain));
      return safePass();
    }
    if (system === "sayc" && isOpener && us.length === 2 && response && response.call.strain !== "NT" && response.call.strain !== opening.call.strain) {
      if (lengths[response.call.strain] >= 3) return pick(cheapest(response.call.strain, 4) ?? safePass());
      if (hcp <= 8) return pick(bid3(3, opening.call.strain));
      const feature = sorted.find((s) => s !== opening.call.strain && s !== response.call.strain && obs.hand.some((c) => c.suit === s && c.rank >= 13));
      return feature ? pick(cheapest(feature, 4) ?? bid3(3, opening.call.strain)) : pick(cheapest("NT", 3) ?? bid3(3, opening.call.strain));
    }
    if (isOpener && p.call.strain === "NT" && p.call.level === 2) {
      if (hcp >= (system === "sayc" ? 9 : 8)) {
        const feature = sorted.find((s) => s !== opening.call.strain && obs.hand.some((c) => c.suit === s && c.rank >= 13));
        if (feature) return pick(bid3(3, feature), bid3(3, opening.call.strain));
      }
      return pick(bid3(3, opening.call.strain));
    }
    if (obs.seat === responder && response?.call.strain === "NT" && response.call.level === 2 && us.length === 3) {
      const publicMinimum = p.call.strain === opening.call.strain ? 5 : 9;
      if (lengths[opening.call.strain] + 6 >= 8 && fitPoints(opening.call.strain, 6) + publicMinimum >= (major3(opening.call.strain) ? 25 : 29))
        return pick(bid3(gameLevel2(opening.call.strain), opening.call.strain));
      if (balanced && hcp + publicMinimum >= 25) return pick(bid3(3, "NT"));
      return pick(cheapest(opening.call.strain, 3) ?? safePass());
    }
    if (system === "sayc" && obs.seat === responder && response?.call.strain !== "NT" && response?.call.strain !== opening.call.strain && us.length >= 3 && hcp >= 19) {
      if (lengths[opening.call.strain] >= 2) return pick(bid3(gameLevel2(opening.call.strain), opening.call.strain));
      if (balanced) return pick(bid3(3, "NT"));
      const selfMajor = sorted.find((suit) => major3(suit) && lengths[suit] >= 6 && available(bid3(4, suit)));
      if (selfMajor) return pick(bid3(4, selfMajor));
      if (SUITS.filter((suit) => suit !== opening.call.strain).every(hasStopper)) return pick(bid3(3, "NT"));
      const sideSuit = sorted.find((suit) => suit !== opening.call.strain && suit !== response.call.strain && lengths[suit] >= 4 && cheapest(suit, 4));
      if (sideSuit) return pick(cheapest(sideSuit, 4) ?? safePass());
      return pick(cheapest(response.call.strain, 3) ?? safePass());
    }
    if (system === "sayc" && obs.seat === responder && response?.call.strain !== "NT" && response?.call.strain !== opening.call.strain && us.length === 3 && p.call.strain === opening.call.strain && lengths[opening.call.strain] <= 1 && lengths[response.call.strain] >= 6 && hcp >= 13)
      return pick(cheapest(response.call.strain, 3) ?? safePass());
    return safePass();
  }
  if (system === "sayc" && naturalOpening && opening.call.level === 3 && obs.seat === responder && response?.call.strain !== "NT" && response?.call.strain !== opening.call.strain && own.length === 1 && us.length === 3 && hcp >= 15 && major3(response.call.strain) && lengths[response.call.strain] >= 6 && available(bid3(4, response.call.strain)))
    return bid3(4, response.call.strain);
  if (atGame2(last.call)) return safePass();
  if (system === "sayc" && naturalOpening && p.call.strain === "NT" && p.call.level === 2 && opening.call.level === 1 && opening.call.strain !== "NT" && own.length >= 1) {
    if (!isOpener && response?.call.strain !== "NT" && major3(response.call.strain) && lengths[response.call.strain] >= 6 && fitPoints(response.call.strain, 2) + partnerMinimum() >= 25)
      return pick(bid3(4, response.call.strain));
    if (hcp + partnerHcpMinimum() >= 25) return pick(bid3(3, "NT"));
  }
  if (system === "sayc" && naturalOpening && isOpener && own.length >= 2 && p.call.strain !== "NT" && !gameForcing && lengths[p.call.strain] <= 1 && opening.call.strain !== "NT" && lengths[opening.call.strain] >= 6)
    return pick(cheapest(opening.call.strain, 3) ?? safePass());
  if (system === "sayc" && naturalOpening && isOpener && own.length === 1 && response && response.call.level === 2 && response.call.strain !== "NT" && !gameForcing && opening.call.strain !== "NT" && lengths[opening.call.strain] >= 6 && lengths[response.call.strain] <= 2)
    return pick(cheapest(opening.call.strain, 3) ?? safePass());
  if (system === "sayc" && naturalOpening && !gameForcing && obs.seat === responder && own.length === 1 && response?.call.level === 2 && response.call.strain !== "NT" && p.call.strain === opening.call.strain && p.call.strain !== "NT" && lengths[p.call.strain] + partnerTrumpMinimum(p.call.strain) < 8) {
    const enemies = all.filter((entry) => sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.strain !== "NT" && !isArtificialBidAt(obs.auction, entry.index, system));
    if (hcp >= 13) {
      if (enemies.every((entry) => hasStopper(entry.call.strain))) return pick(bid3(3, "NT"));
      const cue = enemies.findLast((entry) => cheapest(entry.call.strain, 3));
      if (cue) return pick(cheapest(cue.call.strain, 3) ?? safePass());
    }
    if (lengths[response.call.strain] >= 6 && lengths[p.call.strain] <= 1)
      return pick(cheapest(response.call.strain, 3) ?? safePass());
    if (hcp >= 10) return pick(bid3(2, "NT"), cheapest(response.call.strain, 3) ?? safePass());
  }
  if (naturalOpening && !gameForcing && response?.call.level === 1 && major3(response.call.strain) && opening.call.strain !== response.call.strain && us[2]?.call.level === 2 && us[2].call.strain === response.call.strain) {
    const trump = response.call.strain;
    if (obs.seat === responder && us.length === 3 && fitPoints(trump, 4) >= 10)
      return pick(bid3(fitPoints(trump, 4) + partnerMinimum() >= 25 ? 4 : 3, trump));
    if (isOpener && us.length === 4 && p.call.level === 3 && p.call.strain === trump && fitPoints(trump, 4) >= 15) return pick(bid3(4, trump));
  }
  if (system === "sayc" && naturalOpening && !directUncontested && p?.call.strain !== "NT" && !all.some((entry) => sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.strain === p.call.strain)) {
    const trump = p.call.strain;
    const partnerMin2 = isOpener && obs.auction.some((entry) => entry.seat === partnerOf(obs.seat) && entry.call.kind === "redouble") ? 10 : partnerMinimum();
    if (lengths[trump] + partnerTrumpMinimum(trump) >= 8 && fitPoints(trump) + partnerMin2 >= (major3(trump) ? 25 : 29)) return pick(bid3(gameLevel2(trump), trump));
  }
  if (gameForcing && (system === "two-over-one" || system === "sayc") && isOpener && own.length === 1) {
    if (p.call.strain !== "NT" && lengths[p.call.strain] >= (major3(p.call.strain) ? 3 : 4)) {
      if (major3(p.call.strain)) return hcp <= 14 ? pick(bid3(4, p.call.strain)) : pick(bid3(3, p.call.strain));
      if (balanced) return pick(bid3(2, "NT"));
      return pick(cheapest(p.call.strain, 3) ?? safePass());
    }
    if (balanced) return pick(bid3(2, "NT"));
    if (lengths[opening.call.strain] >= 6) return pick(cheapest(opening.call.strain, 3) ?? safePass());
    const second = sorted.find((suit) => suit !== opening.call.strain && suit !== p.call.strain && lengths[suit] >= 4 && cheapest(suit, 3));
    if (second) return pick(cheapest(second, 3) ?? safePass());
    if (lengths[opening.call.strain] >= 5) return pick(cheapest(opening.call.strain, 3) ?? safePass());
    return forcedFallback();
  }
  if (gameForcing && system === "sayc" && !isOpener && us.length === 3 && response?.call.level === 1 && response.call.strain === "NT" && semantics.convention === "opener-jump-shift") {
    const longMajor = sorted.find((suit) => major3(suit) && lengths[suit] >= 6 && suit !== opening.call.strain && suit !== p?.call.strain && cheapest(suit, 3));
    if (longMajor) return pick(cheapest(longMajor, 3) ?? safePass());
  }
  if (gameForcing) return closeGame();
  if (system === "sayc" && naturalOpening && !isOpener && own.length === 2 && us.length === 5 && own[1].call.strain !== "NT" && isArtificialBidAt(obs.auction, own[1].index, system) && new Set(us.slice(0, 4).map((entry) => entry.call.strain)).size === 4 && hcp >= 13)
    return closeGame();
  if (system === "sayc" && naturalOpening && !directUncontested && isOpener && own.length === 1 && response && response.call.strain !== "NT" && response.call.strain !== opening.call.strain && opening.call.strain !== "NT" && lengths[opening.call.strain] >= 6 && hcp >= 16 && available(bid3(3, opening.call.strain))) return bid3(3, opening.call.strain);
  const naturalResponderContinuation = !!(naturalOpening && responseToNaturalOneLevel && us.length >= 3 && us.length <= 5);
  if ((!naturalOpening || !directUncontested) && !naturalResponderContinuation) {
    if (system === "sayc") {
      if (semantics.forcing === "game") return closeGame();
      if (semantics.mustBid) return forcedFallback();
      return PASS;
    }
    const fallback = chooseBid(obs);
    return semantics.mustBid && fallback.kind === "pass" ? forcedFallback() : fallback;
  }
  if (!own.length && obs.seat === responder && opening.call.level === 1) {
    const o = opening.call;
    if (major3(o.strain)) {
      const supportTotal = fitPoints(o.strain, 5);
      if (lengths[o.strain] >= 4 && supportTotal >= (system === "precision" ? 14 : 13)) return pick(bid3(2, "NT"));
      if (o.strain === "H" && lengths.S >= 4 && hcp >= 6) return pick(bid3(1, "S"));
      if (lengths[o.strain] >= 3 && supportTotal >= 6) {
        if (supportTotal >= 13 && system === "precision") return pick(bid3(4, o.strain));
        if (supportTotal <= 12) return pick(bid3(supportTotal >= 10 ? 3 : 2, o.strain));
      }
      const responderPassed = passedBefore2(obs.auction, obs.seat, opening.index);
      if (system === "sayc" && responderPassed && hcp >= 10) {
        const longSuit = sorted.find((s) => s !== o.strain && lengths[s] >= 5 && available(bid3(2, s)));
        if (longSuit) return bid3(2, longSuit);
        if (balanced && lengths[o.strain] <= 2) {
          if (hcp >= 16 && hcp <= 18) return pick(bid3(3, "NT"));
        }
        const suit = sorted.find((s) => s !== o.strain && lengths[s] >= 4 && available(bid3(2, s)));
        if (suit) return bid3(2, suit);
      }
      if ((system === "two-over-one" || system === "sayc") && hcp >= 13 && !responderPassed) {
        const suit = ["H", "D", "C"].find((s) => s !== o.strain && lengths[s] >= (s === "H" ? 5 : s === "D" ? 4 : 3) && available(bid3(2, s)));
        if (suit) return bid3(2, suit);
      }
      if (system === "precision" && hcp >= 10) {
        const suit = sorted.find((s) => s !== o.strain && lengths[s] >= 4 && available(bid3(2, s)));
        if (suit) return bid3(2, suit);
      }
      if (supportTotal >= 13 && lengths[o.strain] >= 3) return pick(bid3(4, o.strain));
      return hcp >= (system === "sayc" ? 5 : 6) ? pick(bid3(1, "NT")) : safePass();
    }
    const newMajor = naturalMajorOrder.find((s) => lengths[s] >= 4 && available(bid3(1, s)));
    if (newMajor && hcp >= 6) return bid3(1, newMajor);
    if (o.strain === "C" && lengths.D >= 4 && hcp >= 6) return pick(bid3(1, "D"));
    if (system === "sayc" && balanced && hcp >= 11 && hcp <= 15)
      return pick(bid3(hcp >= 13 ? 3 : 2, "NT"));
    const twoOneThreshold = (system === "two-over-one" || system === "sayc") && !passedBefore2(obs.auction, obs.seat, opening.index) ? 13 : 10;
    if (o.strain === "D" && lengths.C >= (system === "two-over-one" ? 3 : 4) && hcp >= twoOneThreshold) return pick(bid3(2, "C"));
    if (system === "sayc" && balanced && hcp >= 13) return pick(bid3(3, "NT"));
    if (system === "sayc" && balanced && hcp >= 11) return pick(bid3(2, "NT"));
    if (system !== "sayc" && balanced && hcp >= 13) return pick(bid3(3, "NT"));
    if (system !== "sayc" && balanced && hcp >= 11) return pick(bid3(2, "NT"));
    if (lengths[o.strain] >= 5) {
      const partnerLength = system === "precision" && o.strain === "D" ? 2 : 3;
      const supportTotal = fitPoints(o.strain, partnerLength);
      if (supportTotal >= 6) return pick(bid3(supportTotal >= 10 ? 3 : 2, o.strain));
    }
    return hcp >= 6 ? pick(bid3(1, "NT")) : safePass();
  }
  if (major3(opening.call.strain) && response?.call.strain === "NT" && response.call.level === 2) {
    if (isOpener && own.length === 1) {
      const short = sorted.find((s) => s !== opening.call.strain && lengths[s] <= 1);
      if (short) return pick(bid3(3, short));
      return pick(bid3(hcp >= 18 ? 3 : 4, opening.call.strain));
    }
    if (obs.seat === responder) return pick(bid3(4, opening.call.strain));
  }
  if (system === "sayc" && isOpener && (opening.call.strain === "C" || opening.call.strain === "D") && response?.call.level === 2 && response.call.strain === "NT" && own.length === 1) {
    return hcp >= 14 ? pick(bid3(3, "NT")) : safePass();
  }
  if (system === "sayc" && isOpener && opening.call.level === 1 && opening.call.strain !== "NT" && response?.call.level === 1 && response.call.strain === "NT" && own.length === 1 && balanced && hcp >= 18) return pick(bid3(2, "NT"));
  if (system === "sayc" && isOpener && opening.call.level === 1 && !major3(opening.call.strain) && opening.call.strain !== "NT" && response?.call.level === 1 && response.call.strain === "NT" && own.length === 1 && hcp >= 17 && !balanced) {
    const second = sorted.find((suit) => suit !== opening.call.strain && lengths[suit] >= 4 && cheapest(suit, 2));
    if (second) return pick(cheapest(second, 2) ?? safePass());
    if (lengths[opening.call.strain] >= 6) return pick(bid3(3, opening.call.strain));
    if (hcp >= 19 && SUITS.filter((suit) => suit !== opening.call.strain).every(hasStopper)) return pick(bid3(3, "NT"));
    return pick(cheapest(opening.call.strain, 2) ?? safePass());
  }
  if (system === "sayc" && isOpener && opening.call.level === 1 && opening.call.strain !== "NT" && !major3(opening.call.strain) && response?.call.level === 1 && response.call.strain === "NT" && own.length === 1 && !balanced && lengths[opening.call.strain] >= 6)
    return pick(bid3(hcp >= 16 ? 3 : 2, opening.call.strain));
  if (isOpener && system === "sayc" && major3(opening.call.strain) && response?.call.level === 1 && response.call.strain === "NT" && own.length === 1) {
    const second = sorted.find((s) => s !== opening.call.strain && lengths[s] >= 4 && available(bid3(2, s)) && (bidValue(bid3(1, s)) < bidValue(opening.call) || hcp >= 17));
    if (hcp >= 19 && second && available(bid3(3, second))) return bid3(3, second);
    if (lengths[opening.call.strain] >= 6 && hcp >= 16 && !(second && bidValue(bid3(1, second)) > bidValue(opening.call)))
      return pick(bid3(hcp >= 19 ? 4 : 3, opening.call.strain));
    if (second) return bid3(2, second);
    if (lengths[opening.call.strain] >= 6) return pick(bid3(2, opening.call.strain));
    if (!balanced) {
      const lowerMinor = ["C", "D"].filter((s) => lengths[s] >= 3 && available(bid3(2, s))).sort((a, b) => lengths[b] - lengths[a])[0];
      if (lowerMinor) return bid3(2, lowerMinor);
      if (lengths[opening.call.strain] >= 5) return pick(bid3(2, opening.call.strain));
    }
    return safePass();
  }
  if (isOpener && system === "two-over-one" && major3(opening.call.strain) && response?.call.strain === "NT" && response.call.level === 1 && !passedBefore2(obs.auction, response.seat, opening.index) && own.length === 1) {
    if (balanced && hcp >= 18) return pick(bid3(2, "NT"));
    const second = sorted.find((s) => s !== opening.call.strain && lengths[s] >= 4 && available(bid3(2, s)) && (bidValue(bid3(1, s)) < bidValue(opening.call) || hcp >= 17));
    if (second) return bid3(2, second);
    if (lengths[opening.call.strain] >= 6) return pick(bid3(2, opening.call.strain));
    const lower = ["C", "D"].find((s) => lengths[s] >= 3 && available(bid3(2, s)));
    return pick(bid3(2, lower ?? "C"));
  }
  if (obs.seat === responder && major3(opening.call.strain) && response?.seat === obs.seat && response.call.level === 1 && response.call.strain === "NT" && own.length === 1 && us.length === 3) {
    const openerRebid = p.call;
    if (openerRebid.strain === "NT") {
      const publicNt = noTrumpRangeAt(obs.auction, p.index, system);
      if (hcp + (publicNt?.min ?? 18) >= 25 && available(bid3(3, "NT"))) return bid3(3, "NT");
      if (hcp >= 8 && available(bid3(2, "NT"))) return bid3(2, "NT");
      return safePass();
    }
    if (openerRebid.strain === opening.call.strain) {
      const combinedTrumps = lengths[opening.call.strain] + partnerTrumpMinimum(opening.call.strain);
      if (combinedTrumps >= 8 && fitPoints(opening.call.strain) + partnerMinimum() >= 25)
        return pick(bid3(4, opening.call.strain));
      if (combinedTrumps >= 8 && fitPoints(opening.call.strain) >= 10)
        return pick(bid3(fitPoints(opening.call.strain) + partnerMinimum() >= 25 ? 4 : 3, opening.call.strain));
      const ownLong2 = sorted.find((suit) => suit !== opening.call.strain && lengths[suit] >= 6 && cheapest(suit, 3));
      if (hcp >= 10 && ownLong2) return pick(bid3(3, ownLong2));
      if (hcp >= 10 && available(bid3(2, "NT"))) return pick(bid3(2, "NT"));
      const weakLong = sorted.find((suit) => suit !== opening.call.strain && lengths[suit] >= 6 && cheapest(suit, 3));
      if (lengths[opening.call.strain] <= 1 && weakLong) return pick(cheapest(weakLong, 3) ?? safePass());
      return safePass();
    }
    const secondFit = lengths[openerRebid.strain] + partnerTrumpMinimum(openerRebid.strain) >= 8;
    if (secondFit && fitPoints(openerRebid.strain) + partnerMinimum() >= (major3(openerRebid.strain) ? 25 : 29))
      return pick(bid3(gameLevel2(openerRebid.strain), openerRebid.strain));
    if (hcp >= 10) {
      const invitationSuit = sorted.find((suit) => suit !== opening.call.strain && suit !== openerRebid.strain && lengths[suit] >= 6 && available(bid3(3, suit)));
      if (invitationSuit) return bid3(3, invitationSuit);
      if (balanced && available(bid3(2, "NT"))) return bid3(2, "NT");
    }
    if (secondFit && lengths[openerRebid.strain] >= 4) {
      if (hcp >= 10) return pick(bid3(Math.min(4, openerRebid.level + 1), openerRebid.strain));
      return safePass();
    }
    const ownLong = sorted.find((suit) => suit !== opening.call.strain && suit !== openerRebid.strain && lengths[suit] >= 6 && cheapest(suit, 3));
    if (ownLong) return pick(cheapest(ownLong, 3) ?? safePass());
    if (lengths[opening.call.strain] >= 2) {
      const preference = cheapest(opening.call.strain, 2);
      if (preference) return preference;
    }
    return safePass();
  }
  if (system === "sayc" && responseToNaturalOneLevel && us.length === 3 && semantics.convention === "reverse" && hcp + partnerHcpMinimum() >= 25) {
    if (balanced) return pick(bid3(3, "NT"));
    const fourth = sorted.find((suit) => !us.some((entry) => entry.call.strain === suit) && lengths[suit] >= 4 && cheapest(suit, 3));
    if (fourth) return pick(cheapest(fourth, 3) ?? safePass());
    if (explicitFit()) return closeGame();
    if (lengths[response.call.strain] >= 6) return pick(bid3(3, response.call.strain));
    return pick(bid3(3, "NT"));
  }
  if (obs.seat === responder && (system === "sayc" || system === "two-over-one") && major3(opening.call.strain) && response?.seat === obs.seat && response.call.level === 1 && response.call.strain !== "NT" && own.length === 1 && us.length === 3 && p.call.level === 2 && p.call.strain !== "NT" && !major3(p.call.strain)) {
    const openerSecond = p.call.strain;
    const secondFit = lengths[openerSecond] + partnerTrumpMinimum(openerSecond) >= 8;
    if (!secondFit) {
      if (lengths[response.call.strain] >= 6 && hcp <= 12)
        return pick(bid3(hcp >= 10 ? 3 : 2, response.call.strain));
      if (hcp <= 9 && lengths[opening.call.strain] >= 2) {
        const preference = cheapest(opening.call.strain, 2);
        if (preference) return preference;
      }
      if (hcp >= 10) {
        const fourthSuit2 = sorted.find((suit) => suit !== opening.call.strain && suit !== response.call.strain && suit !== openerSecond && lengths[suit] >= 4 && cheapest(suit, 3));
        if (fourthSuit2) return pick(cheapest(fourthSuit2, 3) ?? safePass());
        if (balanced) return hcp >= 13 ? pick(bid3(3, "NT")) : pick(cheapest("NT", 3) ?? safePass());
      }
      if (lengths[response.call.strain] >= 6) return pick(cheapest(response.call.strain, 2) ?? safePass());
    }
  }
  if (obs.seat === responder && system === "sayc" && response?.seat === obs.seat && response.call.level === 1 && response.call.strain !== "NT" && own.length === 1 && us.length === 3 && p.call.strain !== "NT" && p.call.strain !== opening.call.strain && p.call.strain !== response.call.strain && balanced && !(major3(p.call.strain) && lengths[p.call.strain] + partnerTrumpMinimum(p.call.strain) >= 8)) {
    if (hcp >= 13) return pick(bid3(3, "NT"));
    if (hcp >= 10) return pick(bid3(2, "NT"));
  }
  if (system === "sayc" && obs.seat === responder && own.length === 1 && us.length === 3 && response?.call.level === 1 && response.call.strain !== "NT" && p.call.level === 1 && p.call.strain !== "NT" && p.call.strain !== response.call.strain && p.call.strain !== opening.call.strain) {
    if (hcp >= 13) {
      const fourth = SUITS.find((suit) => !us.some((entry) => entry.call.strain === suit));
      if (fourth) return pick(cheapest(fourth, 3) ?? safePass());
    }
    if (lengths[p.call.strain] >= 4) {
      const total = fitPoints(p.call.strain, 4) + 12;
      return pick(bid3(total >= 25 ? gameLevel2(p.call.strain) : total >= 23 ? 3 : 2, p.call.strain));
    }
    const enemyNatural = all.filter((entry) => sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.strain !== "NT");
    if (hcp >= 13 && balanced && enemyNatural.every((entry) => hasStopper(entry.call.strain))) return pick(bid3(3, "NT"));
    if (hcp >= 10 && balanced && enemyNatural.every((entry) => hasStopper(entry.call.strain))) return pick(bid3(2, "NT"));
    if (hcp >= 10) {
      const fourth = sorted.find((suit) => suit !== response.call.strain && suit !== p.call.strain && suit !== opening.call.strain && lengths[suit] >= 4 && cheapest(suit, 2));
      if (fourth) return pick(cheapest(fourth, 2) ?? safePass());
    }
    const longEscape = sorted.find((suit) => suit !== response.call.strain && suit !== p.call.strain && suit !== opening.call.strain && lengths[suit] >= 6 && cheapest(suit, 2));
    if (longEscape && lengths[opening.call.strain] <= 1 && hcp >= 6)
      return pick(cheapest(longEscape, 2) ?? safePass());
    if (lengths[response.call.strain] >= 6) return pick(bid3(hcp >= 10 ? 3 : 2, response.call.strain));
    if (opening.call.strain !== "NT" && lengths[opening.call.strain] >= 4)
      return pick(bid3(2, opening.call.strain));
    if (hcp >= 6 && enemyNatural.every((entry) => hasStopper(entry.call.strain))) return pick(bid3(1, "NT"));
  }
  if (system === "sayc" && responseToNaturalOneLevel && us.length === 3 && p.call.level === 2 && p.call.strain !== "NT" && !major3(p.call.strain) && p.call.strain !== opening.call.strain && p.call.strain !== response.call.strain && lengths[p.call.strain] + partnerTrumpMinimum(p.call.strain) < 8) {
    if (hcp >= 13) {
      const fourth = SUITS.find((suit) => !us.some((entry) => entry.call.strain === suit));
      if (fourth) return pick(cheapest(fourth, 3) ?? safePass());
    }
    if (lengths[response.call.strain] >= 6)
      return pick(bid3(hcp >= 10 ? 3 : 2, response.call.strain));
    if (hcp >= 10) return pick(bid3(2, "NT"));
    if (opening.call.strain !== "NT" && lengths[opening.call.strain] >= 2)
      return pick(cheapest(opening.call.strain, 2) ?? safePass());
  }
  if (system === "sayc" && responseToNaturalOneLevel && us.length === 3 && p.call.strain === opening.call.strain && p.call.strain !== "NT") {
    if (balanced && hcp >= 13) return pick(bid3(3, "NT"));
    if (balanced && hcp >= 10) return pick(bid3(2, "NT"));
    if (lengths[response.call.strain] >= 6 && lengths[p.call.strain] <= 2)
      return pick(bid3(hcp >= 13 && major3(response.call.strain) ? 4 : hcp >= 10 ? 3 : 2, response.call.strain));
    const ownSecond = sorted.find((suit) => suit !== opening.call.strain && suit !== response.call.strain && lengths[suit] >= 5 && cheapest(suit, 3));
    if (hcp >= 10 && ownSecond) return pick(cheapest(ownSecond, 3) ?? safePass());
    if (lengths[p.call.strain] <= 1) {
      if (ownSecond) return pick(cheapest(ownSecond, 3) ?? safePass());
      if (lengths[response.call.strain] >= 5) return pick(cheapest(response.call.strain, 2) ?? safePass());
    }
    const publicFit = lengths[p.call.strain] + partnerTrumpMinimum(p.call.strain) >= 8;
    if (publicFit && fitPoints(p.call.strain) >= 10) {
      const total = fitPoints(p.call.strain) + partnerMinimum();
      return pick(bid3(total >= (major3(p.call.strain) ? 25 : 29) ? gameLevel2(p.call.strain) : 3, p.call.strain));
    }
  }
  if (system === "sayc" && responseToNaturalOneLevel && us.length === 3 && hcp >= 13 && p.call.strain !== "NT" && p.call.strain !== opening.call.strain && p.call.strain !== response.call.strain) {
    const fourth = SUITS.find((suit) => !us.some((entry) => entry.call.strain === suit));
    if (fourth && cheapest(fourth, 3)) return pick(cheapest(fourth, 3) ?? safePass());
  }
  if (obs.seat === responder && system === "sayc" && response?.seat === obs.seat && response.call.level === 1 && major3(response.call.strain) && us.length === 3 && p.call.level === 2 && p.call.strain === response.call.strain) {
    const total = fitPoints(response.call.strain, 4) + 12;
    if (total >= 33) return pick(bid3(4, "NT"));
    if (total >= 25) return pick(bid3(4, response.call.strain));
    if (total >= 23) return pick(bid3(3, response.call.strain));
    return safePass();
  }
  if (obs.seat === responder && system === "sayc" && response?.seat === obs.seat && response.call.level === 2 && response.call.strain !== "NT" && us.length === 3 && p.call.strain === response.call.strain && p.call.level === 3) {
    if (balanced && hcp >= 12) return pick(bid3(3, "NT"), bid3(5, response.call.strain));
    const total = fitPoints(response.call.strain, 4) + 12;
    if (total >= 29) return pick(bid3(5, response.call.strain));
    return safePass();
  }
  if (isOpener && own.length === 1) {
    if (system === "sayc" && response?.call.level === 2 && response.call.strain !== "NT" && response.call.strain !== opening.call.strain && passedBefore2(obs.auction, response.seat, opening.index) && balanced && lengths[response.call.strain] < (major3(response.call.strain) ? 3 : 4)) {
      if (hcp >= 18) return pick(bid3(3, "NT"));
      if (hcp >= 12 && hcp <= 14) return pick(bid3(2, "NT"));
    }
    if (!major3(opening.call.strain) && opening.call.strain !== "NT" && p.call.strain === opening.call.strain && p.call.level === 2 && hcp >= 16)
      return pick(bid3(fitPoints(opening.call.strain) + partnerMinimum() >= 29 ? 5 : 3, opening.call.strain));
    if (major3(opening.call.strain) && p.call.strain === opening.call.strain && p.call.level === 3) return fitPoints(opening.call.strain, 3) >= 15 ? pick(bid3(4, p.call.strain)) : safePass();
    if (major3(p.call.strain) && lengths[p.call.strain] >= (p.call.level === 1 ? 4 : 3)) {
      const total = fitPoints(p.call.strain, p.call.level === 1 ? 4 : 3);
      return pick(bid3(total >= 19 ? 4 : total >= 16 ? 3 : 2, p.call.strain));
    }
    if (p.call.strain === "NT" && p.call.level === 2) return hcp >= (system === "precision" ? 14 : 14) ? pick(bid3(3, "NT")) : safePass();
    if (p.call.level === 1 && p.call.strain !== "NT") {
      const majorSuit = naturalMajorOrder.find((s) => lengths[s] >= 4 && available(bid3(1, s)));
      if (hcp >= 19 && !major3(opening.call.strain) && opening.call.strain !== "NT" && lengths[opening.call.strain] >= 6 && SUITS.filter((suit) => suit !== opening.call.strain).every(hasStopper) && available(bid3(3, "NT"))) return bid3(3, "NT");
      if (balanced && hcp >= 18) return pick(bid3(2, "NT"));
      if (hcp >= 19 && opening.call.strain !== "NT" && lengths[opening.call.strain] >= 4) {
        const second2 = sorted.find((suit) => suit !== opening.call.strain && suit !== p.call.strain && lengths[suit] >= 4 && cheapest(suit, 2));
        const low = second2 ? cheapest(second2, 2) : void 0;
        if (low?.kind === "bid" && available(bid3(low.level + 1, low.strain))) return bid3(low.level + 1, low.strain);
      }
      if (majorSuit) return bid3(1, majorSuit);
      if (balanced) return pick(bid3(1, "NT"));
      const responseBid = response?.call;
      const second = sorted.find((s) => {
        if (s === opening.call.strain || lengths[s] < 4 || !available(bid3(2, s))) return false;
        const reverse = responseBid?.level === 1 && bidValue(bid3(1, s)) > bidValue(opening.call);
        return !reverse || hcp >= 17;
      });
      if (second && bidValue(bid3(1, second)) > bidValue(opening.call)) return bid3(2, second);
      if (lengths[opening.call.strain] >= 6 && hcp >= 16) return pick(bid3(hcp >= 19 && major3(opening.call.strain) ? 4 : 3, opening.call.strain));
      if (second) return bid3(2, second);
      if (lengths[opening.call.strain] >= 6) return pick(bid3(2, opening.call.strain));
      if (lengths[opening.call.strain] >= 5) return pick(bid3(2, opening.call.strain));
      return pick(bid3(1, "NT"));
    }
  }
  if (system === "sayc" && isOpener && p.call.level === 2 && p.call.strain === "NT") {
    const ownMajor = sorted.find((suit) => major3(suit) && lengths[suit] >= 6);
    if (ownMajor && fitPoints(ownMajor, 2) + 10 >= 25) return pick(bid3(4, ownMajor));
    const ownNt = own.findLast((entry) => entry.call.level === 1 && entry.call.strain === "NT");
    if (ownNt && hcp >= 14) return pick(bid3(3, "NT"));
    if (own.length >= 2 && hcp >= 15) return pick(bid3(3, "NT"));
  }
  if (system === "sayc" && isOpener && p.call.level === 3 && major3(p.call.strain) && response?.call.level === 1 && response.call.strain === p.call.strain && own.some((entry) => entry.call.level === 1 && entry.call.strain === "NT") && lengths[p.call.strain] >= 2 && hcp >= 14) return pick(bid3(4, p.call.strain));
  if (system === "sayc" && !isOpener && own.length === 2 && us.length === 5 && p.call.strain === "NT" && own[1].call.strain !== "NT" && new Set(us.slice(0, 4).map((entry) => entry.call.strain)).size === 4 && hcp >= 13) return pick(bid3(3, "NT"));
  if (system === "sayc" && !isOpener && own.length === 2 && us.length === 5 && own[1].call.strain !== "NT" && new Set(us.slice(0, 4).map((entry) => entry.call.strain)).size === 4 && hcp >= 13 && !atGame2(p.call)) return closeGame();
  if (system === "sayc" && isOpener && own.length >= 2 && p.call.strain === "NT" && p.call.level === 1 && opening.call.level === 1 && opening.call.strain !== "NT" && hcp >= 18)
    return pick(bid3(hcp >= 19 ? 3 : 2, "NT"));
  if (system === "sayc" && isOpener && own.length === 2 && own[1].call.level === 2 && own[1].call.strain !== "NT" && own[1].call.strain !== opening.call.strain && bidValue(bid3(1, own[1].call.strain)) > bidValue(opening.call) && response?.call.level === 1 && p.call.level <= 2 && hcp >= 19) {
    if (p.call.strain !== "NT" && lengths[p.call.strain] >= 3 && major3(p.call.strain)) return pick(bid3(4, p.call.strain));
    return pick(bid3(3, "NT"), cheapest(opening.call.strain, 3) ?? safePass());
  }
  if (system === "sayc" && isOpener && opening.call.level === 1 && major3(opening.call.strain) && response?.call.level === 1 && response.call.strain === "NT" && own.length >= 2 && p.call.level === 3 && p.call.strain !== "NT" && p.call.strain !== opening.call.strain && hcp >= 17 && SUITS.filter((suit) => suit !== p.call.strain).every(hasStopper))
    return pick(bid3(3, "NT"));
  if (system === "sayc" && isOpener && opening.call.level === 1 && major3(opening.call.strain) && response?.call.level === 1 && response.call.strain === "NT" && us.length === 4 && us[2].call.level === 2 && us[2].call.strain !== opening.call.strain && p.call.level === 2 && p.call.strain === opening.call.strain) {
    if (hcp >= 18 && SUITS.filter((suit) => suit !== opening.call.strain).every(hasStopper)) return pick(bid3(2, "NT"));
    if (hcp >= 17 && lengths[opening.call.strain] >= 6) return pick(bid3(3, opening.call.strain));
    return safePass();
  }
  const partnerMin = partnerMinimum();
  if (p.call.strain !== "NT" && lengths[p.call.strain] + partnerTrumpMinimum(p.call.strain) >= 8 && fitPoints(p.call.strain) + partnerMin >= (major3(p.call.strain) ? 25 : 29)) return pick(bid3(gameLevel2(p.call.strain), p.call.strain));
  if (balanced && hcp + partnerHcpMinimum() >= 25) return pick(bid3(3, "NT"));
  return safePass();
}
function describeCall(auction, seat, call, system) {
  if (call.kind === "pass") {
    const status = auctionStatus(auction);
    const lastBid = status.lastBid;
    if (!lastBid) return "\u4E0D\u53EB\uFF1A\u6CA1\u6709\u8FBE\u5230\u5F53\u524D\u4F53\u7CFB\u7684\u4E00\u9636\u5F00\u53EB\u6216\u963B\u51FB\u5F00\u53EB\u6761\u4EF6";
    if (lastBid.call.kind !== "bid") return "\u4E0D\u53EB\uFF1A\u5F53\u524D\u6CA1\u6709\u81EA\u7136\u5B9A\u7EA6\u9700\u8981\u7EE7\u7EED\u7ADE\u4E89";
    const lastIndex = auction.findLastIndex((entry) => entry === lastBid);
    const forcing = analyzeAuctionSemantics(auction, seat, system).mustBid;
    const ourArtificialContract = sideOf(lastBid.seat) === sideOf(seat) && isArtificialBidAt(auction, lastIndex, system);
    if (forcing || ourArtificialContract) return "\u4E0D\u53EB\u4E0D\u7B26\u5408\u5F53\u524D\u903C\u53EB\u72B6\u6001\uFF1B\u672C\u53EB\u54C1\u5E94\u4FDD\u6301\u7981\u7528\uFF0C\u4EBA\u5DE5\u8BE2\u95EE\u6216\u8F6C\u79FB\u4E0D\u80FD\u4F5C\u4E3A\u6700\u7EC8\u5B9A\u7EA6";
    const doubled = status.doubled === 2 ? "\u518D\u52A0\u500D\u540E\u7684" : status.doubled === 1 ? "\u88AB\u52A0\u500D\u7684" : "";
    if (sideOf(lastBid.seat) === sideOf(seat)) {
      const owner = lastBid.seat === seat ? "\u81EA\u5DF1" : "\u642D\u6863";
      return `\u4E0D\u53EB\uFF1A\u5F53\u524D\u6CA1\u6709\u7EE7\u7EED\u53EB\u724C\u4E49\u52A1\uFF0C\u6682\u65F6\u63A5\u53D7${owner}${doubled}${lastBid.call.level}${lastBid.call.strain}\uFF1B\u5BF9\u624B\u4ECD\u53EF\u7EE7\u7EED\u53EB\u724C`;
    }
    const ownSideHasBid = auction.some((entry) => sideOf(entry.seat) === sideOf(seat) && entry.call.kind === "bid");
    return ownSideHasBid ? `\u4E0D\u53EB\uFF1A\u6682\u4E0D\u7EE7\u7EED\u672C\u65B9\u53EB\u724C\u6216\u52A0\u500D\uFF0C\u8BA9\u5BF9\u624B${doubled}${lastBid.call.level}${lastBid.call.strain}\u4FDD\u6301\u4E3A\u5F53\u524D\u5B9A\u7EA6` : `\u4E0D\u53EB\uFF1A\u653E\u5F03\u5728\u5BF9\u624B${doubled}${lastBid.call.level}${lastBid.call.strain}\u4E4B\u540E\u4E89\u53EB\u3001\u52A0\u500D\u6216\u727A\u7272`;
  }
  if (call.kind === "double") {
    const bidEntries = entries(auction);
    const lastBid = bidEntries.at(-1);
    const ourBids = bidEntries.filter((entry) => sideOf(entry.seat) === sideOf(seat));
    const ourBid = ourBids.at(-1);
    if (system === "sayc" && lastBid && sideOf(lastBid.seat) !== sideOf(seat)) {
      const role = classifyDoubleAt([...auction, { seat, call }], auction.length, system);
      if (role === "lead-directing" && lastBid.call.strain === "NT") return `\u4EBA\u5DE5${lastBid.call.level}NT\u95EE\u53EB\u4E0A\u7684\u52A0\u500D\uFF1A\u6709\u9996\u653B\u6307\u793A\u610F\u56FE\uFF0C\u4F46\u672C\u5361\u672A\u7EA6\u5B9A\u6B64\u65E0\u5C06\u4EBA\u5DE5\u53EB\u54C1\u4E0A\u7684\u5177\u4F53\u9996\u653B\u65B9\u5411\uFF1B\u4E0D\u80FD\u5F53\u6210\u81EA\u7136\u65E0\u5C06\u60E9\u7F5A\u6216\u6280\u672F\u6027\u52A0\u500D`;
      if (role === "lead-directing") return `\u4EBA\u5DE5\u53EB\u54C1${lastBid.call.level}${lastBid.call.strain}\u4E0A\u7684\u9996\u653B\u6307\u793A\u52A0\u500D\uFF1A\u663E\u793A\u6240\u53EB\u82B1\u8272\u7684\u9632\u5B88\u5174\u8DA3\uFF1B\u4E0D\u662F\u8D1F\u52A0\u500D\uFF0C\u4E5F\u4E0D\u8981\u6C42\u642D\u6863\u9009\u672A\u53EB\u82B1\u8272`;
      if (role === "two-suit-strength") return "\u5BF9Michaels\u6216Unusual 2NT\u7684\u5B9E\u529B\u52A0\u500D\uFF1A10+ HCP\uFF0C\u8868\u793A\u6709\u60E9\u7F5A\u610F\u613F\u5E76\u4FDD\u7559\u540E\u7EED\u5224\u65AD";
      if (role === "negative") return "SAYC\u8D1F\u52A0\u500D\uFF1A\u901A\u5E38\u8868\u793A\u672A\u53EB\u9AD8\u82B1\uFF0C\u4F7F\u7528\u81F3\u654C\u65B92\u2660\u4E89\u53EB\uFF1B\u8981\u6C42\u5F00\u53EB\u4EBA\u63CF\u8FF0\uFF0C\u4F46\u666E\u901A\u7B54\u53EB\u4E0D\u81EA\u52A8\u7EE7\u7EED\u903C\u53EB";
      if (role === "penalty" && lastBid.call.strain === "NT") return bidEntries.length === 1 && lastBid.call.level === 1 ? "\u5BF9\u81EA\u71361NT\u5F00\u53EB\u7684\u60E9\u7F5A\u6027\u52A0\u500D\uFF1A15+ HCP\u4E14\u81F3\u5C113\u4E2A\u5FEB\u901F\u8D62\u58A9\uFF1B\u70B9\u529B\u8FBE\u523015\u672C\u8EAB\u4E0D\u8DB3\u4EE5\u81EA\u52A8\u52A0\u500D\uFF0C\u4E0D\u8868\u793A\u672A\u53EB\u82B1\u8272" : `\u5BF9\u81EA\u7136${lastBid.call.level}NT\u7684\u60E9\u7F5A\u6027\u52A0\u500D\uFF1A\u8981\u6C42\u8DB3\u591F\u9632\u5B88\u8D62\u58A9\uFF1B\u65E0\u5C06\u5B9A\u7EA6\u4E0D\u6309\u5C06\u724C\u957F\u5EA6\u5224\u65AD\uFF0C\u4E5F\u4E0D\u91CD\u65B0\u89E3\u91CA\u4E3A\u8D1F\u52A0\u500D`;
      if (role === "penalty") return `\u60E9\u7F5A\u6027\u52A0\u500D\uFF1A\u9488\u5BF9\u5BF9\u624B\u7684${lastBid.call.level}${lastBid.call.strain}\uFF0C\u8981\u6C42\u76F8\u5E94\u5C06\u724C\u8D28\u91CF\u548C\u9632\u5B88\u5B9E\u529B${auction.some((entry) => sideOf(entry.seat) === sideOf(seat) && entry.call.kind === "redouble") ? "\uFF1B\u672C\u65B9\u5B9E\u529B\u518D\u52A0\u500D\u540E\u7684\u540E\u7EED\u7ADE\u4E89\u52A0\u500D\u4E0D\u91CD\u65B0\u89E3\u91CA\u4E3A\u8D1F\u52A0\u500D" : "\uFF1B\u5F53\u524D\u81EA\u7136\u5B9A\u7EA6\u4E0A\u7684\u52A0\u500D\u4E0D\u81EA\u52A8\u8868\u793A\u672A\u53EB\u82B1\u8272"}`;
      if (isTakeoutDoubleAt([...auction, { seat, call }], auction.length)) return "SAYC\u6280\u672F\u6027\u52A0\u500D\uFF1A\u8981\u6C42\u642D\u6863\u9009\u672A\u53EB\u82B1\u8272\uFF1B\u5F3A\u724C\u968F\u540E\u518D\u53EB\u957F\u5957";
      if (!ourBid) return lastBid.call.strain === "NT" ? "\u60E9\u7F5A\u6027\u52A0\u500D\uFF1A\u5BF9\u65B9\u81EA\u7136\u65E0\u5C06\u5B9A\u7EA6\uFF0C\u8981\u6C42\u8DB3\u591F\u9632\u5B88\u5B9E\u529B" : "\u60E9\u7F5A\u6027\u52A0\u500D\uFF1A\u5F53\u524D\u4E0D\u662F\u672C\u4F53\u7CFB\u7684\u6280\u672F\u6027\u52A0\u500D\u4F4D\u7F6E\uFF0C\u8981\u6C42\u654C\u65B9\u5C06\u724C\u8D28\u91CF\u548C\u9632\u5B88\u5B9E\u529B";
      const firstBid = bidEntries[0];
      const conventionalTwoSuiter = firstBid && sideOf(firstBid.seat) === sideOf(seat) && lastBid.index === firstBid.index + 1 && lastBid.call.level === 2 && (lastBid.call.strain === firstBid.call.strain || lastBid.call.strain === "NT");
      if (conventionalTwoSuiter) return "\u5BF9Michaels\u6216Unusual 2NT\u7684\u5B9E\u529B\u52A0\u500D\uFF1A10+ HCP\uFF0C\u8868\u793A\u6709\u60E9\u7F5A\u610F\u613F\u5E76\u4FDD\u7559\u540E\u7EED\u5224\u65AD";
      const negativeDouble = ourBids.length === 1 && ourBid.seat === partnerOf(seat) && ourBid.index === firstBid?.index && lastBid.index === ourBid.index + 1 && auction.length === ourBid.index + 2 && lastBid.call.level <= 2 && lastBid.call.strain !== "NT" && lastBid.call.strain !== ourBid.call.strain;
      if (negativeDouble) return "SAYC\u8D1F\u52A0\u500D\uFF1A\u901A\u5E38\u8868\u793A\u672A\u53EB\u9AD8\u82B1\uFF0C\u4F7F\u7528\u81F3\u654C\u65B92\u2660\u4E89\u53EB";
      return "\u60E9\u7F5A\u6027\u52A0\u500D\uFF1A\u672C\u65B9\u5DF2\u53C2\u4E0E\u7ADE\u4E89\uFF1B\u8981\u6C42\u6709\u654C\u65B9\u5C06\u724C\u957F\u5EA6\u548C\u8D28\u91CF\u3001\u8DB3\u591F\u9632\u5B88\u58A9\uFF0C\u5E76\u7ED3\u5408\u5C40\u51B5\u4FDD\u5B88\u4F7F\u7528";
    }
    return lastBid ? `\u52A0\u500D\uFF1A\u5F53\u524D\u4F53\u7CFB\u672A\u628A\u6B64\u5904\u5B9A\u4E49\u4E3A\u4EBA\u5DE5\u6280\u672F\u6027\u6216\u8D1F\u52A0\u500D\uFF0C\u6309\u5BF9${lastBid.call.level}${lastBid.call.strain}\u7684\u60E9\u7F5A\u6027\u52A0\u500D\u5904\u7406` : "\u52A0\u500D\uFF1A\u5F53\u524D\u6CA1\u6709\u53EF\u52A0\u500D\u7684\u654C\u65B9\u5B9A\u7EA6";
  }
  if (call.kind === "redouble") return system === "sayc" ? "\u518D\u52A0\u500D\uFF1A\u901A\u5E38\u8868\u793A10+ HCP\u548C\u5B9E\u529B\uFF0C\u51C6\u5907\u60E9\u7F5A\u5BF9\u624B\u6216\u5BFB\u627E\u66F4\u597D\u5B9A\u7EA6" : "\u518D\u52A0\u500D\uFF1A\u8868\u793A\u5B9E\u529B\u5E76\u8981\u6C42\u642D\u6863\u6309\u5F53\u524D\u4F53\u7CFB\u7EE7\u7EED\u63CF\u8FF0";
  const all = entries(auction);
  const us = all.filter((e) => sideOf(e.seat) === sideOf(seat));
  const opening = us[0];
  const lastOpponent = [...all].reverse().find((entry) => sideOf(entry.seat) !== sideOf(seat));
  const genuine = !!opening && opening.index === all[0]?.index;
  const clean = genuine && !intervened2(auction, seat, opening.index);
  const own = us.filter((entry) => entry.seat === seat);
  const partner = [...us].reverse().find((entry) => entry.seat === partnerOf(seat));
  const following = [...auction, { seat, call }];
  const fourNt = [...us].reverse().find((entry) => entry.call.level === 4 && entry.call.strain === "NT");
  const trump = fourNt ? keycardTrump(us.filter((entry) => entry.index < fourNt.index), system, fourNt.seat, auction) : void 0;
  const ownLast = own.at(-1);
  const immediateDouble = genuine && opening.call.level === 1 && auction[opening.index + 1]?.call.kind === "double" && auction.length === opening.index + 2 && seat !== opening.seat;
  const enemyBase = all[0];
  const initialOvercall = all[1];
  if (system === "sayc" && enemyBase?.call.level === 1 && enemyBase.call.strain !== "NT" && sideOf(enemyBase.seat) !== sideOf(seat) && initialOvercall && initialOvercall.call.strain !== "NT" && initialOvercall.call.strain !== enemyBase.call.strain && sideOf(initialOvercall.seat) === sideOf(seat) && call.strain === initialOvercall.call.strain && us.length >= 3 && ownLast?.call.strain === enemyBase.call.strain)
    return `\u652F\u6301\u6027\u6263\u53EB\u540E\u56DE\u5230\u4E89\u53EB\u5957${call.strain}\uFF1A\u539F\u6263\u53EB\u5DF2\u663E\u793A10+ HCP\u53CA\u901A\u5E383+\u5F20\u652F\u6301\uFF1B\u672C\u6B21\u662F\u9009\u62E9\u5C06\u724C\u6216\u52A0\u53EB\uFF0C\u4E0D\u627F\u8BFA\u81EA\u5DF1\u7684\u4E94\u5F20\u65B0\u5957`;
  if (genuine && opening?.call.level === 1 && major3(opening.call.strain) && us[1]?.seat === seat && us[1].call.level === 1 && us[1].call.strain === "NT" && us[2]?.seat === opening.seat && us[2].call.strain === opening.call.strain && call.strain === opening.call.strain && us.length === 3)
    return atGame2(call) ? `\u534A\u903C\u53EB1NT\u540E\u9009\u62E9${call.level}${call.strain}\u6210\u5C40\uFF1A\u63A5\u53D7\u5F00\u53EB\u4EBA\u539F\u5957\u518D\u53EB\u6240\u793A\u5B9E\u529B\u6216\u51ED\u672C\u624B\u5B9E\u529B\u5230\u5C40\uFF1B\u53EF\u4EC5\u4E24\u5F20\u652F\u6301\u516D\u5F20\u539F\u5957\uFF0C\u4E0D\u989D\u5916\u627F\u8BFA\u4E09\u5F20\u652F\u6301\uFF0C\u539F\u5219\u4E0A\u6B62\u53EB` : call.level === 3 ? "\u534A\u903C\u53EB1NT\u540E\u5BF9\u539F\u9AD8\u82B1\u518D\u53EB\u7684\u9080\u8BF7\uFF1A\u901A\u5E3810\u201312 HCP\uFF0C\u53EF\u4EC5\u4E24\u5F20\u652F\u6301\uFF1B\u539F\u5957\u901A\u5E38\u516D\u5F20\u4F46\u6709\u4E94\u5F20\u4F8B\u5916\uFF0C\u4E0D\u80FD\u76F4\u63A5\u5BA3\u79F0\u5DF2\u786E\u5B9A\u516B\u5F20\u914D\u5408" : "\u534A\u903C\u53EB1NT\u540E\u56DE\u5230\u539F\u9AD8\u82B1\uFF1A\u5F31\u724C\u504F\u597D\u6216\u9009\u62E9\u90E8\u5206\u5B9A\u7EA6\uFF0C\u53EF\u4EC5\u4E24\u5F20\uFF1B\u4E0D\u989D\u5916\u627F\u8BFA\u4E09\u5F20\u652F\u6301";
  if (system === "sayc" && immediateDouble && call.strain !== "NT" && call.strain !== opening.call.strain) {
    if (call.level === 1) return `\u5BF9\u6280\u672F\u6027\u52A0\u500D\u7684\u4E00\u9636\u81EA\u7136\u65B0\u82B1\u8272\u5E94\u53EB\uFF1A6+ HCP\u30014+\u5F20${call.strain}\uFF1B${passedBefore2(auction, seat, opening.index) ? "\u5DF2Pass\u624B\u724C\u9650\u5236\u5B9E\u529B\uFF0C\u901A\u5E38\u4E0D\u903C\u53EB" : "\u672APass\u624B\u724C\u903C\u53EB\u4E00\u8F6E"}`;
    const previous = all.at(-1).call;
    const jump = bidValue(call) - bidValue(previous) > 5;
    return `\u5BF9\u6280\u672F\u6027\u52A0\u500D\u7684${jump ? "\u5F31\u8DF3\u79FB\u53EB" : "\u4E8C\u9636\u81EA\u7136\u65B0\u82B1\u8272\u5E94\u53EB"}\uFF1A\u901A\u5E386\u201310 HCP\u53CA6+\u5F20${call.strain}\uFF0C\u597D\u4E94\u5F20\u5957\u53EF\u4F5C\u81EA\u7136\u5E94\u53EB\uFF1B\u81EA\u7136\u4E0D\u903C\u53EB\uFF0C\u4E0D\u662F\u65E0\u5E72\u6270\u4E8C\u76D6\u4E00\u8FDB\u5C40\u903C\u53EB`;
  }
  if (genuine && opening?.call.level === 1 && opening.call.strain !== "NT" && us.length === 3 && us[1]?.seat === seat && us[1].call.level === 1 && major3(us[1].call.strain) && us[2].call.level === 2 && us[2].call.strain === us[1].call.strain && call.strain === us[1].call.strain)
    return lastOpponent && lastOpponent.index > us[2].index && call.level === 3 ? `\u654C\u65B9\u7EE7\u7EED\u53EB\u724C\u540E\u7684${call.strain}\u7ADE\u4E89\u6027\u52A0\u53EB\uFF1A\u6CBF\u7528\u5DF2\u786E\u8BA4\u914D\u5408\uFF0C\u4E89\u53D6\u4E09\u9636\u90E8\u5206\u5B9A\u7EA6\uFF1B\u4E0D\u81EA\u52A8\u8868\u793A10\u201312\u652F\u6301\u70B9\u9080\u8BF7\uFF0C\u4E0D\u903C\u53EB` : call.level === 3 ? `\u5BF9\u5F00\u53EB\u4EBA\u56DB\u5F20\u652F\u6301\u7684${call.strain}\u9080\u8BF7\uFF1A\u901A\u5E3810\u201312\u652F\u6301\u70B9\uFF0C\u5DF2\u786E\u8BA4\u81F3\u5C11\u516B\u5F20\u914D\u5408\uFF1B\u4E0D\u989D\u5916\u8868\u793A\u516D\u5F20\u81EA\u5DF1\u7684\u5957` : `\u5728\u5F00\u53EB\u4EBA\u56DB\u5F20\u652F\u6301\u540E\u9009\u62E9${call.level}${call.strain}\uFF1A\u5DF2\u786E\u8BA4\u9AD8\u82B1\u914D\u5408\uFF1B\u6210\u5C40\u6216\u90E8\u5206\u5B9A\u7EA6\u6309\u5148\u524D\u5B9E\u529B\u51B3\u5B9A`;
  if (genuine && opening?.call.level === 1 && us[1]?.call.level === 1 && major3(us[1].call.strain) && us[2]?.seat === seat && us[2].call.level === 2 && us[2].call.strain === us[1].call.strain && us[3]?.call.level === 3 && us[3].call.strain === us[1].call.strain && call.level === 4 && call.strain === us[1].call.strain)
    return "\u63A5\u53D7\u5E94\u53EB\u9AD8\u82B1\u7684\u4E09\u9636\u9080\u8BF7\uFF1A\u5F00\u53EB\u4EBA\u6301\u56DB\u5F20\u652F\u6301\u53CA\u8DB3\u591F\u8C03\u6574\u70B9\uFF0C\u9009\u62E9\u9AD8\u82B1\u6210\u5C40\uFF1B\u4E0D\u662F\u65B0\u82B1\u8272\u663E\u793A";
  if (system === "sayc" && genuine && us.length === 1 && opening.seat === partnerOf(seat) && opening.call.level === 1 && opening.call.strain !== "NT" && call.strain !== "NT" && call.strain !== opening.call.strain && lastOpponent && lastOpponent.index > opening.index && call.strain !== lastOpponent.call.strain && bidValue(call) - bidValue(lastOpponent.call) <= 5) {
    const alreadyPassed = passedBefore2(auction, seat, opening.index);
    const fiveSpades = !major3(opening.call.strain) && lastOpponent.call.strain === "H" && call.strain === "S";
    return `\u5F00\u53EB\u65B9\u5728\u4E89\u53EB\u540E${call.level === 1 ? "\u4E00\u9636" : `\u81EA\u7136${call.level}\u9636`}\u65B0\u82B1\u8272\u5E94\u53EB\uFF1A${call.level === 1 ? "6+" : "10+"} HCP\u3001\u901A\u5E38${call.level === 1 && !fiveSpades ? "4" : "5"}+\u5F20${call.strain}\uFF1B${alreadyPassed ? "\u8FC7\u624B\u724C\u9650\u5236\u5B9E\u529B\uFF0C\u901A\u5E38\u4E0D\u903C\u53EB" : "\u903C\u53EB\u4E00\u8F6E\uFF0C\u5F00\u53EB\u4EBA\u4E0D\u80FD\u65E0\u6545Pass"}\uFF0C\u4E0D\u662F\u53E6\u4E00\u65B9\u7684\u4E89\u53EB\u540E\u5E94\u53EB`;
  }
  if (clean && opening?.call.level === 1 && major3(opening.call.strain) && us[1]?.call.level === 2 && us[1].call.strain === "NT") {
    const agreed = opening.call.strain;
    if (us.length === 2 && seat === opening.seat) {
      if (call.level === 3 && call.strain !== "NT" && call.strain !== agreed)
        return `Jacoby 2NT\u540E\u7684\u77ED\u95E8\u7B54\u53EB\uFF1A${call.strain}\u5355\u5F20\u6216\u7F3A\u95E8\uFF1B\u65E2\u5B9A\u5C06\u724C\u4E3A${agreed}\uFF0C\u4E0D\u627F\u8BFA\u6240\u53EB\u82B1\u8272\u957F\u5EA6\uFF0C\u8FDB\u5C40\u903C\u53EB\u7EE7\u7EED`;
      if (call.strain === agreed && call.level === 3) return `Jacoby 2NT\u540E\u7684\u989D\u5916\u5B9E\u529B\u7B54\u53EB\uFF1A\u65E0\u77ED\u95E8\uFF0C\u901A\u5E3818+ HCP\uFF1B${agreed}\u4E3A\u5C06\u724C\uFF0C\u4FDD\u7559\u6EE1\u8D2F\u7A7A\u95F4`;
      if (call.strain === agreed && call.level === 4) return `Jacoby 2NT\u540E\u7684\u6700\u4F4E\u9650\u7B54\u53EB\uFF1A\u65E0\u77ED\u95E8\u3001\u989D\u5916\u5B9E\u529B\u8F83\u5C11\uFF0C\u9009\u62E94${agreed}\u6210\u5C40`;
    }
    if (us.length >= 3 && call.strain === agreed && call.level === 4)
      return `Jacoby 2NT\u540E\u9009\u62E94${agreed}\u6210\u5C40\uFF1A\u6B64\u524D\u5DF2\u7EA6\u5B9A${agreed}\u4E3A\u5C06\u724C\uFF0C\u5F53\u524D\u4E0D\u7EE7\u7EED\u6EE1\u8D2F\u63A2\u7D22`;
  }
  const keyAnswer = fourNt ? us.find((entry) => entry.index > fourNt.index && entry.seat !== fourNt.seat && entry.call.level === 5 && entry.call.strain !== "NT") : void 0;
  if (trump && fourNt) {
    if (partner?.index === fourNt.index && call.level === 5 && call.strain !== "NT") {
      return call.strain === "C" ? "RKCB 1430\u7B54\u53EB\uFF1A1\u62164\u4E2A\u5173\u952E\u5F20" : call.strain === "D" ? "RKCB 1430\u7B54\u53EB\uFF1A0\u62163\u4E2A\u5173\u952E\u5F20" : call.strain === "H" ? "RKCB 1430\u7B54\u53EB\uFF1A2\u62165\u4E2A\u5173\u952E\u5F20\uFF0C\u65E0\u5C06\u724CQ" : "RKCB 1430\u7B54\u53EB\uFF1A2\u62165\u4E2A\u5173\u952E\u5F20\uFF0C\u6709\u5C06\u724CQ";
    }
    const queenAsk = keyAnswer && fourNt.seat === seat && partner?.index === keyAnswer.index && (keyAnswer.call.strain === "C" && call.level === 5 && call.strain === "D" || keyAnswer.call.strain === "D" && call.level === 5 && call.strain === "H");
    if (queenAsk) return `RKCB\u540E\u7684\u5C06\u724CQ\u8BE2\u95EE\uFF1A\u5BF9${keyAnswer.call.strain === "C" ? "5\u2663" : "5\u2666"}\u52A0\u4E00\u7EA7\uFF1B\u65E0Q\u56DE\u5230\u6700\u4F4E\u53EF\u53EB\u7684${trump}\uFF0C\u6709Q\u663E\u793A\u516D\u9636\u5C06\u724C\u6216\u5176\u4E0B\u7684\u65C1\u95E8K`;
    const queenResponse = keyAnswer && ownLast?.index === keyAnswer.index && partner && (keyAnswer.call.strain === "C" && partner.call.level === 5 && partner.call.strain === "D" || keyAnswer.call.strain === "D" && partner.call.level === 5 && partner.call.strain === "H");
    if (queenResponse && call.strain === trump) return call.level === 5 ? `\u5C06\u724CQ\u7B54\u53EB\uFF1A\u5426\u8BA4Q\uFF0C\u56DE\u52305${trump}\u6B62\u53EB\uFF1B\u4E0D\u662F\u65B0\u7684\u81EA\u7136\u957F\u5957\u6216\u5173\u952E\u5F20\u56DE\u7B54` : partner && bidValue(partner.call) >= bidValue(bid3(5, trump)) ? `\u5C06\u724CQ\u7B54\u53EB\uFF1A\u56DE\u5230\u6700\u4F4E\u53EF\u53EB\u76846${trump}\uFF1B\u4E94\u9636\u5C06\u724C\u5DF2\u88AB\u95EE\u53EB\u8D8A\u8FC7\uFF0C\u6B64\u56DE\u7B54\u4E0D\u80FD\u5355\u72EC\u533A\u5206\u6709Q\u4E0E\u65E0Q` : `\u5C06\u724CQ\u7B54\u53EB\uFF1A\u6709Q\uFF0C\u53EB6${trump}\uFF1B\u6CA1\u6709\u5728\u5176\u4E0B\u53EF\u63CF\u8FF0\u7684\u65C1\u95E8K`;
    if (queenResponse && call.level === 6) return `\u5C06\u724CQ\u7B54\u53EB\uFF1A\u6709\u5C06\u724CQ\uFF0C\u540C\u65F6\u663E\u793A${call.strain}K\uFF1B\u65E2\u5B9A\u5C06\u724C\u4ECD\u662F${trump}`;
    if (call.level === 5 && call.strain === "NT" && fourNt.seat === seat && partner?.index === keyAnswer?.index) return `RKCB\u540E\u76845NT\u95EEK\uFF1A\u786E\u8BA4\u4E94\u4E2A\u5173\u952E\u5F20\u53CA\u5C06\u724CQ\u9F50\u5168\u540E\uFF0C\u8BE2\u95EE\u65C1\u95E8K\uFF1B${trump}K\u5DF2\u8BA1\u5165\u5173\u952E\u5F20`;
    if (partner?.call.level === 5 && partner.call.strain === "NT" && partner.seat === fourNt.seat && call.level === 6 && call.strain !== "NT") return call.strain === trump ? `5NT\u95EEK\u7B54\u53EB\uFF1A\u6CA1\u6709\u65C1\u95E8K\uFF0C\u56DE\u52306${trump}` : `5NT\u95EEK\u7B54\u53EB\uFF1A\u663E\u793A\u6700\u4F4E\u53EF\u53EB\u7684${call.strain}K\uFF1B\u5C06\u724C\u4ECD\u662F${trump}`;
    if (fourNt.seat === seat && keyAnswer && call.strain === trump && call.level >= 5) return `RKCB\u540E\u7684${call.level}${trump}\u7B7E\u7EA6\uFF1A\u6309\u5173\u952E\u5F20\u53CA\u5C06\u724CQ\u56DE\u7B54\u9009\u62E9\u5B9A\u7EA6\uFF1B\u4E0D\u518D\u8868\u793A\u65B0\u82B1\u8272\u6216\u989D\u5916\u5957\u957F`;
  }
  if (call.level === 4 && call.strain === "NT") {
    const fit = keycardTrump(us, system, seat, auction);
    if (fit) return `RKCB 1430\u5173\u952E\u5F20\u95EE\u53EB\uFF1A\u5DF2\u7EA6\u5B9A${fit}\u4E3A\u5C06\u724C\uFF0C\u8BE2\u95EE\u56DB\u4E2AA\u53CA${fit}K\uFF1B5\u2663=1/4\u30015\u2666=0/3\u30015\u2665=2/5\u65E0Q\u30015\u2660=2/5\u6709Q`;
    if (us.some((entry) => entry.call.strain === "NT")) return "\u81EA\u7136\u65E0\u5C06\u4E2D\u7684\u5B9A\u91CF4NT\uFF1A\u9080\u8BF7\u6EE1\u8D2F\uFF0C\u53EF\u6309\u5DF2\u516C\u5F00\u7684\u65E0\u5C06\u8303\u56F4\u63A5\u53D7\u6216Pass\uFF1B\u4E0D\u662FRKCB";
    return "\u975E\u4F53\u7CFB4NT\uFF1A\u5C1A\u672A\u7EA6\u5B9A\u5C06\u724C\uFF0C\u4E5F\u6CA1\u6709\u81EA\u7136\u65E0\u5C06\u5B9A\u91CF\u80CC\u666F\uFF1B\u4E0D\u5E94\u628A\u5B83\u89E3\u91CA\u4E3ARKCB\uFF0C\u624B\u52A8\u9009\u62E9\u4E0D\u627F\u8BFA\u5173\u952E\u5F20\u95EE\u53EB";
  }
  if (genuine && opening.call.level === 2 && opening.call.strain === "C" && system !== "precision") {
    if (us.length === 1 && seat !== opening.seat && call.level === 2 && call.strain === "D") return "\u5F3A2\u2663\u540E\u76842\u2666\u7B49\u5F85\u5E94\u53EB\uFF1A\u4EBA\u5DE5\u903C\u53EB\uFF0C\u4E0D\u627F\u8BFA\u65B9\u5757\u957F\u5EA6\uFF0C\u4E5F\u4E0D\u7B49\u4E8E\u5F31\u724C";
    if (us.length === 2 && seat === opening.seat && call.strain === "NT") return call.level === 2 ? "\u5F3A2\u2663\u540E\u76842NT\u518D\u53EB\uFF1A22\u201324 HCP\u5747\u578B\uFF1B2\u2666\u7B49\u5F85\u5E94\u53EB\u4E0D\u7B97\u65B9\u5757\u5957" : "\u5F3A2\u2663\u540E\u76843NT\u518D\u53EB\uFF1A25+ HCP\u5747\u578B\uFF0C\u9009\u62E9\u6210\u5C40\u5B9A\u7EA6";
    if (us.length === 3 && seat !== opening.seat && call.level === 3 && call.strain === "C" && major3(us[2].call.strain)) return system === "sayc" ? "\u5F3A2\u2663\u540E\u7684\u7B2C\u4E8C\u6B21\u8D1F\u5E94\u53EB3\u2663\uFF1A\u4EBA\u5DE5\u793A\u5F31\uFF0C0\u20133 HCP\uFF1B\u4E0D\u627F\u8BFA\u6885\u82B1\u5957\u6216\u6885\u82B1\u914D\u5408\uFF0C\u903C\u53EB\u4E00\u8F6E" : "\u5F3A2\u2663\u540E\u7684\u7B2C\u4E8C\u6B21\u8D1F\u5E94\u53EB3\u2663\uFF1A\u4EBA\u5DE5\u793A\u5F31\uFF1B\u4E0D\u627F\u8BFA\u6885\u82B1\u5957\u6216\u6885\u82B1\u914D\u5408\uFF0C\u903C\u53EB\u4E00\u8F6E";
    if (system === "sayc" && us.length === 3 && seat !== opening.seat && call.level === 3 && (us[2].call.strain === "C" && call.strain === "D" || us[2].call.strain === "D" && call.strain === "NT"))
      return "\u5F3A2\u2663\u540E\u4E09\u9636\u4F4E\u82B1\u518D\u53EB\u7684\u7B2C\u4E8C\u6B21\u8D1F\u5E94\u53EB\uFF1A0\u20133 HCP\uFF0C\u4EBA\u5DE5\u793A\u5F31\u5E76\u903C\u53EB\u4E00\u8F6E\uFF1B\u4E0D\u663E\u793A\u65B9\u5757\u957F\u5957\u6216\u81EA\u7136\u65E0\u5C06\u6210\u5C40\u5B9E\u529B";
    if (system === "sayc" && us.length === 3 && seat !== opening.seat && us[1]?.call.level === 2 && us[1].call.strain === "D" && us[2].call.strain !== "NT" && call.strain !== "NT" && call.strain !== us[2].call.strain)
      return `\u5F3A2\u2663\u7B49\u5F85\u540E\u81EA\u7136${call.level}${call.strain}\u6B63\u5E94\uFF1A5+\u5F20\u81EA\u5DF1\u7684\u5957\uFF0C\u4E0D\u662F0\u20133 HCP\u7684\u4EBA\u5DE5\u4E8C\u6B21\u8D1F\u5E94\u53EB\uFF1B\u8FDB\u5C40\u903C\u53EB\u7EE7\u7EED\uFF0C\u672C\u8F6E\u56FA\u5B9A\u8D1F\u5E94\u53EB\u4E3A${major3(us[2].call.strain) ? "3\u2663" : us[2].call.strain === "C" ? "3\u2666" : "3NT"}\uFF0C\u4E0D\u56E0\u5B9E\u9645\u624B\u724C\u800C\u6539\u53D8`;
    if (us.length === 2 && seat === opening.seat && call.strain !== "NT") return `\u5F3A2\u2663\u540E\u7684\u81EA\u7136${call.level}${call.strain}\u518D\u53EB\uFF1A${major3(call.strain) ? "\u663E\u793A5+\u5F20\u9AD8\u82B1\u5957" : "\u901A\u5E385+\u5F20\u4F4E\u82B1\uFF1B\u5F3A4-4-4-1\u624B\u724C\u6CA1\u6709\u4E94\u5F20\u5957\u65F6\u5141\u8BB8\u81EA\u7136\u56DB\u5F20\u4F4E\u82B1\uFF0C\u4E0D\u628A\u56DB\u5F20\u9AD8\u82B1\u4F2A\u62A5\u4E3A\u4E94\u5F20"}\uFF0C\u903C\u53EB\u4E00\u8F6E\uFF1B\u5C1A\u672A\u89E3\u9664\u5F3A\u5F00\u53EB\u7684\u5E94\u53EB\u4E49\u52A1`;
  }
  const ntOpening = genuine ? opening.call.strain === "NT" ? opening : opening.call.level === 2 && opening.call.strain === "C" && us[2]?.call.strain === "NT" ? us[2] : void 0 : void 0;
  const ntUs = ntOpening ? us.slice(us.indexOf(ntOpening)) : [];
  const ntResponse = ntUs[1];
  const ntConventionsAvailable = ntOpening && !auction.slice(ntOpening.index + 1).some((entry) => sideOf(entry.seat) !== sideOf(seat) && entry.call.kind === "bid");
  if (ntConventionsAvailable && ntOpening && ntOpening.call.level <= 3) {
    const base = ntOpening.call.level + 1;
    if (ntUs.length === 1 && seat !== ntOpening.seat && call.level === base) {
      if (call.strain === "C") return "Stayman\uFF1A\u4EBA\u5DE5\u8BE2\u95EE\u56DB\u5F20\u9AD8\u82B1\uFF0C\u4E0D\u627F\u8BFA\u6885\u82B1\u957F\u5EA6\uFF1B\u903C\u53EB\u4E00\u8F6E";
      if (call.strain === "D" || call.strain === "H") return `Jacoby\u8F6C\u79FB\uFF1A5+\u5F20${call.strain === "D" ? "\u7EA2\u5FC3" : "\u9ED1\u6843"}\uFF0C\u8981\u6C42\u63A5\u53D7\u8F6C\u79FB\uFF1B\u4E0D\u627F\u8BFA\u6240\u53EB\u82B1\u8272\u957F\u5EA6`;
    }
    if (ntUs.length === 2 && seat === ntOpening.seat && ntResponse) {
      if (ntResponse.call.strain === "C" && ntResponse.call.level === base) {
        if (call.level === base && call.strain === "D") return "Stayman\u7B54\u53EB\uFF1A\u5426\u8BA4\u56DB\u5F20\u9AD8\u82B1\uFF1B\u4EBA\u5DE5\u56DE\u7B54\uFF0C\u4E0D\u627F\u8BFA\u65B9\u5757\u957F\u5EA6";
        if (call.level === base && major3(call.strain)) return `Stayman\u7B54\u53EB\uFF1A4+\u5F20${call.strain}\uFF1B\u4EBA\u5DE5\u8BE2\u95EE\u7684\u81EA\u7136\u9AD8\u82B1\u56DE\u7B54\uFF0C\u4E0D\u627F\u8BFA\u4E94\u5F20\u5957`;
        return `\u975E\u7EA6\u5B9AStayman\u7B54\u53EB${call.level}${call.strain}\uFF1A\u672C\u5361\u8981\u6C42${base}D\u3001${base}H\u6216${base}S\u56DE\u7B54\uFF1B\u4E0D\u80FD\u7528\u81EA\u7136\u6210\u5C40\u8BF4\u660E\u4EE3\u66FF\u5C1A\u672A\u56DE\u7B54\u7684\u4EBA\u5DE5\u8BE2\u95EE`;
      }
      if (ntResponse.call.level === base && (ntResponse.call.strain === "D" || ntResponse.call.strain === "H")) {
        const target = ntResponse.call.strain === "D" ? "H" : "S";
        if (call.level === base && call.strain === target) return `Jacoby\u8F6C\u79FB\u63A5\u53D7\uFF1A\u6309\u8981\u6C42\u53EB${call.level}${call.strain}\uFF0C\u901A\u5E38\u53EA\u4FDD\u8BC12+\u5F20\u652F\u6301\uFF1B\u4E0D\u8868\u793A\u81EA\u5DF1\u6301\u4E94\u5F20\u6216\u516D\u5F20\u5957`;
        return `\u975E\u7EA6\u5B9A\u8F6C\u79FB\u7B54\u53EB${call.level}${call.strain}\uFF1A\u672C\u5361\u8981\u6C42\u63A5\u53D7\u5230${base}${target}\uFF1B\u6B64\u5904\u672A\u7EA6\u5B9A\u8D85\u63A5\u53D7\u6216\u5176\u4ED6\u7B54\u53EB\u7684\u70B9\u529B\u3001\u957F\u5EA6\u6216\u6EE1\u8D2F\u542B\u4E49\uFF0C\u4E0D\u80FD\u76F4\u63A5\u5F53\u6210\u81EA\u7136\u516D\u5F20\u5957`;
      }
    }
    if (ntUs.length === 3 && seat !== ntOpening.seat && ntResponse?.call.level === base && (ntResponse.call.strain === "D" || ntResponse.call.strain === "H")) {
      const target = ntResponse.call.strain === "D" ? "H" : "S";
      if (major3(call.strain) && call.strain !== target && call.level >= 3)
        return `\u8F6C\u79FB\u540E\u81EA\u7136\u7B2C\u4E8C\u9AD8\u82B1${call.level}${call.strain}\uFF1A5+\u5F20${call.strain}\u53CA\u6B64\u524D\u8F6C\u79FB\u6240\u793A\u76845+\u5F20${target}\uFF0C\u663E\u793A\u53CC\u9AD8\u82B1\u5E76\u5EFA\u7ACB\u8FDB\u5C40\u903C\u53EB\uFF1B\u4E0D\u662F\u5F31\u724C\u9003\u53EB\uFF0C\u4E5F\u4E0D\u628A\u8F6C\u79FB\u63A5\u53D7\u5F53\u6210\u540C\u4F34\u4E94\u5F20\u5957`;
      if (call.strain === "NT" && call.level === 3) return `\u8F6C\u79FB\u540E\u76843NT\uFF1A5+\u5F20${target}\u53CA\u6210\u5C40\u5B9E\u529B\uFF0C\u8BA9\u65E0\u5C06\u5F00\u53EB\u4EBA\u67093+\u5F20\u652F\u6301\u65F6\u9009\u62E94${target}`;
      if (call.strain === "NT" && call.level === 2) return `\u8F6C\u79FB\u540E\u76842NT\uFF1A5+\u5F20${target}\u53CA\u9080\u8BF7\u5B9E\u529B\uFF0C\u4E0D\u662F20\u201321\u70B9\u7684\u65E0\u5C06\u5F00\u53EB`;
      if (call.strain === target && call.level === 3) return `\u8F6C\u79FB\u540E\u76843${target}\uFF1A6+\u5F20\u957F\u9AD8\u82B1\uFF0C\u9080\u8BF7\u8FDB\u5C40`;
      if (call.strain === target && call.level === 4) return `\u8F6C\u79FB\u540E\u76844${target}\uFF1A6+\u5F20\u957F\u9AD8\u82B1\u53CA\u6210\u5C40\u5B9E\u529B\uFF0C\u7B7E\u7EA6\u6B62\u53EB`;
    }
    if (ntUs.length >= 4 && seat === ntOpening.seat && (partner?.call.level === 2 || partner?.call.level === 3) && partner.call.strain === "NT" && ntResponse && (ntResponse.call.strain === "D" || ntResponse.call.strain === "H") && call.level === 4 && call.strain === (ntResponse.call.strain === "D" ? "H" : "S")) return `\u8F6C\u79FB\u540E\u7531${partner.call.level}NT\u6539\u53EB4${call.strain}\uFF1A3+\u5F20\u652F\u6301\u642D\u6863\u5DF2\u793A\u7684\u4E94\u5F20\u9AD8\u82B1\uFF0C${partner.call.level === 2 ? "\u63A5\u53D7\u9080\u8BF7\u5E76" : ""}\u9009\u62E9\u5DF2\u77E5\u516B\u5F20\u914D\u5408\uFF1B\u4E0D\u989D\u5916\u627F\u8BFA\u516D\u5F20\u5957`;
    if (ntOpening.call.level === 1 && ntUs.length === 3 && seat !== ntOpening.seat && ntResponse?.call.strain === "C" && ntResponse.call.level === base && ntUs[2].call.level === base && major3(ntUs[2].call.strain) && major3(call.strain) && call.strain !== ntUs[2].call.strain)
      return call.level === base ? `Stayman\u7B54\u53EB\u540E\u53E6\u4E00\u9AD8\u82B1${call.level}${call.strain}\u9080\u8BF7\uFF1A4+\u5F20\u6240\u53EB\u9AD8\u82B1\uFF0C\u4ECD\u5BFB\u627E\u540C\u4F34\u56DB\u5F20\u914D\u5408\uFF1B\u4E0D\u662F\u4E94\u5F20\u65B0\u5957\u6216Jacoby\u8F6C\u79FB\uFF0C\u672A\u5EFA\u7ACB\u8FDB\u5C40\u903C\u53EB` : `Stayman\u7B54\u53EB\u540E\u53E6\u4E00\u9AD8\u82B1${call.level}${call.strain}\uFF1A\u672C\u5361\u4EC5\u7EA6\u5B9A\u6700\u4F4E\u4E8C\u9636\u56DB\u5F20\u9AD8\u82B1\u9080\u8BF7\uFF1B\u6B64\u8DF3\u7EA7\u7EED\u53EB\u672A\u7EA6\u5B9A\u56FA\u5B9A\u957F\u5EA6\u6216\u70B9\u529B\uFF0C\u4E0D\u80FD\u81EA\u52A8\u5F53\u4F5C\u4E94\u5F20\u81EA\u7136\u65B0\u5957`;
  }
  if (clean && us.length === 3 && seat !== opening.seat && call.level >= 2 && call.strain !== "NT" && (/* @__PURE__ */ new Set([...us.map((entry) => entry.call.strain), call.strain])).size === 4 && us.every((entry) => entry.call.strain !== "NT")) return `\u7B2C\u56DB\u82B1\u8272\u903C\u53EB\uFF1A\u4EBA\u5DE5\u8BE2\u95EE\u6B62\u5F20\u3001\u652F\u6301\u6216\u989D\u5916\u724C\u578B\uFF0C\u4E0D\u627F\u8BFA\u6240\u53EB\u82B1\u8272\u957F\u5EA6\uFF1B\u81F3\u5C11\u903C\u53EB\u4E00\u8F6E${analyzeAuctionSemantics(auction, seat, system).forcing === "game" ? "\uFF0C\u539F\u6709\u8FDB\u5C40\u903C\u53EB\u7EE7\u7EED" : "\uFF0C\u672C\u53EB\u54C1\u672C\u8EAB\u4E0D\u7B49\u4E8E\u6B64\u524D\u5DF2\u5EFA\u7ACB\u4E8C\u76D6\u4E00\u903C\u5C40"}`;
  if (system === "sayc" && genuine && opening.call.strain === "NT" && lastOpponent && lastOpponent.index > opening.index && us.length === 1 && seat !== opening.seat && call.strain === lastOpponent.call.strain) return "\u65E0\u5C06\u5F00\u53EB\u53D7\u4E89\u53EB\u540E\u7684\u903C\u5C40\u6263\u53EB\uFF1A10+ HCP\uFF0C\u8BE2\u95EE\u56DB\u5F20\u9AD8\u82B1\u53CA\u654C\u5957\u6B62\u5F20\uFF1B\u4E0D\u627F\u8BFA\u654C\u65B9\u82B1\u8272\u957F\u5EA6\uFF0C\u8981\u6C42\u7EE7\u7EED\u63CF\u8FF0";
  if (system === "sayc" && genuine && opening.call.strain === "NT" && us[1] && all.some((entry) => sideOf(entry.seat) !== sideOf(seat) && entry.index < us[1].index && entry.call.strain === us[1].call.strain) && seat === opening.seat && call.strain !== "NT" && major3(call.strain))
    return `\u65E0\u5C06\u7ADE\u4E89\u6263\u53EB\u540E\u7684\u9AD8\u82B1\u7B54\u53EB\uFF1A4+\u5F20${call.strain}\uFF1B\u7EE7\u7EED\u5BFB\u627E\u9AD8\u82B1\u914D\u5408\uFF0C\u4E0D\u627F\u8BFA\u4E94\u5F20\u5957`;
  if (clean && system !== "sayc" && us.length === 3 && opening.call.level === 1 && !major3(opening.call.strain) && us[1].call.level === 1 && major3(us[1].call.strain) && us[2].call.strain === "NT" && us[2].call.level === 1 && call.level === 2 && (call.strain === "C" || call.strain === "D") && call.strain !== opening.call.strain) return "\u65B0\u4F4E\u82B1\u903C\u53EB\uFF1A\u4EBA\u5DE5\u8BE2\u95EE\u9AD8\u82B1\u652F\u6301\u6216\u53E6\u4E00\u9AD8\u82B1\uFF1B\u4E0D\u627F\u8BFA\u65B0\u4F4E\u82B1\u957F\u5EA6";
  if (genuine && opening.call.level === 2 && opening.call.strain !== "C" && opening.call.strain !== "NT") {
    if (us.length === 1 && seat !== opening.seat && call.level === 2 && call.strain === "NT") return "\u5F31\u4E8C\u540E\u76842NT\u7279\u5F81\u95EE\u53EB\uFF1A\u901A\u5E3815+ HCP\uFF0C\u903C\u53EB\u4E00\u8F6E\uFF1B\u8BE2\u95EE\u6700\u9AD8\u9650\u53CA\u65C1\u95E8A/K\uFF0C\u4E0D\u662F\u81EA\u7136\u5747\u578B\u5B9A\u91CF\u53EB";
    if (us.length === 2 && seat === opening.seat && us[1].call.strain === "NT" && us[1].call.level === 2) return call.strain === opening.call.strain ? "\u5F31\u4E8C\u7279\u5F81\u95EE\u53EB\u7B54\u53EB\uFF1A\u6700\u4F4E\u9650\u6216\u6CA1\u6709\u53EF\u663E\u793A\u7684\u65C1\u95E8A/K\uFF0C\u56DE\u5230\u539F\u957F\u5957\uFF1B\u4E0D\u589E\u52A0\u5957\u957F\u627F\u8BFA" : `\u5F31\u4E8C\u7279\u5F81\u95EE\u53EB\u7B54\u53EB\uFF1A\u6700\u9AD8\u9650\u5E76\u663E\u793A${call.strain}A\u6216K\uFF1B\u4E0D\u627F\u8BFA\u65C1\u95E8\u56DB\u5F20\u5957`;
    if (us.length === 1 && seat !== opening.seat && call.strain !== "NT" && call.strain !== opening.call.strain) return "\u5F31\u4E8C\u540E\u7684\u65B0\u82B1\u8272\u5E94\u53EB\uFF1A13+ HCP\u30015+\u5F20\u81EA\u7136\u5957\uFF0C\u903C\u53EB\u4E00\u8F6E\uFF1B\u6709\u4E89\u53EB\u65F6\u4ECD\u4E0D\u5F97\u65E0\u6545Pass";
    if (seat === opening.seat && call.strain === opening.call.strain && us.length === 2 && us[1].call.strain === opening.call.strain)
      return `\u5F31\u4E8C\u666E\u901A\u52A0\u53EB\u540E\u7684${call.level}${call.strain}\u9009\u62E9\uFF1A\u539F\u5F31\u4E8C\u4ECD\u4E3A6+\u5F20\uFF1B\u540C\u4F34\u52A0\u53EB\u662F\u7ADE\u4E89\u6027\u6216\u5EF6\u957F\u963B\u51FB\u3001\u4E0D\u6784\u6210\u6B63\u5E38\u9080\u8BF7\uFF0C\u672C\u6B21\u4E0D\u5E94\u89E3\u91CA\u4E3A\u63A5\u53D7\u9650\u5236\u6027\u9080\u8BF7\uFF1B\u4E0D\u903C\u53EB`;
  }
  if (genuine && system === "sayc" && us.length === 1 && opening?.seat === partnerOf(seat) && opening.call.level === 3 && opening.call.strain !== "NT" && call.strain !== "NT" && call.strain !== opening.call.strain) return "\u540C\u4F34\u4E09\u9636\u963B\u51FB\u540E\u7684\u65B0\u82B1\u8272\uFF1A15+ HCP\u30015+\u5F20\uFF0C\u903C\u53EB\u4E00\u8F6E\uFF1B\u963B\u51FB\u65B9\u5FC5\u987B\u63CF\u8FF0\u914D\u5408\u6216\u56DE\u53EB\u539F\u5957";
  if (genuine && opening?.call.level === 2 && opening.call.strain !== "NT" && opening.call.strain !== "C" && us.length === 1 && opening.seat !== seat && call.level === 3 && call.strain === opening.call.strain)
    return "\u5F31\u4E8C\u540E\u7684\u4E09\u9636\u52A0\u53EB\uFF1A\u901A\u5E383+\u5F20\u652F\u6301\uFF0C\u7ADE\u4E89\u6027\u6216\u963B\u51FB\u6027\u5EF6\u957F\uFF1B\u4E0D\u903C\u53EB\uFF0C\u4E5F\u4E0D\u662F\u6B63\u5E38\u7684\u4E00\u9636\u5F00\u53EB\u540E\u9650\u5236\u6027\u9080\u8BF7";
  if (system === "sayc" && !genuine && us.length === 1 && opening?.seat === partnerOf(seat) && opening.call.strain !== "NT" && call.strain === opening.call.strain && call.level > opening.call.level && enemyBase?.call.level === 1 && enemyBase.call.strain !== "NT" && !auction.some((entry, index) => sideOf(entry.seat) === sideOf(seat) && isTakeoutDoubleAt(auction, index)) && bidValue(opening.call) - bidValue(all.findLast((entry) => entry.index < opening.index).call) > 5)
    return `\u5F31\u8DF3\u4E89\u53EB\u540E\u7684${call.level}${call.strain}\u52A0\u53EB\uFF1A\u6309\u540C\u4F34\u963B\u51FB\u957F\u5957\u53CA\u652F\u6301\u5EF6\u957F\u963B\u51FB\u6216\u9009\u62E9\u5B9A\u7EA6\uFF1B\u4E0D\u903C\u53EB\uFF0C\u4E0D\u662F\u666E\u901A\u5F00\u53EB\u540E\u7684\u9650\u5236\u6027\u9080\u8BF7`;
  if (genuine && system === "sayc" && opening?.seat === seat && opening.call.level === 3 && us[1]?.call.strain !== "NT" && us[1]?.call.strain !== opening.call.strain && call.level === 4 && call.strain === opening.call.strain) return "\u4E09\u9636\u963B\u51FB\u65B9\u5BF9\u65B0\u82B1\u8272\u903C\u53EB\u7684\u6700\u4F4E\u518D\u53EB\uFF1A\u65E0\u5E94\u53EB\u82B1\u8272\u914D\u5408\uFF0C\u56DE\u5230\u539F\u957F\u5957";
  if (genuine && system === "sayc" && opening?.seat !== seat && opening?.call.level === 3 && us[1]?.seat === seat && us[1].call.strain === call.strain && major3(call.strain) && call.level === 4)
    return "\u4E09\u9636\u963B\u51FB\u540E\u7684\u5F3A\u5E94\u53EB\u4EBA\u7EE7\u7EED\u9009\u62E9\u81EA\u5DF1\u7684\u9AD8\u82B1\u6210\u5C40\uFF1A\u539F\u65B0\u82B1\u8272\u5E94\u53EB\u5DF2\u663E\u793A\u5B9E\u529B\uFF1B\u4E0D\u662F\u5BF9\u540C\u4F34\u963B\u51FB\u4F4E\u82B1\u7684\u52A0\u53EB";
  if (system === "sayc" && us.length === 1 && opening?.seat === partnerOf(seat) && opening.call.level === 1 && lastOpponent?.call.level === 3 && lastOpponent.index > opening.index) {
    if (call.level === 3 && call.strain === "NT") return "\u4E09\u9636\u963B\u51FB\u540E\u7684\u81EA\u71363NT\uFF1A12+ HCP\u3001\u5747\u578B\u6216\u534A\u5747\u578B\uFF0C\u5E76\u6709\u654C\u65B9\u82B1\u8272\u6B62\u5F20\uFF1B\u8FDB\u5C40\u903C\u53EB";
    if (call.strain === lastOpponent.call.strain) return "\u4E09\u9636\u963B\u51FB\u540E\u7684\u903C\u53EB\u6263\u53EB\uFF1A\u6709\u8FDB\u5C40\u5B9E\u529B\uFF0C\u8981\u6C42\u5F00\u53EB\u4EBA\u7EE7\u7EED\u63CF\u8FF0\u724C\u60C5";
  }
  if (system === "sayc" && opening?.seat === seat && opening.call.level === 1 && (opening.call.strain === "C" || opening.call.strain === "D") && us[1]?.call.level === 3 && us[1].call.strain === "NT" && call.level === 4 && call.strain === opening.call.strain) return "\u4E09\u9636\u963B\u51FB\u540E3NT\u5E94\u53EB\u4E4B\u4E0A\u7684\u81EA\u7136\u4F4E\u82B1\u6EE1\u8D2F\u5C1D\u8BD5\uFF1A16+ HCP\u30016+\u5F20\u5F00\u53EB\u4F4E\u82B1";
  const competitiveOpening = all[0];
  const partnerConvention = all.length === 2 && all[1]?.seat === partnerOf(seat) && all[1].index === all[0].index + 1 ? all[1] : void 0;
  if (system === "sayc" && competitiveOpening && partnerConvention && sideOf(competitiveOpening.seat) !== sideOf(seat) && competitiveOpening.call.level === 1 && competitiveOpening.call.strain !== "NT" && partnerConvention.call.level === 2) {
    const michaels = partnerConvention.call.strain === competitiveOpening.call.strain;
    if (michaels && !major3(competitiveOpening.call.strain) && major3(call.strain)) return "Michaels\u5E94\u53EB\uFF1A\u9009\u62E9\u540C\u4F34\u5DF2\u663E\u793A\u7684\u9AD8\u82B1\uFF1B\u4EBA\u5DE5\u6263\u53EB\u88AB\u52A0\u500D\u540E\u4ECD\u4E0D\u5F97Pass";
    if (michaels && major3(competitiveOpening.call.strain)) {
      const shownMajor = competitiveOpening.call.strain === "H" ? "S" : "H";
      if (call.strain === shownMajor) return "Michaels\u5E94\u53EB\uFF1A\u9009\u62E9\u540C\u4F34\u5DF2\u663E\u793A\u7684\u53E6\u4E00\u9AD8\u82B1\uFF1B\u4EBA\u5DE5\u6263\u53EB\u88AB\u52A0\u500D\u540E\u4ECD\u4E0D\u5F97Pass";
      if (call.strain === "NT") return "Michaels 2NT\u8BE2\u95EE\uFF1A\u6CA1\u6709\u4E09\u5F20\u53E6\u4E00\u9AD8\u82B1\uFF0C\u8981\u6C42\u540C\u4F34\u8BF4\u660E\u672A\u660E\u786E\u7684\u4F4E\u82B1\uFF1B\u4EBA\u5DE5\u6263\u53EB\u88AB\u52A0\u500D\u540E\u4ECD\u4E0D\u5F97Pass";
    }
    if (partnerConvention.call.strain === "NT") {
      const shown = SUITS.filter((suit) => suit !== competitiveOpening.call.strain).slice(0, 2);
      if (call.strain !== "NT" && shown.includes(call.strain)) return "Unusual 2NT\u5E94\u53EB\uFF1A\u5728\u540C\u4F34\u663E\u793A\u7684\u4E24\u95E8\u6700\u4F4E\u672A\u53EB\u82B1\u8272\u4E2D\u4F5C\u51FA\u9009\u62E9\uFF1B\u4EBA\u5DE52NT\u88AB\u52A0\u500D\u540E\u4ECD\u4E0D\u5F97Pass";
    }
  }
  const partnerDouble = auction.findLast((entry, index) => entry.seat === partnerOf(seat) && isTakeoutDoubleAt(auction, index));
  const ownDouble = auction.findLast((entry, index) => entry.seat === seat && isTakeoutDoubleAt(auction, index));
  const enemyOpening = all[0] && sideOf(all[0].seat) !== sideOf(seat) ? all[0] : void 0;
  const negativeResponse = genuine && opening?.seat === seat && opening.call.level === 1 && opening.call.strain !== "NT" && us.length === 1 && auction[opening.index + 1]?.call.kind === "bid" && auction[opening.index + 1].call.strain !== "NT" && auction[opening.index + 1].call.level <= 2 && auction[opening.index + 2]?.seat === partnerOf(seat) && auction[opening.index + 2]?.call.kind === "double" && classifyDoubleAt(auction, opening.index + 2, system) === "negative";
  if (system === "sayc" && negativeResponse && call.strain !== "NT") {
    const jump = bidValue(call) - bidValue(all.at(-1).call) > 5;
    if (jump && call.strain === opening.call.strain)
      return `\u8D1F\u52A0\u500D\u521D\u7B54\u4E2D\u7684\u539F\u5957\u5F3A\u8DF3\u518D\u53EB\uFF1A16\u201320 HCP\u30016+\u5F20${call.strain}\uFF0C\u9080\u8BF7\u6216\u76F4\u63A5\u9009\u62E9\u6210\u5C40\uFF1B\u4E0D\u662F\u6700\u4F4E\u56DE\u5957\uFF0C\u4E0D\u56E0\u8D1F\u52A0\u500D\u672C\u8EAB\u628A\u666E\u901A\u4E00\u8F6E\u903C\u53EB\u7EE7\u7EED\u7B97\u5230\u4E0B\u4E00\u8F6E`;
    if (jump && major3(call.strain))
      return atGame2(call) ? `\u8D1F\u52A0\u500D\u540E\u7684\u9AD8\u82B1\u6210\u5C40\u7B54\u53EB\uFF1A4+\u5F20${call.strain}\u652F\u6301\u540C\u4F34\u5DF2\u8BE2\u95EE\u7684\u672A\u53EB\u9AD8\u82B1\uFF1B\u6309\u5DF2\u786E\u8BA4\u914D\u5408\u7684\u8C03\u6574\u652F\u6301\u70B9\u9009\u62E9\u6210\u5C40\uFF0C\u4E0D\u673A\u68B0\u5957\u7528\u4E09\u9636\u9080\u8BF7\u768416\u201318\u70B9\u8303\u56F4` : `\u8D1F\u52A0\u500D\u540E\u7684\u9AD8\u82B1\u5F3A\u8DF3\u7B54\u53EB\uFF1A16\u201318\u8C03\u6574\u652F\u6301\u70B9\u30014+\u5F20${call.strain}\uFF0C\u652F\u6301\u540C\u4F34\u5DF2\u8BE2\u95EE\u7684\u672A\u53EB\u9AD8\u82B1\uFF1B\u77ED\u95E8\u53CA\u989D\u5916\u5C06\u724C\u53EF\u589E\u503C\uFF0C\u4E0D\u8981\u6C42\u539F\u59CBHCP\u8FBE\u523016\uFF0C\u4E0D\u662F\u81EA\u5DF1\u7684\u516D\u5F20\u539F\u5957\uFF0C\u4E5F\u4E0D\u662F\u6700\u4F4E\u7B54\u53EB`;
    if (major3(call.strain) && call.strain !== opening.call.strain)
      return `\u8D1F\u52A0\u500D\u540E\u7684\u9AD8\u82B1\u7B54\u53EB\uFF1A4+\u5F20${call.strain}\uFF1B\u5C55\u793A\u540C\u4F34\u8BE2\u95EE\u7684\u672A\u53EB\u9AD8\u82B1\uFF0C\u9636\u6570\u533A\u522B\u6700\u4F4E\u9650\u4E0E\u989D\u5916\u5B9E\u529B\uFF0C\u4E0D\u4FDD\u8BC1\u4E94\u5F20\u5957`;
    return call.strain === opening.call.strain ? `\u8D1F\u52A0\u500D\u540E\u518D\u53EB\u5F00\u53EB\u5957${call.strain}\uFF1A\u672A\u627E\u5230\u5408\u9002\u9AD8\u82B1\u6216\u65E0\u5C06\uFF1B\u6700\u4F4E\u56DE\u53EB\u4E0D\u989D\u5916\u4FDD\u8BC1\u516D\u5F20\u5957` : `\u8D1F\u52A0\u500D\u540E\u81EA\u7136\u7B2C\u4E8C\u5957${call.strain}\uFF1A\u901A\u5E384+\u5F20\uFF0C\u7EE7\u7EED\u63CF\u8FF0\u724C\u578B\uFF1B\u4E0D\u662F\u4E94\u5F20\u9AD8\u82B1\u4E89\u53EB`;
  }
  const currentConvention = analyzeAuctionSemantics(auction, seat, system).convention;
  if (system === "sayc" && currentConvention === "michaels-inquiry" && (call.strain === "C" || call.strain === "D"))
    return `Michaels 2NT\u8BE2\u95EE\u540E\u7684\u4F4E\u82B1\u7B54\u53EB\uFF1A\u663E\u793A5+\u5F20${call.strain}\u53CA\u6B64\u524D\u5DF2\u793A\u76845+\u5F20\u53E6\u4E00\u9AD8\u82B1\uFF1B\u81EA\u7136\u56DE\u7B54\u672A\u660E\u786E\u4F4E\u82B1\uFF0C\u4E0D\u662F\u9996\u6B21\u4E89\u53EB\u6216\u672A\u7EA6\u5B9A\u7684\u665A\u671F\u65B0\u5957\uFF0C\u5DF2\u5C65\u884C\u672C\u8F6E\u7B54\u53EB\u4E49\u52A1`;
  if (system === "sayc" && analyzeAuctionSemantics(following, partnerOf(seat), system).convention === "overcall-cue" && call.strain === enemyOpening?.call.strain)
    return "\u81EA\u7136\u4E89\u53EB\u540E\u7684\u652F\u6301\u6027\u6263\u53EB\uFF1A\u901A\u5E3810+ HCP\u53CA3+\u5F20\u4E89\u53EB\u5957\u652F\u6301\uFF0C\u4EBA\u5DE5\u903C\u53EB\u4E00\u8F6E\uFF1B\u654C\u65B9\u518D\u52A0\u53EB\u540E\u4ECD\u53EF\u4F7F\u7528\uFF0C\u4E0D\u627F\u8BFA\u654C\u65B9\u82B1\u8272\u957F\u5EA6";
  if (system === "sayc" && (currentConvention === "weak-jump-inquiry" || analyzeAuctionSemantics(following, partnerOf(seat), system).convention === "weak-jump-inquiry"))
    return us.length === 1 && call.strain === "NT" ? "\u5F31\u8DF3\u4E89\u53EB\u540E2NT\u7279\u5F81\u95EE\u53EB\uFF1A\u4EBA\u5DE5\u903C\u53EB\u4E00\u8F6E\uFF0C\u8BE2\u95EE\u9AD8\u4F4E\u9650\u53CA\u65C1\u95E8A/K\uFF1B\u4E0D\u4FDD\u8BC1\u654C\u65B9\u82B1\u8272\u6B62\u5F20" : us.length === 2 ? call.strain === us[0].call.strain ? "\u5F31\u8DF3\u4E89\u53EB\u540E2NT\u95EE\u53EB\u7684\u6700\u4F4E\u56DE\u5957\uFF1A5\u20138 HCP\uFF0C\u672A\u663E\u793A\u65C1\u95E8\u7279\u5F81\uFF1B\u56DE\u5230\u539F\u516D\u5F20\u957F\u5957" : "\u5F31\u8DF3\u4E89\u53EB\u540E2NT\u95EE\u53EB\u7684\u7279\u5F81\u7B54\u53EB\uFF1A9\u201311 HCP\u53CA\u6240\u53EB\u65C1\u95E8A/K\uFF1B\u4E0D\u4FDD\u8BC1\u8BE5\u65C1\u95E8\u56DB\u5F20\u6216\u4E94\u5F20\u957F\u5EA6" : "\u5F31\u8DF3\u4E89\u53EB\u7279\u5F81\u95EE\u53EB\u540E\u7684\u5B9A\u7EA6\u9009\u62E9\uFF1A\u7ED3\u5408\u5DF2\u516C\u5F00\u9AD8\u4F4E\u9650\u4E0E\u516D\u5F20\u539F\u5957\uFF1B\u4E0D\u5C06\u7279\u5F81\u82B1\u8272\u5F53\u6210\u957F\u5957";
  if (system === "sayc" && currentConvention === "unusual-advance" && call.strain !== "NT")
    return "Unusual 2NT\u5E94\u53EB\uFF1A\u9009\u62E9\u540C\u4F34\u516C\u5F00\u7684\u53CC\u4F4E\u82B1\u4E4B\u4E00\uFF0C\u901A\u5E38\u53EA\u9700\u4E09\u5F20\u652F\u6301\uFF1B\u4E0D\u662F\u4E94\u5F20\u81EA\u7136\u4E89\u53EB";
  if (system === "sayc" && currentConvention === "overcall-cue" && call.strain !== "NT")
    return call.strain === us[0]?.call.strain ? "\u652F\u6301\u6027\u6263\u53EB\u540E\u56DE\u5230\u81EA\u7136\u4E89\u53EB\u5957\uFF1A\u539F\u4E89\u53EB5+\u5F20\uFF1B\u6700\u4F4E\u56DE\u53EB\u4E0D\u989D\u5916\u4FDD\u8BC1\u516D\u5F20\uFF0C\u8DF3\u56DE\u53EB\u8868\u793A\u989D\u5916\u5B9E\u529B" : `\u652F\u6301\u6027\u6263\u53EB\u540E\u63CF\u8FF0\u81EA\u7136\u7B2C\u4E8C\u5957${call.strain}\uFF1A\u901A\u5E384+\u5F20\uFF0C\u539F\u4E89\u53EB\u5957\u4ECD\u4E3A5+\u5F20\uFF1B\u4E0D\u662F\u9996\u6B21\u4E94\u5F20\u4E89\u53EB`;
  if (system === "sayc" && genuine && opening?.call.level === 1 && opening.call.strain !== "NT" && opening.seat === seat && call.strain === "NT" && auction.some((entry) => entry.seat === partnerOf(seat) && entry.call.kind === "double")) {
    const inferred = noTrumpRangeAt(following, auction.length, system);
    if (inferred) return `\u8D1F\u52A0\u500D\u540E\u7684\u81EA\u7136\u65E0\u5C06\u7B54\u53EB\uFF1A${inferred.min}\u2013${inferred.max} HCP\uFF0C\u5747\u578B\u6216\u9002\u5408\u65E0\u5C06\u4E14\u654C\u65B9\u82B1\u8272\u6709\u6B62\u5F20\uFF1B${inferred.min < 18 && call.level === 2 ? "\u88AB\u8FEB\u5728\u4E8C\u9636\u56DE\u7B54\uFF0C\u4E0D\u662F18\u201319\u70B9\u7684\u8DF3\u518D\u53EB" : "\u9636\u6570\u7ED3\u5408\u53EF\u7528\u7A7A\u95F4\u63CF\u8FF0\u5B9E\u529B"}`;
  }
  if (system === "sayc" && enemyOpening && ownDouble && own.length === 0 && call.strain === "NT") {
    if (call.level === 3 && partner?.call.strain === "NT" && !isArtificialBidAt(auction, partner.index, system))
      return `\u6280\u672F\u6027\u52A0\u500D\u540E\u9009\u62E93NT\uFF1A\u63A5\u53D7\u540C\u4F34\u81EA\u7136\u65E0\u5C06\u5E94\u53EB\u6240\u793A\u7684\u9080\u8BF7\u6216\u6210\u5C40\u5B9E\u529B\uFF1B\u6309\u539F\u6280\u672FX\u8303\u56F4\u7ED3\u5408\u8054\u624B\u70B9\u529B\u4E0E\u53EF\u5151\u73B0\u8D62\u58A9\u5224\u65AD\uFF0C\u4E0D\u989D\u5916\u627F\u8BFA18+ HCP\u6216\u5747\u578B\uFF0C\u53EF\u4F9D\u8D56\u540C\u4F34\u5DF2\u516C\u5F00\u7684\u654C\u5957\u6B62\u5F20`;
    if (currentConvention === "takeout-cue") return `\u6280\u672F\u6027\u52A0\u500D\u540E\u56DE\u7B54\u540C\u4F34\u5F3A\u6263\u53EB\u7684\u81EA\u7136${call.level}NT\uFF1A\u9002\u5408\u65E0\u5C06\u4E14\u654C\u5957\u6709\u6B62\u5F20\uFF1B\u539F\u6280\u672FX\u901A\u5E38${enemyOpening.call.level >= 3 ? "15+" : enemyOpening.call.level === 2 ? "13+" : "12+"} HCP\uFF0C\u88AB\u8FEB\u7B54\u53EB\u4E0D\u81EA\u52A8\u663E\u793A18\u201320\u621621\u201322\uFF0C\u672C\u5361\u672A\u8FDB\u4E00\u6B65\u5212\u5206\u6B64\u7B54\u53EB\u7684\u70B9\u529B\u8303\u56F4`;
    const inferred = noTrumpRangeAt(following, auction.length, system);
    return `\u6280\u672F\u6027\u52A0\u500D\u540E\u7684\u5F3A\u724C\u65E0\u5C06\u518D\u53EB\uFF1A${inferred ? `${inferred.min}\u2013${inferred.max}` : "18+"} HCP\uFF0C\u5747\u578B\u4E14\u654C\u65B9\u82B1\u8272\u6709\u6B62\u5F20\uFF1B\u4E0D\u662F\u5F00\u53EB\u65E0\u5C06\u8303\u56F4`;
  }
  if (system === "sayc" && enemyOpening && ownDouble && own.length === 0 && call.strain !== "NT") {
    if (auction.slice(auction.indexOf(ownDouble) + 1).some((entry) => sideOf(entry.seat) !== sideOf(seat) && entry.call.kind === "redouble"))
      return `\u6280\u672F\u6027\u52A0\u500D\u906D\u5B9E\u529B\u518D\u52A0\u500D\u540E\u7684${call.level}${call.strain}\u9003\u53EB\uFF1A\u81EA\u7136\u9009\u62E9\u53EF\u7528\u82B1\u8272\uFF0C\u901A\u5E384+\u5F20\uFF1B\u4E0D\u903C\u53EB\uFF0C\u4E0D\u81EA\u52A8\u8868\u793A17+\u5F3A\u724C\u518D\u53EB`;
    if (currentConvention === "takeout-cue" && call.strain !== enemyOpening.call.strain)
      return `\u6280\u672F\u6027\u52A0\u500D\u540E\u56DE\u7B54\u540C\u4F34\u7684\u5F3A\u6263\u53EB\uFF1A\u9009\u62E9\u81EA\u7136\u672A\u53EB\u5957${call.strain}\uFF0C\u53D7\u7A7A\u95F4\u5F71\u54CD\u53EF\u4EC5\u4E09\u5F20\uFF0C\u5E76\u4E0D\u989D\u5916\u4FDD\u8BC1\u56DB\u5F20\u6216\u4E94\u5F20\uFF1B\u539F\u6280\u672FX\u901A\u5E38${enemyOpening.call.level >= 3 ? "15+" : enemyOpening.call.level === 2 ? "13+" : "12+"} HCP\uFF0C\u6B64\u5904\u88AB\u8FEB\u63CF\u8FF0\u4E0D\u989D\u5916\u8868\u793A17+\uFF0C\u4E5F\u4E0D\u627F\u8BFA\u540C\u4F34\u6709\u56DB\u5F20${call.strain}\u652F\u6301\uFF1B\u666E\u901A\u4E00\u8F6E\u903C\u53EB\u5DF2\u4F5C\u7B54`;
    if (call.strain === enemyOpening.call.strain) return "\u6280\u672F\u6027\u52A0\u500D\u65B9\u518D\u6263\u654C\u65B9\u82B1\u8272\uFF1A\u4EBA\u5DE5\u5F3A\u724C\u518D\u53EB\uFF0C\u8981\u6C42\u540C\u4F34\u7EE7\u7EED\u63CF\u8FF0\uFF1B\u4E0D\u627F\u8BFA\u6240\u53EB\u654C\u65B9\u82B1\u8272\u957F\u5EA6";
    if (call.strain === partner?.call.strain) return `\u6280\u672F\u6027\u52A0\u500D\u65B9\u52A0\u53EB\u540C\u4F34\u7684${call.strain}\uFF1A\u901A\u5E384+\u5F20\u652F\u6301\uFF1B\u9636\u6570\u533A\u522B\u6700\u4F4E\u9650\u3001\u9080\u8BF7\u4E0E\u6210\u5C40\uFF0C\u4E0D\u662F\u5E94\u53EB\u4EBA\u7684\u9996\u6B21\u5E94\u53EB`;
    return `\u5148\u6280\u672F\u6027\u52A0\u500D\u518D\u53EB\u65B0\u5957${call.strain}\uFF1A\u901A\u5E3817+ HCP\u30015+\u5F20\u81EA\u7136\u957F\u5957\uFF0C\u663E\u793A\u5F3A\u724C\uFF1B\u4E0D\u662F\u666E\u901A\u5F31\u4E89\u53EB`;
  }
  if (system === "sayc" && enemyOpening && partnerDouble && own.length === 0) {
    if (call.strain === enemyOpening.call.strain) return "\u6280\u672F\u6027\u52A0\u500D\u540E\u7684\u6263\u53EB\u5E94\u53EB\uFF1A12+ HCP\uFF0C\u4EBA\u5DE5\u903C\u53EB\u4E00\u8F6E\uFF1B\u8981\u6C42\u52A0\u500D\u65B9\u7EE7\u7EED\u63CF\u8FF0\uFF0C\u4E0D\u627F\u8BFA\u654C\u65B9\u82B1\u8272\u5957";
    if (call.strain === "NT") return call.level === 1 ? "\u6280\u672F\u6027\u52A0\u500D\u540E\u76841NT\u5E94\u53EB\uFF1A6\u201310 HCP\u5747\u578B\uFF0C\u654C\u65B9\u82B1\u8272\u6709\u6B62\u5F20\uFF1B\u4E0D\u903C\u53EB" : call.level === 2 ? "\u6280\u672F\u6027\u52A0\u500D\u540E\u76842NT\u5E94\u53EB\uFF1A11\u201312 HCP\u5747\u578B\u4E14\u6709\u6B62\u5F20\uFF0C\u9080\u8BF7\u8FDB\u5C40" : "\u6280\u672F\u6027\u52A0\u500D\u540E\u76843NT\u5E94\u53EB\uFF1A13\u201315 HCP\u5747\u578B\u4E14\u6709\u6B62\u5F20\uFF0C\u9009\u62E9\u6210\u5C40";
    const low = Array.from({ length: 7 }, (_, n) => bid3(n + 1, call.strain)).find((candidate) => bidValue(candidate) > bidValue(all.at(-1).call));
    if (!analyzeAuctionSemantics(auction, seat, system).mustBid && call.level === low?.level)
      return `\u6280\u672F\u6027\u52A0\u500D\u540E\u5BF9\u624B\u7EE7\u7EED\u53EB\u724C\u65F6\u7684\u81EA\u7531${call.level}${call.strain}\u5E94\u53EB\uFF1A\u901A\u5E386+ HCP\u53CA4+\u5F20\u672A\u53EB\u82B1\u8272\uFF1B\u672C\u53EFPass\uFF0C\u4E0D\u80FD\u5F53\u4F5C0\u70B9\u88AB\u8FEB\u5E94\u53EB\uFF0C\u4E0D\u903C\u53EB`;
    if (call.level >= 4) return call.level === low?.level ? `\u9AD8\u9636\u6280\u672F\u6027\u52A0\u500D\u540E\u7684\u6700\u4F4E${call.level}${call.strain}\u5E94\u53EB\uFF1A\u9009\u62E9\u81EA\u5DF1\u7684\u672A\u53EB\u957F\u5957\uFF08\u901A\u5E384+\u5F20\uFF09\uFF1B${atGame2(call) ? "\u5DF2\u8FBE\u5230\u6210\u5C40\u9636\u6570" : "\u53D7\u5BF9\u624B\u963B\u51FB\u62AC\u9AD8\uFF0C\u4ECD\u53EF\u4F4E\u4E8E\u6210\u5C40"}\uFF0C\u53D7\u7A7A\u95F4\u5F71\u54CD\u7684\u88AB\u8FEB\u6700\u4F4E\u5E94\u53EB\u4E0D\u4FDD\u8BC1\u70B9\u529B` : `\u9AD8\u9636\u6280\u672F\u6027\u52A0\u500D\u540E\u7684\u8DF3\u5E94\u53EB${call.level}${call.strain}\uFF1A\u6700\u4F4E\u53EF\u53EB${low?.level}${call.strain}\u4ECD\u6709\u7A7A\u95F4\uFF0C\u672C\u6B21\u663E\u793A\u989D\u5916\u5B9E\u529B\u53CA4+\u5F20\u672A\u53EB\u82B1\u8272\uFF1B\u901A\u5E389\u201311\u70B9\u4EE5\u4E0A\uFF0C\u6309\u652F\u6301\u70B9\u3001\u5957\u8D28\u4E0E\u6210\u5C40\u9636\u6570\u5224\u65AD\uFF0C\u4E0D\u80FD\u5F53\u4F5C\u96F6\u70B9\u7684\u88AB\u8FEB\u6700\u4F4E\u5E94\u53EB`;
    return call.level === low?.level ? "\u6280\u672F\u6027\u52A0\u500D\u540E\u7684\u6700\u4F4E\u82B1\u8272\u5E94\u53EB\uFF1A\u901A\u5E380\u20138 HCP\uFF0C\u5C3D\u91CF\u9009\u62E9\u56DB\u5F20\u672A\u53EB\u82B1\u8272\uFF1B\u88AB\u8FEB\u5E94\u53EB\u4E0D\u4FDD\u8BC1\u70B9\u529B" : "\u6280\u672F\u6027\u52A0\u500D\u540E\u7684\u8DF3\u5E94\u53EB\uFF1A\u901A\u5E389\u201311 HCP\u30014+\u5F20\u672A\u53EB\u82B1\u8272\uFF0C\u9080\u8BF7\u8FDB\u5C40";
  }
  if (system === "sayc" && enemyOpening && !genuine && opening?.seat === partnerOf(seat) && opening.call.strain !== "NT" && opening.call.strain !== enemyOpening.call.strain && us.length === 1 && call.strain === enemyOpening.call.strain) return "\u81EA\u7136\u4E89\u53EB\u540E\u7684\u652F\u6301\u6027\u6263\u53EB\uFF1A10+ HCP\u30013+\u5F20\u652F\u6301\u4E89\u53EB\u82B1\u8272\uFF0C\u903C\u53EB\u4E00\u8F6E\uFF1B\u4E0D\u627F\u8BFA\u6240\u6263\u654C\u65B9\u82B1\u8272\u957F\u5EA6";
  if (system === "sayc" && !genuine && opening?.call.strain === "NT" && (opening.call.level === 1 || opening.call.level === 2 && enemyOpening && enemyOpening.call.level >= 2) && !auction.slice(opening.index + 1).some((entry) => sideOf(entry.seat) !== sideOf(seat) && entry.call.kind === "bid")) {
    const base = opening.call.level + 1;
    const ntLabel = `${opening.call.level}NT`;
    if (opening.call.level === 1 && us.length === 3 && seat !== opening.seat && us[1].call.level === base && us[1].call.strain === "C" && us[2].call.level === base && major3(us[2].call.strain) && major3(call.strain) && call.strain !== us[2].call.strain)
      return call.level === base ? `${ntLabel}\u4E89\u53EB\u7684Stayman\u7B54\u53EB\u540E\u53E6\u4E00\u9AD8\u82B1${call.level}${call.strain}\u9080\u8BF7\uFF1A4+\u5F20\u6240\u53EB\u9AD8\u82B1\uFF0C\u7EE7\u7EED\u5BFB\u627E\u56DB\u5F20\u914D\u5408\uFF1B\u4E0D\u662F\u4E94\u5F20\u65B0\u5957\u6216\u8F6C\u79FB\uFF0C\u672A\u5EFA\u7ACB\u8FDB\u5C40\u903C\u53EB` : `${ntLabel}\u4E89\u53EB\u7684Stayman\u7B54\u53EB\u540E\u8DF3\u7EA7\u53E6\u4E00\u9AD8\u82B1\uFF1A\u672C\u5361\u672A\u7EA6\u5B9A\u56FA\u5B9A\u957F\u5EA6\u6216\u70B9\u529B\uFF0C\u4E0D\u80FD\u5F53\u4F5C\u4E94\u5F20\u81EA\u7136\u65B0\u5957`;
    if (us.length === 3 && seat !== opening.seat && us[1].call.level === base && (us[1].call.strain === "D" || us[1].call.strain === "H") && major3(call.strain) && call.strain !== (us[1].call.strain === "D" ? "H" : "S") && call.level >= 3)
      return `${ntLabel}\u4E89\u53EB\u7684\u8F6C\u79FB\u540E\u81EA\u7136\u7B2C\u4E8C\u9AD8\u82B1${call.level}${call.strain}\uFF1A5+\u5F20${call.strain}\u53CA\u5DF2\u793A\u76845+\u5F20${us[1].call.strain === "D" ? "H" : "S"}\uFF0C\u53CC\u9AD8\u82B1\u8FDB\u5C40\u903C\u53EB\uFF1B\u4E0D\u662F\u5F31\u724C\u9003\u53EB`;
    if (us.length >= 4 && seat === opening.seat && us[1]?.call.level === base && (us[1].call.strain === "D" || us[1].call.strain === "H") && partner?.call.strain === "NT" && (partner.call.level === 2 || partner.call.level === 3) && call.level === 4 && call.strain === (us[1].call.strain === "D" ? "H" : "S"))
      return `${ntLabel}\u4E89\u53EB\u540E\u7684\u8F6C\u79FB\u8FDB\u5C40\u9009\u62E9\uFF1A3+\u5F20\u652F\u6301\u642D\u6863\u5DF2\u793A\u7684\u4E94\u5F20\u9AD8\u82B1\uFF1B${partner.call.level === 2 ? "\u63A5\u53D7\u9080\u8BF7\uFF0C" : ""}\u9009\u62E9\u5DF2\u77E5\u516B\u5F20\u914D\u5408\uFF0C\u4E0D\u989D\u5916\u627F\u8BFA\u81EA\u5DF1\u7684\u516D\u5F20\u5957`;
    if (us.length === 1 && seat !== opening.seat) {
      if (call.level === base && call.strain === "C") return `${ntLabel}\u4E89\u53EB\u540E\u7684Stayman\uFF1A\u81F3\u5C11\u4E00\u95E8\u56DB\u5F20\u9AD8\u82B1\uFF0C\u903C\u53EB\u4E00\u8F6E\uFF1B\u4E0D\u662F\u81EA\u7136\u6885\u82B1\u9003\u53EB`;
      if (call.level === base && (call.strain === "D" || call.strain === "H")) return `${ntLabel}\u4E89\u53EB\u540E\u7684Jacoby\u8F6C\u79FB\uFF1A5+\u5F20${call.strain === "D" ? "\u7EA2\u5FC3" : "\u9ED1\u6843"}\uFF0C\u8981\u6C42\u540C\u4F34\u63A5\u53D7\u8F6C\u79FB\uFF1B\u4E0D\u627F\u8BFA\u6240\u53EB\u82B1\u8272\u957F\u5EA6`;
      if (base === 2 && call.level === 2 && call.strain === "S") return "1NT\u4E89\u53EB\u540E\u7684\u4F4E\u82B1\u9003\u53EB\uFF1A\u8981\u6C423\u2663\uFF0C\u968F\u540E\u53EFPass\u6216\u65393\u2666\uFF1B\u4EBA\u5DE5\u63A5\u529B\uFF0C\u4E0D\u662F\u81EA\u7136\u9ED1\u6843";
      if (call.strain === "NT") {
        const ntRange = noTrumpRangeAt(auction, opening.index, system);
        const minimum = ntRange?.min ?? 15;
        return call.level === 2 ? `${ntLabel}\u4E89\u53EB\u540E\u7684\u81EA\u71362NT\uFF1A\u901A\u5E38${23 - minimum}\u2013${24 - minimum} HCP\uFF0C\u6309\u5DF2\u516C\u5F00${ntRange ? `${ntRange.min}\u2013${ntRange.max}` : "15\u201318"}\u70B9\u8303\u56F4\u9080\u8BF7\u6210\u5C40` : call.level === 3 ? `${ntLabel}\u4E89\u53EB\u540E\u7684\u81EA\u71363NT\uFF1A\u901A\u5E38${25 - minimum}+ HCP\uFF0C\u6309\u5DF2\u516C\u5F00\u65E0\u5C06\u8303\u56F4\u9009\u62E9\u6210\u5C40` : `${ntLabel}\u4E89\u53EB\u540E\u7684\u81EA\u7136${call.level}NT\uFF1A\u6309\u5DF2\u516C\u5F00\u65E0\u5C06\u8303\u56F4${call.level >= 6 ? "\u9009\u62E9\u65E0\u5C06\u6EE1\u8D2F\u5B9A\u7EA6" : "\u9080\u8BF7\u5927\u6EE1\u8D2F"}\uFF1B\u4E0D\u63093NT\u6210\u5C40\u5E94\u53EB\u89E3\u91CA`;
      }
    }
    if (us.length === 2 && seat === opening.seat) {
      const request = us[1].call;
      if (request.level === base && request.strain === "C") return call.level === base && call.strain === "D" ? `${ntLabel}\u4E89\u53EB\u540E\u7684Stayman\u7B54\u53EB\uFF1A\u5426\u8BA4\u56DB\u5F20\u9AD8\u82B1\uFF1B\u65B9\u5757\u4E3A\u4EBA\u5DE5\u56DE\u7B54` : call.level === base && major3(call.strain) ? `${ntLabel}\u4E89\u53EB\u540E\u7684Stayman\u7B54\u53EB\uFF1A4+\u5F20${call.strain}\uFF0C\u7EE7\u7EED\u5BFB\u627E\u9AD8\u82B1\u914D\u5408` : `\u975E\u7EA6\u5B9AStayman\u7B54\u53EB${call.level}${call.strain}\uFF1A${ntLabel}\u4E89\u53EB\u540E\u987B\u7528${base}D\u3001${base}H\u6216${base}S\u56DE\u7B54\uFF1B\u672A\u7EA6\u5B9A\u5176\u4ED6\u7B54\u53EB\u7684\u957F\u5EA6\u6216\u70B9\u529B`;
      if (request.level === base && (request.strain === "D" || request.strain === "H")) return call.level === base && call.strain === (request.strain === "D" ? "H" : "S") ? `${ntLabel}\u4E89\u53EB\u540E\u7684Jacoby\u8F6C\u79FB\u63A5\u53D7\uFF1A\u4E0D\u989D\u5916\u627F\u8BFA\u4E09\u5F20\u652F\u6301\u6216\u516D\u5F20\u957F\u5957` : `\u975E\u7EA6\u5B9A\u8F6C\u79FB\u7B54\u53EB${call.level}${call.strain}\uFF1A${ntLabel}\u4E89\u53EB\u540E\u987B\u63A5\u53D7\u5230${base}${request.strain === "D" ? "H" : "S"}\uFF1B\u672A\u7EA6\u5B9A\u8D85\u63A5\u53D7\u6216\u5176\u4ED6\u7B54\u53EB\u7684\u70B9\u529B\u3001\u957F\u5EA6`;
      if (base === 2 && request.level === 2 && request.strain === "S") return call.level === 3 && call.strain === "C" ? "\u4F4E\u82B1\u9003\u53EB\u63A5\u529B\u76843\u2663\u7B54\u53EB\uFF1A\u4E0D\u4FDD\u8BC1\u6885\u82B1\u957F\u5EA6\uFF0C\u5141\u8BB8\u540C\u4F34Pass\u6216\u65393\u2666" : `\u975E\u7EA6\u5B9A\u4F4E\u82B1\u9003\u53EB\u63A5\u529B\u7B54\u53EB${call.level}${call.strain}\uFF1A\u672C\u5361\u8981\u6C423\u2663\uFF0C\u672A\u7EA6\u5B9A\u5176\u4ED6\u7B54\u53EB\u7684\u70B9\u529B\u6216\u957F\u5EA6`;
    }
  }
  if (system === "sayc" && !genuine && opening?.call.strain === "NT" && us[1]?.call.level === 2 && us[1].call.strain === "S" && us[2]?.call.level === 3 && us[2].call.strain === "C" && us.length === 3 && us[1].seat === seat && call.level === 3 && call.strain === "D")
    return "\u4F4E\u82B1\u9003\u53EB\u63A5\u529B\u540E\u76843\u2666\u6539\u53EB\uFF1A\u81EA\u7136\u65B9\u5757\u957F\u5957\uFF0C\u9009\u62E9\u90E8\u5206\u5B9A\u7EA6\u3001\u4E0D\u903C\u53EB\uFF1B3\u2663\u63A5\u529B\u5DF2\u7ECF\u56DE\u7B54\uFF0C\u4E0D\u518D\u4FDD\u7559\u4EBA\u5DE5\u5E94\u53EB\u4E49\u52A1";
  if (system === "sayc" && all.length === 1 && enemyOpening && auction.length === enemyOpening.index + 3 && auction.slice(enemyOpening.index + 1).every((entry) => entry.call.kind === "pass") && call.strain === "NT" && call.level === 1) return "\u5E73\u8861\u4F4D1NT\uFF1A11\u201314 HCP\u5747\u578B\uFF0C\u654C\u65B9\u5F00\u53EB\u82B1\u8272\u6709\u6B62\u5F20\uFF1B\u4E0D\u662F\u76F4\u63A515\u201318\u70B9\u76841NT\u4E89\u53EB";
  const opposingOpening = all.length === 1 && sideOf(all[0].seat) !== sideOf(seat) && auction.length === all[0].index + 1 ? all[0] : void 0;
  if (system === "sayc" && opposingOpening?.call.level === 1 && opposingOpening.call.strain === "NT" && call.level === 2 && call.strain === "NT") return "\u5BF91NT\u7684\u53CC\u4F4E\u82B1\u4E89\u53EB\uFF1A5+\u5F20\u6885\u82B1\u53CA5+\u5F20\u65B9\u5757\uFF0C\u4EBA\u5DE5\u53EB\u54C1\uFF1B\u4E0D\u662F\u81EA\u7136\u65E0\u5C06";
  if (system === "sayc" && opposingOpening && opposingOpening.call.level >= 2 && opposingOpening.call.level <= 3 && call.strain === "NT") return `\u5BF9\u963B\u51FB\u7684\u81EA\u7136${call.level}NT\u4E89\u53EB\uFF1A15\u201318 HCP\u3001\u5747\u578B\u53CA\u654C\u65B9\u82B1\u8272\u6B62\u5F20\uFF1B\u540E\u7EEDStayman\u548C\u9AD8\u82B1\u8F6C\u79FB\u7EE7\u7EED\u4F7F\u7528`;
  if (system === "sayc" && opposingOpening && opposingOpening.call.level >= 2 && opposingOpening.call.level <= 3 && opposingOpening.call.strain !== "NT" && call.strain !== "NT" && call.strain !== opposingOpening.call.strain && bidValue(call) - bidValue(opposingOpening.call) <= 5)
    return `\u5BF9\u963B\u51FB\u7684\u9996\u6B21\u81EA\u7136${call.level}${call.strain}\u975E\u8DF3\u4E89\u53EB\uFF1A5+\u5F20\u53EF\u7528\u82B1\u8272\uFF1B\u4E8C\u9636\u901A\u5E3810\u201316 HCP\uFF0C\u66F4\u9AD8\u9636\u9700\u8981\u8DB3\u591F\u5B9E\u529B\u548C\u5957\u8D28\uFF1B\u4E0D\u662F\u5C1A\u672A\u7EA6\u5B9A\u7684\u665A\u671F\u7EED\u53EB`;
  if (system === "sayc" && opposingOpening?.call.level === 1 && opposingOpening.call.strain !== "NT") {
    if (call.level === 2 && call.strain === opposingOpening.call.strain) return major3(call.strain) ? "Michaels\u6263\u53EB\uFF1A5+\u5F20\u53E6\u4E00\u9AD8\u82B1\u53CA5+\u5F20\u672A\u660E\u786E\u4F4E\u82B1" : "Michaels\u6263\u53EB\uFF1A\u4E24\u95E8\u9AD8\u82B1\u54045+\u5F20";
    if (call.level === 2 && call.strain === "NT") return "Unusual 2NT\uFF1A\u4E24\u95E8\u6700\u4F4E\u672A\u53EB\u82B1\u8272\u54045+\u5F20";
    const naturalLevel = call.strain !== "NT" && bidValue(bid3(1, call.strain)) > bidValue(opposingOpening.call) ? 1 : 2;
    if (call.strain !== "NT" && call.level > naturalLevel) return "SAYC\u5F31\u8DF3\u4E89\u53EB\uFF1A\u6309\u540C\u9636\u963B\u51FB\u5F00\u53EB\u7684\u724C\u529B\u3001\u957F\u5EA6\u4E0E\u82B1\u8272\u8D28\u91CF\u5904\u7406";
    if (call.strain === "NT") return "SAYC 1NT\u4E89\u53EB\uFF1A15\u201318 HCP\u5747\u578B\uFF0C\u5E76\u6709\u5F00\u53EB\u82B1\u8272\u6B62\u5F20";
    return naturalLevel === 1 ? "SAYC\u4E00\u9636\u81EA\u7136\u4E89\u53EB\uFF1A5+\u5F20\uFF0C8\u201316 HCP" : "SAYC\u4E8C\u9636\u81EA\u7136\u4E89\u53EB\uFF1A5+\u5F20\uFF0C10\u201316 HCP\uFF1B\u4E0D\u662F\u5F3A2\u2663\u5F00\u53EB";
  }
  if (system === "sayc" && enemyOpening && call.strain !== "NT" && auction.every((entry) => sideOf(entry.seat) !== sideOf(seat) || entry.call.kind === "pass") && !all.some((entry) => entry.call.strain === call.strain && !isArtificialBidAt(auction, entry.index, system))) {
    const lastNaturalBid = all.at(-1);
    const cheapest = Array.from({ length: 7 }, (_, n) => bid3(n + 1, call.strain)).find((candidate) => bidValue(candidate) > bidValue(lastNaturalBid.call));
    const balancing = auction.length === lastNaturalBid.index + 3 && auction.slice(lastNaturalBid.index + 1).every((entry) => entry.call.kind === "pass");
    return call.level === cheapest?.level ? `${balancing ? "\u5E73\u8861\u4F4D" : "\u654C\u65B9\u5F00\u53EB\u6216\u5E94\u53EB\u4E4B\u540E\u7684"}\u9996\u6B21${call.level === 1 ? "\u4E00\u9636" : `${call.level}\u9636`}\u81EA\u7136\u4E89\u53EB\uFF1A5+\u5F20${call.strain}\uFF1B${call.level === 1 ? "\u76F4\u63A5\u4F4D\u901A\u5E388\u201316 HCP" : "\u76F4\u63A5\u4F4D\u901A\u5E3810\u201316 HCP\u53CA\u8F83\u597D\u5957"}${balancing ? "\uFF0C\u5E73\u8861\u4F4D\u53EF\u9002\u5F53\u51CF\u4F4E\u70B9\u529B\u8981\u6C42" : ""}\uFF1B\u672C\u65B9\u6B64\u524D\u4EC5Pass\uFF0C\u4E0D\u662F\u5DF2\u6709\u672C\u65B9\u81EA\u7136\u53EB\u724C\u540E\u7684\u665A\u671F\u7EED\u53EB` : `\u9996\u6B21\u81EA\u7136\u8DF3\u4E89\u53EB${call.level}${call.strain}\uFF1A\u6309\u540C\u9636\u963B\u51FB\u5F00\u53EB\u7684\u5F31\u724C\u70B9\u529B\u3001\u957F\u5EA6\u548C\u5957\u8D28\u5904\u7406\uFF1B\u4E0D\u662F\u672A\u7EA6\u5B9A\u7684\u540E\u7EED\u65B0\u82B1\u8272`;
  }
  if (opening?.call.level === 1 && major3(opening.call.strain) && call.level === 2 && call.strain === opening.call.strain && us.length >= 3 && us[1]?.seat === seat && us[1].call.level === 1 && us[2].call.level === 2 && us[2].call.strain !== opening.call.strain) return "SAYC\u56DE\u53EB\u5F00\u53EB\u9AD8\u82B1\u7684\u5F31\u724C\u504F\u597D\uFF1A\u53EF\u4EC5\u4E24\u5F20\uFF0C\u4E5F\u53EF\u6709\u4E09\u5F20\u652F\u6301\uFF1B\u53EF\u9009\u62E95-2\u9AD8\u82B1\u914D\u5408\u6B62\u53EB\uFF0C\u4E0D\u81EA\u52A8\u5BA3\u79F0\u6070\u597D\u4E24\u5F20\u6216\u5DF2\u786E\u8BA4\u516B\u5F20\u914D\u5408";
  if (system === "sayc" && opening?.call.level === 1 && major3(opening.call.strain) && us.length === 3 && us[1]?.seat === seat && us[1].call.level === 2 && us[1].call.strain !== "NT" && us[2].seat === opening.seat && us[2].call.level <= 3 && us[2].call.strain !== opening.call.strain && call.strain === opening.call.strain) return call.level === 4 ? "\u9009\u62E9\u5F00\u53EB\u9AD8\u82B1\u4E3A\u5C06\u724C\uFF1A\u5E94\u53EB\u4EBA3+\u5F20\u652F\u6301\u4E0E\u5F00\u53EB\u4EBA5+\u5F20\u6784\u6210\u81F3\u5C118\u5F20\u914D\u5408\uFF1B\u6309SAYC\u4E8C\u76D6\u4E00\u540E\u7684\u516C\u5F00\u70B9\u529B\u4E0B\u9650\u53EB\u5230\u6210\u5C40" : "\u56DE\u5230\u5F00\u53EB\u9AD8\u82B1\uFF1A3+\u5F20\u652F\u6301\u6784\u6210\u81F3\u5C118\u5F20\u914D\u5408\uFF0C\u4F18\u5148\u4E8E\u5BF9\u5F00\u53EB\u4EBA\u7B2C\u4E8C\u5957\u7684\u4E09\u5F20\u652F\u6301";
  if (!all.length) {
    if (system === "sayc" && call.level === 3 && call.strain === "NT") return "SAYC 3NT\u5F00\u53EB\uFF1A25\u201327 HCP\u5747\u578B";
    if (call.strain !== "NT" && call.level === 3) return system === "sayc" ? "\u4E09\u9636\u963B\u51FB\u5F00\u53EB\uFF1A\u901A\u5E385\u201310 HCP\u30017+\u5F20\u4E14\u5957\u8D28\u5408\u683C" : "\u4E09\u9636\u963B\u51FB\u5F00\u53EB\uFF1A\u901A\u5E38\u5F31\u724C\u30017+\u5F20\u957F\u5957";
    if (call.strain !== "NT" && call.level === 4) return system === "sayc" ? "\u56DB\u9636\u963B\u51FB\u5F00\u53EB\uFF1A\u901A\u5E385\u201310 HCP\u30018+\u5F20\u957F\u5957" : "\u56DB\u9636\u963B\u51FB\u5F00\u53EB\uFF1A\u901A\u5E38\u5F31\u724C\u30018+\u5F20\u957F\u5957";
    if (call.level >= 3) return `${call.level}${call.strain}\u4E0D\u662F\u5F53\u524D\u4F53\u7CFB\u5B9A\u4E49\u7684\u5E38\u89C4\u5F00\u53EB\uFF1B\u624B\u52A8\u9009\u62E9\u4E0D\u627F\u8BFA\u7CBE\u786E\u70B9\u529B\u6216\u724C\u578B`;
    if (system === "precision") return call.strain === "C" && call.level === 1 ? "\u5F3A\u6885\u82B1\uFF0C16+ HCP\uFF0C\u4EBA\u4E3A\u903C\u53EB" : call.strain === "NT" ? call.level === 1 ? "13\u201315 HCP \u5747\u578B\uFF0C\u65E05\u5F20\u9AD8\u82B1" : "22\u201323 HCP \u5747\u578B" : call.level === 1 && major3(call.strain) ? "11\u201315 HCP\uFF0C5+\u5F20\u9AD8\u82B1" : call.level === 1 ? "11\u201315 HCP\uFF0C2+\u5F20\u65B9\u5757" : call.strain === "C" ? "11\u201315\uFF0C6+\u6885\u82B1\u62165\u6885\u82B1\uFF0B4\u5F20\u9AD8\u82B1" : call.strain === "D" ? "11\u201315\uFF0C\u77ED\u65B9\u5757\u6307\u5B9A\u724C\u578B" : "6\u201310 HCP\uFF0C6+\u5F20\u5F31\u4E8C";
    return call.strain === "NT" ? call.level === 1 ? "15\u201317 HCP\u5747\u578B\uFF1B\u81EA\u71361NT\u5F00\u53EB" : "20\u201321 HCP\u5747\u578B\uFF1B\u81EA\u71362NT\u5F00\u53EB" : call.level === 2 && call.strain === "C" ? "22+ HCP\u5F3A2\u2663\uFF1B\u4EBA\u5DE5\u903C\u53EB\uFF0C2\u2666\u4E3A\u7B49\u5F85\u5E94\u53EB" : call.level === 2 ? system === "sayc" ? "5\u201311 HCP\u3001\u901A\u5E386+\u5F20\u4E14\u5957\u8D28\u5408\u683C\u7684\u5F31\u4E8C\u5F00\u53EB" : "6\u201310 HCP\u30016+\u5F20\u7684\u5F31\u4E8C\u5F00\u53EB" : call.level === 1 ? major3(call.strain) ? system === "sayc" ? "\u81EA\u7136\u4E00\u9636\u9AD8\u82B1\u5F00\u53EB\uFF1A5+\u5F20\uFF0C\u901A\u5E3813\u201321 HCP\uFF1B12 HCP\u987B\u6EE1\u8DB3Rule of 20" : "\u81EA\u7136\u4E00\u9636\u9AD8\u82B1\u5F00\u53EB\uFF1A5+\u5F20\uFF0C\u7EA612\u201321 HCP" : system === "sayc" ? `\u81EA\u7136\u4E00\u9636${call.strain}\u5F00\u53EB\uFF1A\u901A\u5E383+\u5F20\u300113\u201321 HCP\uFF1B12 HCP\u987B\u6EE1\u8DB3Rule of 20` : `\u81EA\u7136\u4E00\u9636${call.strain}\u5F00\u53EB\uFF1A\u901A\u5E383+\u5F20\u3001\u7EA612\u201321 HCP` : "\u81EA\u7136\u963B\u51FB\u5F00\u53EB";
  }
  if (opening && clean) {
    const base = opening.call.level + 1;
    if (opening.call.strain === "NT" && us.length === 1) {
      if (call.level === base && call.strain === "C") return "Stayman\uFF0C\u95EE4\u5F20\u9AD8\u82B1";
      if (call.level === base && call.strain === "D") return "Jacoby\u8F6C\u79FB\uFF0C5+\u5F20\u7EA2\u5FC3";
      if (call.level === base && call.strain === "H") return "Jacoby\u8F6C\u79FB\uFF0C5+\u5F20\u9ED1\u6843";
      if (call.strain === "NT") return call.level === 2 ? "1NT\u540E\u7684\u81EA\u71362NT\u9080\u8BF7\uFF1A8\u20139 HCP\u5747\u578B\uFF1B\u4E0D\u903C\u53EB" : `\u81EA\u7136${call.level}NT\uFF1A\u6839\u636E\u5DF2\u516C\u5F00\u7684\u65E0\u5C06\u8303\u56F4\u9009\u62E9${call.level >= 6 ? "\u65E0\u5C06\u6EE1\u8D2F\u5B9A\u7EA6" : call.level === 5 ? "\u5927\u6EE1\u8D2F\u9080\u8BF7" : "\u65E0\u5C06\u6210\u5C40"}\uFF1B${call.level === 5 ? "\u5141\u8BB8\u6309\u8303\u56F4\u63A5\u53D7\u6216Pass" : "\u539F\u5219\u4E0A\u6B62\u53EB"}`;
    }
    if (us.length === 1 && system === "precision" && opening.call.strain === "C" && opening.call.level === 1) return call.strain === "D" && call.level === 1 ? "0\u20137 HCP\uFF0C\u5F3A\u6885\u82B1\u8D1F\u5E94\u53EB" : "8+ HCP\uFF0C\u5F3A\u6885\u82B1\u6B63\u5E94\u53EB\uFF0C\u8FDB\u5C40\u903C\u53EB";
    if (opening.call.level === 1 && major3(opening.call.strain) && us.length === 1 && call.strain === "NT" && call.level === 2) return "Jacoby 2NT\uFF1A4+\u5F20\u9AD8\u82B1\u652F\u6301\u300113+\u8C03\u6574\u652F\u6301\u70B9\uFF0C\u8FDB\u5C40\u903C\u53EB";
    if (opening.call.level === 1 && major3(opening.call.strain) && us.length === 1 && call.strain === "NT" && call.level === 1 && system === "sayc") return "SAYC\uFF0B2/1\u534A\u903C\u53EB1NT\uFF1A5\u201312 HCP\uFF1B\u5747\u578B\u6700\u4F4E\u9650\u5F00\u53EB\u4EBA\u53EF\u4EE5Pass\uFF0C\u975E\u5747\u578B\u5F00\u53EB\u4EBA\u7EE7\u7EED\u63CF\u8FF0";
    if (opening.call.level === 1 && major3(opening.call.strain) && us.length === 1 && call.strain === "NT" && call.level === 1 && system === "two-over-one") return passedBefore2(auction, seat, opening.index) ? "Pass\u8FC7\u7684\u624B\u724C\uFF0C1NT\u4E0D\u903C\u53EB" : "6\u201312 HCP\uFF0C1NT\u903C\u53EB\u4E00\u8F6E";
    if (us.length === 1 && (system === "two-over-one" || system === "sayc") && twoOverOne(opening, { seat, call, index: auction.length }, auction)) return `\u4E8C\u76D6\u4E00\uFF1A13+ HCP\u3001${call.strain === "C" ? "3" : call.strain === "D" ? "4" : "5"}+\u5F20${call.strain}\uFF0C\u672APass\u4E14\u65E0\u5E72\u6270\uFF0C\u5EFA\u7ACB\u8FDB\u5C40\u903C\u53EB\uFF1B\u672C\u65B9\u5230\u5C40\u524D\u4E0D\u5F97Pass`;
    if (us.length === 1 && opening.call.level === 1 && call.strain !== "NT") {
      if (call.strain === opening.call.strain) return call.level === 2 ? `\u7B80\u5355\u52A0\u53EB\uFF1A\u901A\u5E386\u20139${major3(call.strain) ? "\u652F\u6301\u70B9\uFF0C3+\u5F20\u652F\u6301\u5F00\u53EB\u82B1\u8272" : "\u70B9\uFF0C\u901A\u5E384+\u5F20\u81EA\u7136\u4F4E\u82B1\u652F\u6301\u6216\u504F\u597D\uFF1B\u5F00\u53EB\u4EC5\u4FDD\u8BC1\u4E09\u5F20\u65F6\uFF0C\u786E\u8BA4\u516B\u5F20\u914D\u5408\u97005+\u5F20\u652F\u6301\uFF0C\u672A\u786E\u8BA4\u524D\u4E0D\u8BA1\u77ED\u95E8\u70B9"}\uFF1B\u4E0D\u903C\u53EB` : call.level === 3 ? `\u9650\u5236\u6027\u8DF3\u52A0\u53EB\uFF1A\u901A\u5E3810\u201312\u652F\u6301\u70B9\uFF0C${major3(call.strain) ? "3+\u5F20\u652F\u6301" : "\u901A\u5E385+\u5F20\u652F\u6301\u4EE5\u786E\u8BA4\u516B\u5F20\u4F4E\u82B1\u914D\u5408"}\uFF1B\u9080\u8BF7\u8FDB\u5C40` : call.level === gameLevel2(call.strain) ? `\u5C01\u5C40\u52A0\u53EB\uFF1A\u786E\u8BA4${major3(call.strain) ? "\u81F3\u5C113\u5F20" : "\u901A\u5E385\u5F20"}\u652F\u6301\u5E76\u76F4\u63A5\u53EB\u5230\u6210\u5C40\uFF1B\u539F\u5219\u4E0A\u6B62\u53EB\uFF0C\u4E0D\u662F\u6EE1\u8D2F\u9080\u8BF7` : `\u975E\u5E38\u89C4\u8DF3\u52A0\u53EB\u81F3${call.level}${call.strain}\uFF1A\u4E0D\u5C5E\u4E8E\u672C\u4F53\u7CFB\u7684\u6807\u51C6\u54CD\u5E94\uFF1B\u624B\u52A8\u9009\u62E9\u4E0D\u627F\u8BFA\u56FA\u5B9A\u70B9\u529B\u8303\u56F4`;
      if (call.level === 1) return `\u4E00\u76D6\u4E00\u81EA\u7136\u5E94\u53EB\uFF1A6+ HCP\u30014+\u5F20${call.strain}\uFF1B${passedBefore2(auction, seat, opening.index) ? "\u5DF2Pass\u7684\u5E94\u53EB\u4EBA\u9650\u5236\u724C\u529B\uFF0C\u901A\u5E38\u4E0D\u903C\u53EB" : "\u903C\u53EB\u4E00\u8F6E"}`;
      if (system === "sayc" && call.level === 2) return `\u4E8C\u9636\u65B0\u82B1\u8272\u81EA\u7136\u5E94\u53EB\uFF1A10+ HCP\u3001\u901A\u5E384+\u5F20${call.strain}\uFF1B${passedBefore2(auction, seat, opening.index) ? "\u8FC7\u624B\u724C\u9650\u5236\u5B9E\u529B\uFF0C\u901A\u5E38\u4E0D\u903C\u53EB\uFF0C\u4E0D\u662F\u4E8C\u76D6\u4E00\u8FDB\u5C40\u903C\u53EB" : "\u903C\u53EB\u4E00\u8F6E"}`;
    }
    if (us.length === 1 && opening.call.level === 1 && (opening.call.strain === "C" || opening.call.strain === "D") && call.strain === "NT") {
      if (call.level === 1) return "\u81EA\u71361NT\u5E94\u53EB\uFF1A\u901A\u5E386\u201310 HCP\uFF0C\u901A\u5E38\u5747\u578B\u6216\u534A\u5747\u578B\uFF0C\u4E5F\u53EF\u7528\u4E0D\u591F\u4E8C\u76D6\u4E00\u8FDB\u5C40\u903C\u53EB\u5B9E\u529B\u7684\u957F\u4F4E\u82B1\u724C\u4F5C\u9650\u5236\u6027\u63CF\u8FF0\uFF1B\u5426\u8BA4\u53EF\u5728\u4E00\u9636\u53EB\u51FA\u7684\u56DB\u5F20\u9AD8\u82B1\uFF0C\u4E0D\u903C\u53EB";
      if (call.level === 2 && system === "sayc") return "\u4FEE\u6B63SAYC\u81EA\u71362NT\u5E94\u53EB\uFF1A11\u201312 HCP\u5747\u578B\u3001\u65E0\u53EF\u5728\u4E00\u9636\u5E94\u53EB\u7684\u56DB\u5F20\u9AD8\u82B1\uFF0C\u9080\u8BF7\u8FDB\u5C40\u3001\u4E0D\u903C\u53EB\uFF1B5-3-3-2\u5373\u4F7F\u6709\u4E94\u5F20\u5F00\u53EB\u4F4E\u82B1\u652F\u6301\u4E5F\u4F18\u5148\u5B9A\u91CF\u63CF\u8FF0\uFF0C\u672C\u5361\u4E0D\u91C7\u7528\u5012\u7F6E\u4F4E\u82B1\u52A0\u53EB";
      if (call.level === 3 && system === "sayc") return "\u4FEE\u6B63SAYC\u81EA\u71363NT\u5E94\u53EB\uFF1A13+ HCP\u5747\u578B\uFF0C\u901A\u5E3813\u201315\u3001\u65E0\u56DB\u5F20\u9AD8\u82B1\uFF1B\u66F4\u5F3A\u800C\u65E0\u5408\u9002\u771F\u5B9E\u65B0\u5957\u65F6\u4E5F\u53EF\u76F4\u63A5\u6210\u5C40\uFF0C\u539F\u5219\u4E0A\u6B62\u53EB\uFF1B5-3-3-2\u5373\u4F7F\u67095\u5F20\u5F00\u53EB\u4F4E\u82B1\u652F\u6301\u4ECD\u4F18\u5148\u5B9A\u91CFNT\uFF0C\u672C\u5361\u4E0D\u91C7\u7528\u5012\u7F6E\u4F4E\u82B1\u52A0\u53EB";
    }
    if (opening.seat === seat && us.length === 2 && opening.call.strain !== "NT") {
      const response = us[1].call;
      if (call.strain === "NT") {
        if (call.level === 1) return system === "sayc" ? "\u5F00\u53EB\u4EBA\u81EA\u71361NT\u518D\u53EB\uFF1A12\u201314 HCP\u5747\u578B\uFF0812\u70B9\u987B\u7B26\u5408Rule of 20\uFF09\uFF0C\u9650\u5236\u6027\u518D\u53EB" : "\u5F00\u53EB\u4EBA\u6700\u4F4E\u9650\u81EA\u71361NT\u518D\u53EB\uFF1A\u5747\u578B\uFF0C\u9650\u5236\u6027\u8303\u56F4";
        if (call.level === 2 && us[1] && twoOverOne(opening, us[1], auction)) return "\u4E8C\u76D6\u4E00\u8FDB\u5C40\u903C\u53EB\u4E2D\u7684\u81EA\u71362NT\u518D\u53EB\uFF1A\u5747\u578B\uFF0C12\u201321 HCP\u7684\u672A\u7EC6\u5206\u8303\u56F4\uFF1B\u5E76\u4E0D\u989D\u5916\u627F\u8BFA18\u201319\u70B9\uFF0C\u8FDB\u5C40\u903C\u53EB\u7EE7\u7EED";
        if (system === "sayc" && response.level === 2 && response.strain !== "NT" && response.strain !== opening.call.strain && passedBefore2(auction, us[1].seat, opening.index)) {
          if (call.level === 2) return "\u5DF2Pass\u5E94\u53EB\u4EBA\u81EA\u7136\u4E8C\u9636\u65B0\u5957\u540E\u7684\u6700\u4F4E2NT\u518D\u53EB\uFF1A12\u201314 HCP\u5747\u578B\u3001\u65E0\u5408\u9002\u82B1\u8272\u914D\u5408\uFF1B\u53D7\u53EB\u724C\u7A7A\u95F4\u62AC\u9AD8\uFF0C\u4E0D\u662F18\u201319\u70B9\u8DF3\u518D\u53EB\uFF0C\u81EA\u7136\u9650\u5236\u6027\u4E14\u4E0D\u903C\u53EB";
          if (call.level === 3) return "\u5DF2Pass\u5E94\u53EB\u4EBA\u81EA\u7136\u4E8C\u9636\u65B0\u5957\u540E\u76843NT\u518D\u53EB\uFF1A18\u201319 HCP\u5747\u578B\uFF0C\u7ED3\u5408\u5E94\u53EB\u4EBA\u5DF2\u793A10+\u5B9E\u529B\u76F4\u63A5\u9009\u62E9\u6210\u5C40\uFF1B\u4E0D\u662F\u6700\u4F4E2NT\u768412\u201314\u8303\u56F4";
        }
        if (call.level === 2) return system === "sayc" ? "\u5F00\u53EB\u4EBA\u8DF3\u518D\u53EB2NT\uFF1A18\u201319 HCP\u5747\u578B\uFF1B\u9080\u8BF7\u642D\u6863\u5224\u65AD\u8FDB\u5C40\u6216\u6EE1\u8D2F" : "\u5F00\u53EB\u4EBA\u81EA\u71362NT\u518D\u53EB\uFF1A\u663E\u793A\u989D\u5916\u70B9\u529B\u548C\u5747\u578B\u724C";
        if (call.level === 3 && response.strain === "NT") return "\u5F00\u53EB\u4EBA\u63A5\u53D7\u81EA\u7136\u65E0\u5C06\u5E94\u53EB\uFF0C\u9009\u62E93NT\u6210\u5C40\uFF1B\u4E0D\u8868\u793A\u82B1\u8272\u652F\u6301\u5F20\u6570";
      }
      if (call.strain === opening.call.strain && response.strain === opening.call.strain) return `\u5F00\u53EB\u4EBA\u5BF9\u540C\u4F34\u52A0\u53EB\u7684${call.level}${call.strain}\u518D\u53EB\uFF1A\u5DF2\u627E\u5230\u82B1\u8272\u914D\u5408\uFF1B${atGame2(call) ? "\u63A5\u53D7\u9080\u8BF7\u6216\u76F4\u63A5\u9009\u62E9\u6210\u5C40" : "\u663E\u793A\u989D\u5916\u5B9E\u529B\uFF0C\u9080\u8BF7\u8FDB\u5C40"}\uFF0C\u4E0D\u989D\u5916\u627F\u8BFA\u516D\u5F20\u5957`;
      if (call.strain === opening.call.strain && major3(call.strain) && call.level === 4)
        return `\u5F00\u53EB\u4EBA\u539F\u9AD8\u82B1${call.level}${call.strain}\u76F4\u63A5\u6210\u5C40\uFF1A\u901A\u5E386+\u5F20\u3001\u8F83\u957F\u6216\u6709\u8DB3\u591F\u5957\u8D28\u53CA\u5B9E\u529B\uFF1B\u539F\u5219\u4E0A\u6B62\u53EB\uFF0C\u4E0D\u662F\u4E09\u9636\u9080\u8BF7\uFF0C\u4E0D\u627F\u8BFA\u540C\u4F34\u5DF2\u7ECF\u652F\u6301\u8BE5\u5957`;
      if (opening.call.level === 2 && opening.call.strain !== "C" && call.strain === opening.call.strain)
        return `\u5F31\u4E8C\u540E\u56DE\u5230\u539F\u5957${call.level}${call.strain}\uFF1A\u7EF4\u6301\u5F31\u4E8C\u5DF2\u793A\u76846+\u5F20\uFF0C\u4E0D\u964D\u4E3A\u4E94\u5F20\u4F8B\u5916\uFF1B\u5C65\u884C\u65B0\u5957\u5E94\u53EB\u7684\u4E00\u8F6E\u4E49\u52A1\uFF0C\u672A\u5EFA\u7ACB\u65B0\u7684\u8FDB\u5C40\u903C\u53EB`;
      if (call.strain === opening.call.strain) return twoOverOne(opening, us[1], auction) ? major3(call.strain) ? `\u4E8C\u76D6\u4E00\u903C\u5C40\u4E2D\u7684\u539F\u9AD8\u82B1\u518D\u53EB\uFF1A\u4FDD\u8BC1\u5F00\u53EB\u65F6\u76845+\u5F20\uFF0C\u4E0D\u989D\u5916\u4FDD\u8BC1\u516D\u5F20\uFF1B\u8FDB\u5C40\u903C\u53EB\u7EE7\u7EED` : `\u4E8C\u76D6\u4E00\u903C\u5C40\u4E2D\u7684\u539F\u4F4E\u82B1\u518D\u53EB\uFF1A\u81EA\u7136\u5F3A\u8C03\u5F00\u53EB\u4F4E\u82B1\uFF1B\u8FDB\u5C40\u903C\u53EB\u7EE7\u7EED\uFF0C\u4E0D\u662F\u9AD8\u82B1\u4E94\u5F20\u5957` : `\u5F00\u53EB\u4EBA\u518D\u53EB\u539F\u82B1\u8272\uFF1A\u901A\u5E386+\u5F20${call.strain}\uFF0C\u6700\u4F4E\u9650\u65E0\u5408\u9002\u518D\u53EB\u65F6\u53EF\u80FD\u53EA\u6709\u4E94\u5F20\uFF1B${call.level >= 3 && opening.call.level === 1 ? "\u8DF3\u518D\u53EB\u901A\u5E3816\u201320 HCP\uFF0C\u9080\u8BF7\u6210\u5C40" : "\u9650\u5236\u6027\u81EA\u7136\u518D\u53EB"}\uFF0C${system === "sayc" && major3(opening.call.strain) && response.level === 1 && response.strain === "NT" && !passedBefore2(auction, us[1].seat, opening.index) ? "\u534A\u903C\u53EB1NT\u5141\u8BB8\u6700\u4F4E\u9650\u5747\u578B\u5F00\u53EB\u4EBAPass\uFF1B\u975E\u5747\u578B\u5F00\u53EB\u4EBA\u6709\u7EE7\u7EED\u63CF\u8FF0\u7684\u4E49\u52A1\uFF0C\u672C\u6B21\u5C65\u884C\u8BE5\u4E49\u52A1\uFF0C\u4E0D\u81EA\u52A8\u5EFA\u7ACB\u65B0\u7684\u6301\u7EED\u903C\u53EB" : analyzeAuctionSemantics(auction, seat, system).mustBid ? "\u5C65\u884C\u672C\u8F6E\u5E94\u53EB\u4E49\u52A1\uFF0C\u4E0D\u81EA\u52A8\u5EF6\u7EED\u4E00\u8F6E\u903C\u53EB" : "\u6B64\u524D\u6CA1\u6709\u7EE7\u7EED\u53EB\u724C\u4E49\u52A1\uFF0C\u81EA\u7136\u9009\u62E9\u518D\u53EB\uFF0C\u4E0D\u5EFA\u7ACB\u65B0\u7684\u903C\u53EB"}`;
      if (call.strain === response.strain) {
        if (twoOverOne(opening, us[1], auction) && major3(response.strain)) return call.level === 3 ? "\u4E8C\u76D6\u4E00\u540E\u7684\u6162\u5230\u5C40\u52A0\u53EB\uFF1A3+\u5F20\u652F\u6301\u300115+ HCP\uFF0C\u4FDD\u7559\u6EE1\u8D2F\u63A2\u7D22\u7A7A\u95F4\uFF1B\u8FDB\u5C40\u903C\u53EB\u7EE7\u7EED" : "\u4E8C\u76D6\u4E00\u540E\u7684\u5FEB\u5230\u5C40\u52A0\u53EB\uFF1A3+\u5F20\u652F\u6301\u3001\u6700\u4F4E\u965012\u201314 HCP\uFF0C\u9009\u62E9\u9AD8\u82B1\u6210\u5C40\uFF1B\u989D\u5916\u5B9E\u529B\u8F83\u5C11";
        return `\u5F00\u53EB\u4EBA\u652F\u6301\u5E94\u53EB\u82B1\u8272\uFF1A${response.level === 1 ? "4" : major3(response.strain) ? "3" : "4"}+\u5F20\u652F\u6301\uFF1B\u9636\u6570\u8868\u793A\u6700\u4F4E\u9650\u3001\u9080\u8BF7\u6216\u8FDB\u5C40\u5B9E\u529B${analyzeAuctionSemantics(following, partnerOf(seat), system).forcing === "game" && !atGame2(call) ? "\uFF1B\u539F\u6709\u8FDB\u5C40\u903C\u53EB\u4ECD\u7EE7\u7EED\uFF0C\u53CC\u65B9\u5230\u5C40\u524D\u4E0D\u5F97Pass" : ""}`;
      }
      if (call.level >= 2 && !atGame2(call) && call.strain !== "NT" && response.level === 1 && bidValue(call) - bidValue(response) > 5) return `\u5F00\u53EB\u4EBA\u5F3A\u8DF3\u79FB\u53EB\uFF1A\u901A\u5E3819+ HCP\u30014+\u5F20${call.strain}\uFF1B\u539F\u9AD8\u82B15+\u5F20\uFF0C\u539F\u4F4E\u82B14+\u5F20\u4E14\u53EF\u4E0E\u7B2C\u4E8C\u5957\u7B49\u957F\uFF1B\u5EFA\u7ACB\u8FDB\u5C40\u903C\u53EB\uFF0C\u4E0D\u80FDPass\u5728\u6B64\u90E8\u5206\u5B9A\u7EA6`;
      if (call.level === 2 && call.strain !== "NT" && response.level === 1 && bidValue(bid3(1, call.strain)) > bidValue(opening.call)) return `\u5F00\u53EB\u4EBA\u9006\u53EB\uFF1A17+ HCP\u30014+\u5F20${call.strain}\uFF0C\u539F\u82B1\u8272\u901A\u5E38\u66F4\u957F\uFF1B\u5F3A4-4-4-1\u624B\u724C\u53EF\u4E24\u5957\u7B49\u957F\uFF0C\u903C\u53EB\u4E00\u8F6E`;
      if (call.strain !== "NT") return system === "sayc" && major3(opening.call.strain) && response.level === 1 && response.strain === "NT" ? `\u5F00\u53EB\u4EBA\u81EA\u7136\u518D\u53EB\u7B2C\u4E8C\u5957${call.strain}\uFF1A\u901A\u5E384+\u5F20\uFF1B\u663E\u793A5\u5F20\u5F00\u53EB\u9AD8\u82B1\u548C\u901A\u5E384\u5F20\u7B2C\u4E8C\u5957\uFF1B\u4F4E\u82B1\u53EF\u80FD\u53EA\u67093\u5F20\uFF0C\u907F\u514D\u4EE5\u4E0D\u8DB317\u70B9\u7684\u724C\u9006\u53EB2\u2660\uFF0C\u5C65\u884C\u534A\u903C\u53EB1NT\u540E\u7684\u63CF\u8FF0` : `\u5F00\u53EB\u4EBA\u81EA\u7136\u518D\u53EB\u7B2C\u4E8C\u5957${call.strain}\uFF1A\u901A\u5E384+\u5F20\uFF1B\u8FDB\u4E00\u6B65\u63CF\u8FF0\u724C\u578B${analyzeAuctionSemantics(following, partnerOf(seat), system).forcing === "game" && !atGame2(call) ? "\uFF1B\u539F\u6709\u8FDB\u5C40\u903C\u53EB\u4ECD\u7EE7\u7EED\uFF0C\u53CC\u65B9\u5230\u5C40\u524D\u4E0D\u5F97Pass" : ""}`;
    }
    if (system === "precision" && opening.call.level === 2 && opening.call.strain === "C" && us.length === 1 && call.level === 2 && call.strain === "D") return "\u7CBE\u786E2\u2663\u540E2\u2666\u95EE\u9AD8\u82B1";
    if (system === "precision" && opening.call.level === 2 && opening.call.strain === "D" && us.length === 1 && call.level === 2 && call.strain === "NT") return "\u7CBE\u786E\u77ED\u65B9\u57572\u2666\u540E2NT\u95EE\u724C\u578B";
  }
  if (call.level === 4 && call.strain === "NT") return "\u5DF2\u6709\u660E\u786E\u5C06\u724C\u914D\u5408\u5219RKCB 1430\u5173\u952E\u5F20\u95EE\u53EB\uFF1B\u65E0\u5C06\u4E2D\u4E3A\u5B9A\u91CF\u9080\u8BF7";
  const ownBids = us.filter((entry) => entry.seat === seat);
  const partnerBid = [...us].reverse().find((entry) => entry.seat === partnerOf(seat));
  const forcedBeforeCall = analyzeAuctionSemantics(auction, seat, system).mustBid;
  const continuesGameForce = analyzeAuctionSemantics(following, partnerOf(seat), system).forcing === "game" && !atGame2(call);
  const gameReached = atGame2(call);
  const responderLaterNewSuit = system === "sayc" && genuine && opening?.call.level === 1 && opening.call.strain !== "NT" && opening.seat === partnerOf(seat) && call.level === 3 && call.strain !== "NT" && call.strain !== opening.call.strain && partnerBid?.seat === opening.seat && partnerBid.index > opening.index && call.strain !== partnerBid.call.strain && !us.some((entry) => entry.seat === seat && entry.call.strain === call.strain && !isArtificialBidAt(auction, entry.index, system)) && !all.some((entry) => sideOf(entry.seat) !== sideOf(seat) && entry.call.strain === call.strain && !isArtificialBidAt(auction, entry.index, system)) && (ownBids.some((entry) => entry.call.level === 1 && entry.call.strain !== "NT") || auction.some((entry, index) => entry.seat === seat && classifyDoubleAt(auction, index, system) === "negative"));
  if (responderLaterNewSuit)
    return `\u5E94\u53EB\u4EBA\u5728\u5F00\u53EB\u4EBA\u81EA\u7136\u518D\u53EB\u540E\u7684\u4E09\u9636\u65B0\u5957${call.strain}\uFF1A\u901A\u5E3810+ HCP\u30015+\u5F20\u81EA\u7136\u5957\uFF1B${passedBefore2(auction, seat, opening.index) ? "\u5DF2Pass\u624B\u724C\u9650\u5236\u5B9E\u529B\uFF0C\u4E0D\u903C\u53EB" : "\u672APass\u624B\u724C\u903C\u53EB\u4E00\u8F6E\uFF0C\u8981\u6C42\u5F00\u53EB\u4EBA\u7EE7\u7EED\u63CF\u8FF0"}\uFF1B\u516D\u5F20\u4EE5\u4E0A\u957F\u5957\u53EF\u6309\u5957\u8D28\u4E0E\u53EF\u5151\u73B0\u8D62\u58A9\u914C\u51CF\u70B9\u529B\uFF0C\u4F46\u4E0D\u80FD\u81EA\u52A8\u8BA4\u5B9A\u8FDB\u5C40\u903C\u53EB`;
  if (system === "sayc" && analyzeAuctionSemantics(following, partnerOf(seat), system).convention === "responder-second-suit")
    return `\u4E00\u76D6\u4E00\u540E\u5E94\u53EB\u4EBA\u81EA\u7136\u63CF\u8FF0\u7B2C\u4E8C\u5957${call.strain}\uFF1A4+\u5F20\uFF1B\u672APass\u7684\u81EA\u7136\u65B0\u5957\u7EED\u53EB\u903C\u53EB\u4E00\u8F6E\uFF0C\u8981\u6C42\u5F00\u53EB\u4EBA\u7EE7\u7EED\u63CF\u8FF0\uFF0C\u4E0D\u662F\u4EBA\u5DE5\u65B0\u4F4E\u82B1\u6216\u672A\u7EA6\u5B9A\u53EB\u54C1`;
  if (clean && system === "sayc" && opening?.call.level === 1 && opening.call.strain !== "NT" && us.length === 3 && seat !== opening.seat && us[1].call.level === 1 && major3(us[1].call.strain) && call.strain === us[1].call.strain && bidValue(call) - bidValue(us[2].call) > 5)
    return call.level === 4 ? `\u5E94\u53EB\u4EBA\u539F\u9AD8\u82B14${call.strain}\u76F4\u63A5\u6210\u5C40\uFF1A13+ HCP\u53CA6+\u5F20\u81EA\u5DF1\u7684\u957F\u5957\uFF1B\u4E0D\u662F\u5BF9\u4F4E\u82B1\u7684\u52A0\u53EB\uFF0C\u4E0D\u627F\u8BFA\u5F00\u53EB\u4EBA\u9AD8\u82B1\u652F\u6301\u6216\u5DF2\u77E5\u516B\u5F20\u914D\u5408` : call.level === 3 ? `\u5E94\u53EB\u4EBA\u539F\u9AD8\u82B13${call.strain}\u8DF3\u518D\u53EB\uFF1A\u901A\u5E3810\u201312 HCP\u53CA6+\u5F20\u81EA\u5DF1\u7684\u5957\uFF0C\u9080\u8BF7\u6210\u5C40\uFF1B\u4E0D\u662F\u652F\u6301\u52A0\u53EB\uFF0C\u4E0D\u81EA\u52A8\u5EFA\u7ACB\u8FDB\u5C40\u903C\u53EB` : `\u5E94\u53EB\u4EBA\u539F\u9AD8\u82B1${call.level}${call.strain}\u518D\u53EB\uFF1A\u81EA\u7136\u5F3A\u8C03\u81EA\u5DF1\u7684\u957F\u5957\uFF1B\u6700\u4F4E\u518D\u53EB\u4E0D\u5EFA\u7ACB\u65B0\u7684\u8FDB\u5C40\u903C\u53EB\uFF0C\u4E0D\u627F\u8BFA\u540C\u4F34\u5DF2\u652F\u6301`;
  if (genuine && opening?.call.level === 2 && opening.call.strain === "C" && seat === opening.seat && us.length === 4 && secondNegative(us, 3, system) && call.strain === us[2].call.strain)
    return `\u5F3A2\u2663\u540E\u5C65\u884C\u4E8C\u6B21\u8D1F\u5E94\u53EB\u7684\u539F\u5957\u518D\u53EB\uFF1A\u539F${major3(call.strain) ? `\u9AD8\u82B1${call.strain}\u4EC5\u4FDD\u8BC15+\u5F20` : `\u4F4E\u82B1${call.strain}\u901A\u5E385+\u5F20\uFF0C\u5F3A4-4-4-1\u4F8B\u5916\u53EF\u4EC5\u56DB\u5F20`}\uFF1B\u6700\u4F4E\u9650\u539F\u5957\u518D\u53EB\u89E3\u9664\u8FDB\u5C40\u4E49\u52A1\uFF0C\u5141\u8BB8\u540C\u4F34Pass\uFF1B\u4E0D\u989D\u5916\u4FDD\u8BC1\u516D\u5F20`;
  if (genuine && opening?.call.level === 1 && opening.call.strain !== "NT" && opening.seat === seat && ownBids.length === 1 && call.strain !== "NT" && call.strain !== opening.call.strain && !us.some((entry) => entry.seat === partnerOf(seat) && entry.call.strain === call.strain && !isArtificialBidAt(auction, entry.index, system)) && !all.some((entry) => sideOf(entry.seat) !== sideOf(seat) && entry.call.strain === call.strain)) {
    if (us[1]?.call.level === 1 && call.strain !== us[1].call.strain && !atGame2(call) && bidValue(call) - bidValue(all.at(-1).call) > 5)
      return `\u5F00\u53EB\u4EBA\u5728\u7ADE\u4E89\u4E2D\u7684\u5F3A\u8DF3\u79FB\u53EB\uFF1A19+ HCP\u30014+\u5F20${call.strain}\uFF1B\u539F\u9AD8\u82B15+\u5F20\uFF0C\u539F\u4F4E\u82B14+\u5F20\u4E14\u53EF\u7B49\u957F\uFF1B\u5EFA\u7ACB\u8FDB\u5C40\u903C\u53EB\uFF0C\u4E0D\u662F\u6700\u4F4E\u7B2C\u4E8C\u5957\u63CF\u8FF0`;
    if (call.level === 2 && call.strain !== us[1]?.call.strain && bidValue(bid3(1, call.strain)) > bidValue(opening.call))
      return `\u5F00\u53EB\u4EBA\u5728\u7ADE\u4E89\u4E2D\u7684\u9006\u53EB\uFF1A17+ HCP\u30014+\u5F20${call.strain}\uFF0C\u539F\u5957\u901A\u5E38\u8F83\u957F\uFF1B\u5F3A4-4-4-1\u624B\u724C\u5141\u8BB8\u4E24\u5957\u7B49\u957F\uFF0C\u8868\u793A\u989D\u5916\u5B9E\u529B\uFF0C\u4E0D\u662F\u6700\u4F4E\u7B2C\u4E8C\u5957\uFF0C\u4E0D\u81EA\u52A8\u628A\u5DF2Pass\u540C\u4F34\u5F53\u4F5C\u65B0\u8FDB\u5C40\u903C\u53EB\u7684\u5E94\u53EB\u4EBA`;
    return `\u5F00\u53EB\u4EBA\u5728\u7ADE\u4E89\u4E2D\u81EA\u7136\u63CF\u8FF0\u7B2C\u4E8C\u5957${call.strain}\uFF1A\u901A\u5E384+\u5F20\uFF1B\u4E0D\u662F\u9996\u6B21\u4E94\u5F20\u4E89\u53EB\uFF0C\u9636\u6570\u7ED3\u5408\u7A7A\u95F4\u53CA\u5148\u524D\u70B9\u529B\u63CF\u8FF0`;
  }
  if (system === "sayc" && genuine && opening?.call.strain === "NT" && us.length === 1 && seat !== opening.seat && call.level === 3 && call.strain !== "NT" && analyzeAuctionSemantics(following, partnerOf(seat), system).convention === "nt-competitive-response" && !isArtificialBidAt(following, auction.length, system))
    return `\u65E0\u5C06\u53D7\u4E89\u53EB\u540E\u7684\u4E09\u9636\u81EA\u7136\u65B0\u5957${call.strain}\uFF1A10+ HCP\u30015+\u5F20\uFF0C\u5EFA\u7ACB\u8FDB\u5C40\u903C\u53EB\uFF1B\u4E0D\u662F\u672A\u7EA6\u5B9A\u7684\u540E\u7EED\u7ADE\u4E89\u53EB\uFF0C\u4E5F\u4E0D\u662F\u4E8C\u9636\u5F31\u724C\u9003\u53EB`;
  if (clean && opening?.call.level === 1 && major3(opening.call.strain) && us[1]?.call.level === 1 && us[1].call.strain === "NT" && us.length === 3 && seat !== opening.seat && call.strain !== "NT" && call.strain !== opening.call.strain && call.strain !== us[2].call.strain)
    return analyzeAuctionSemantics(auction, seat, system).forcing === "game" ? `\u5F3A\u8DF3\u79FB\u53EB\u5EFA\u7ACB\u903C\u5C40\u540E\u81EA\u7136\u63CF\u8FF06+\u5F20${call.strain}\uFF1A\u8FDB\u5C40\u903C\u53EB\u7EE7\u7EED\uFF0C\u4E0D\u662F\u5F31\u724C\u6B62\u53EB` : call.level === 2 ? `\u534A\u903C\u53EB1NT\u540E\u7684${call.level}${call.strain}\u6539\u53EB\uFF1A\u5F31\u724C\u3001\u901A\u5E386+\u5F20\u81EA\u5DF1\u7684\u5957\uFF0C\u9009\u62E9\u90E8\u5206\u5B9A\u7EA6\uFF1B\u4E0D\u903C\u53EB` : bidValue(call) - bidValue(all.at(-1).call) > 5 ? `\u534A\u903C\u53EB1NT\u540E\u7684\u957F\u5957\u8DF3\u518D\u53EB\uFF1A\u901A\u5E3810\u201312 HCP\u53CA6+\u5F20${call.strain}\uFF0C\u9080\u8BF7\u6210\u5C40\uFF1B\u4E0D\u662F\u5F31\u724C\u504F\u597D` : `\u534A\u903C\u53EB1NT\u540E\u7684${call.level}${call.strain}\u4E09\u9636\u957F\u5957\u63CF\u8FF0\uFF1A\u901A\u5E386+\u5F20\uFF0C\u53EF\u80FD\u5728\u4E8C\u9636\u65E0\u7A7A\u95F4\u65F6\u4E3A\u5F31\u724C\u9003\u53EB\uFF1B\u4E0D\u662F\u8DF3\u518D\u53EB\uFF0C\u4E0D\u81EA\u52A8\u627F\u8BFA\u9080\u8BF7\u5B9E\u529B`;
  if (!genuine && opening && opening.call.strain !== "NT" && !ownDouble && !partnerDouble && ownBids.length === 0 && call.strain !== "NT" && call.strain !== opening?.call.strain && call.strain !== all[0]?.call.strain)
    return "\u81EA\u7136\u4E89\u53EB\u540E\u7684\u65B0\u82B1\u8272\u5E94\u53EB\uFF1A\u901A\u5E388+ HCP\u30015+\u5F20\uFF1B\u5EFA\u8BBE\u6027\u4F46\u4E0D\u903C\u53EB\uFF0C\u652F\u6301\u6027\u6263\u53EB\u624D\u8981\u6C42\u4E89\u53EB\u4EBA\u7EE7\u7EED";
  if (call.strain === "NT") {
    const purpose = currentConvention === "fourth-suit" ? "\u81EA\u7136\u56DE\u7B54\u7B2C\u56DB\u82B1\u8272\u8BE2\u95EE\uFF0C\u63CF\u8FF0\u6B62\u5F20\u53CA\u6700\u4F4E\u9650\u5B9E\u529B\uFF1B\u4E0D\u5957\u7528\u8DF3\u518D\u53EB\u70B9\u529B\uFF0C\u4E5F\u4E0D\u81EA\u52A8\u627F\u8BFA\u6210\u5C40\u9080\u8BF7" : call.level === 1 ? "\u90E8\u5206\u5B9A\u7EA6\u6216\u9650\u5236\u6027\u518D\u53EB" : call.level === 2 ? "\u9080\u8BF7\u6216\u989D\u5916\u5B9E\u529B\u63CF\u8FF0" : call.level === 3 ? "\u9009\u62E9\u65E0\u5C06\u6210\u5C40\u5E76\u539F\u5219\u4E0A\u6B62\u53EB" : call.level === 5 ? "\u81EA\u7136\u5927\u6EE1\u8D2F\u9080\u8BF7" : call.level >= 6 ? "\u65E0\u5C06\u6EE1\u8D2F\u5B9A\u7EA6" : "\u6EE1\u8D2F\u5B9A\u91CF\u9080\u8BF7";
    const partnerNtStopper = partnerBid?.call.strain === "NT" && !isArtificialBidAt(auction, partnerBid.index, system);
    const stopper = lastOpponent ? partnerNtStopper ? "\uFF0C\u53EF\u4F9D\u8D56\u540C\u4F34\u81EA\u7136\u65E0\u5C06\u5DF2\u516C\u5F00\u7684\u654C\u5957\u6B62\u5F20\uFF0C\u4E0D\u989D\u5916\u4FDD\u8BC1\u672C\u624B\u4E5F\u6709\u6B62\u5F20" : "\uFF0C\u5E76\u4FDD\u8BC1\u5BF9\u624B\u5DF2\u793A\u82B1\u8272\u81F3\u5C11\u4E00\u6B62\u5F20" : "";
    const inferred = noTrumpRangeAt(following, auction.length, system);
    const points = inferred ? `${inferred.min}\u2013${inferred.max} HCP\uFF1B` : "";
    const reverseContext = currentConvention === "reverse" && call.level === 2 ? "\u8FD9\u662F\u9006\u53EB\u540E\u7684\u81EA\u7136\u6700\u4F4E\u9650\u6216\u9080\u8BF7\u6027\u7B54\u53EB\uFF0C\u5C65\u884C\u9006\u53EB\u7684\u4E00\u8F6E\u5E94\u53EB\u4E49\u52A1\uFF1B\u4E0D\u662F\u4F4E\u82B1\u76F4\u63A52NT\u768411\u201312\u9080\u8BF7\uFF0C\u672A\u91C7\u7528\u4EBA\u5DE5Blackout\u8303\u56F4\uFF1B" : "";
    return `\u81EA\u7136${call.level}NT\uFF1A${points}${reverseContext}\u9002\u5408\u65E0\u5C06\uFF0C\u53EF\u4E3A\u5747\u578B\u6216\u534A\u5747\u578B\uFF0C\u4E5F\u53EF\u51ED\u53EF\u5151\u73B0\u957F\u5957\u9009\u62E9\u5B9E\u724C\u5B9A\u7EA6${stopper}\uFF1B\u7528\u9014\u4E3A${purpose}${continuesGameForce ? "\uFF0C\u8FDB\u5C40\u903C\u53EB\u4ECD\u672A\u89E3\u9664" : ""}`;
  }
  if (genuine && opening?.call.level === 1 && !major3(opening.call.strain) && opening.call.strain !== "NT" && seat !== opening.seat && us.length === 3 && call.strain === opening.call.strain && us[1].call.strain !== opening.call.strain && us[2].call.strain !== opening.call.strain && call.level === 2)
    return `\u56DE\u5230\u5F00\u53EB\u4F4E\u82B1${call.level}${call.strain}\u7684\u6700\u4F4E\u504F\u597D\uFF1A\u53EF\u53EA\u6709\u4E24\u4E09\u5F20\uFF0C\u672A\u786E\u8BA4\u516B\u5F20\u914D\u5408\uFF1B\u4E0D\u662F\u56DB\u5F20\u652F\u6301\u7684\u6B63\u5F0F\u52A0\u53EB${continuesGameForce ? "\uFF0C\u8FDB\u5C40\u903C\u53EB\u7EE7\u7EED" : "\uFF0C\u9009\u62E9\u90E8\u5206\u5B9A\u7EA6\u3001\u4E0D\u5EFA\u7ACB\u65B0\u903C\u53EB"}`;
  if (currentConvention === "fourth-suit" && genuine && opening?.seat === seat && us[1]?.call.strain === call.strain && major3(call.strain))
    return `\u7B2C\u56DB\u82B1\u8272\u8BE2\u95EE\u540E\u7684\u8FDF\u5230\u9AD8\u82B1\u652F\u6301${call.level}${call.strain}\uFF1A\u53EF\u4EC53\u5F20\u652F\u6301\u540C\u4F34\u7684\u4E00\u9636\u81EA\u7136\u9AD8\u82B1\uFF1B\u8FD9\u662F\u652F\u6301\u6216\u504F\u597D\uFF0C\u4E0D\u627F\u8BFA\u81EA\u5DF1\u7684\u56DB\u5F20\u7B2C\u4E8C\u5957\uFF0C\u540C\u4F34\u6B64\u524D\u4EC5\u4FDD\u8BC1\u56DB\u5F20\u65F6\u4ECD\u4E0D\u80FD\u81EA\u52A8\u786E\u8BA4\u516B\u5F20\u914D\u5408${continuesGameForce ? "\uFF1B\u539F\u6709\u8FDB\u5C40\u903C\u53EB\u7EE7\u7EED" : "\uFF1B\u5DF2\u5C65\u884C\u672C\u8F6E\u8BE2\u95EE\u4E49\u52A1\uFF0C\u4E0D\u81EA\u52A8\u5EFA\u7ACB\u65B0\u903C\u53EB"}`;
  const partnerSuitBid = [...us].reverse().find((entry) => entry.seat === partnerOf(seat) && entry.call.strain === call.strain && !isArtificialBidAt(auction, entry.index, system));
  if (partnerSuitBid) {
    const partnerNatural = us.filter((entry) => entry.seat === partnerOf(seat) && entry.call.strain === call.strain && !isArtificialBidAt(auction, entry.index, system));
    const firstPartnerSuit = partnerNatural[0];
    const partnerOpened = opening?.seat === partnerOf(seat) && opening.call.strain === call.strain;
    let partnerMinimum = naturalSuitMinimum(auction, partnerOf(seat), call.strain, system) || void 0;
    let minimumRepeatPreference = false;
    if (partnerMinimum === void 0 && partnerOpened && genuine) partnerMinimum = opening.call.level === 1 ? major3(call.strain) ? 5 : 3 : opening.call.level === 2 && opening.call.strain !== "C" ? 6 : opening.call.level === 3 ? 7 : opening.call.level === 4 ? 8 : void 0;
    else if (partnerMinimum === void 0 && !genuine && firstPartnerSuit.index === opening?.index) {
      const before = entries(auction.slice(0, firstPartnerSuit.index)).at(-1);
      const jumped = before && bidValue(firstPartnerSuit.call) - bidValue(before.call) > 5;
      partnerMinimum = jumped ? firstPartnerSuit.call.level === 2 ? 6 : firstPartnerSuit.call.level === 3 ? 7 : 8 : 5;
    } else if (partnerMinimum === void 0 && genuine && opening?.call.level === 2 && opening.call.strain === "C") partnerMinimum = 5;
    else if (partnerMinimum === void 0 && genuine && opening?.call.strain === "NT") partnerMinimum = major3(call.strain) ? 4 : void 0;
    else if (partnerMinimum === void 0 && genuine && opening?.call.level === 1) partnerMinimum = firstPartnerSuit.call.level === 1 ? 4 : opening.seat === firstPartnerSuit.seat && major3(opening.call.strain) && us[1]?.call.strain === "NT" && firstPartnerSuit.call.level === 2 && !major3(call.strain) ? 3 : 4;
    if (system === "sayc" && partnerDouble && enemyOpening && firstPartnerSuit.call.strain !== enemyOpening.call.strain && auction.indexOf(partnerDouble) < firstPartnerSuit.index && !us.some((entry) => entry.seat === partnerOf(seat) && entry.index < firstPartnerSuit.index) && analyzeAuctionSemantics(auction.slice(0, firstPartnerSuit.index), partnerOf(seat), system).convention !== "takeout-cue" && !auction.slice(auction.indexOf(partnerDouble) + 1, firstPartnerSuit.index).some((entry) => sideOf(entry.seat) !== sideOf(seat) && entry.call.kind === "redouble"))
      partnerMinimum = 5;
    if (partnerOpened && opening.call.level === 1 && partnerNatural.length > 1) {
      const before = entries(auction.slice(0, partnerSuitBid.index)).at(-1);
      const jumped = before && bidValue(partnerSuitBid.call) - bidValue(before.call) > 5;
      const negative = auction[opening.index + 2]?.call.kind === "double" && classifyDoubleAt(auction, opening.index + 2, system) === "negative" && partnerNatural.length === 2;
      if (jumped) partnerMinimum = Math.max(partnerMinimum ?? 0, 6);
      else if (!negative && !(us[1] && twoOverOne(opening, us[1], auction))) {
        partnerMinimum = Math.max(partnerMinimum ?? 0, 5);
        minimumRepeatPreference = true;
      }
    }
    if (partnerOpened && genuine && opening.call.level === 1 && !major3(call.strain) && us[1]?.call.level === 1 && us.some((entry) => entry.seat === opening.seat && entry.call.strain !== call.strain && entry.call.strain !== "NT" && entry.call.level >= 2 && bidValue(entry.call) - bidValue(entries(auction.slice(0, entry.index)).at(-1).call) > 5))
      partnerMinimum = Math.max(partnerMinimum ?? 0, 4);
    const support = minimumRepeatPreference ? "\u652F\u6301\u6216\u504F\u597D\u540C\u4F34\u53CD\u590D\u663E\u793A\u7684\u957F\u5957\uFF0C\u53EF\u4EC5\u4E24\u4E09\u5F20\uFF1B\u666E\u901A\u6700\u4F4E\u56DE\u5957\u4ECD\u6709\u4E94\u5F20\u4F8B\u5916\uFF0C\u4E0D\u81EA\u52A8\u786E\u8BA4\u516B\u5F20\u914D\u5408" : partnerMinimum !== void 0 ? `\u540C\u4F34\u516C\u5F00${partnerMinimum}+\u5F20\u81EA\u7136\u5957\uFF1B\u786E\u8BA4\u516B\u5F20\u914D\u5408\u65F6\u81EA\u5DF1\u53EA\u9700${Math.max(1, 8 - partnerMinimum)}+\u5F20\u652F\u6301\uFF0C\u4E0D\u56FA\u5B9A\u5957\u7528\u9AD8\u82B1\u4E09\u5F20\u6216\u4F4E\u82B1\u56DB\u5F20` : "\u9009\u62E9\u540C\u4F34\u6B64\u524D\u81EA\u7136\u82B1\u8272\uFF1B\u6B64\u5E8F\u5217\u672A\u7EA6\u5B9A\u56FA\u5B9A\u652F\u6301\u5F20\u6570\uFF0C\u4E0D\u80FD\u81EA\u52A8\u786E\u8BA4\u516B\u5F20\u914D\u5408";
    const purpose = gameReached ? "\u53EB\u5230\u6210\u5C40\u6216\u66F4\u9AD8\u9636\u5E76\u539F\u5219\u4E0A\u6B62\u53EB" : call.level === 3 ? "\u7ADE\u4E89\u6027\u6216\u9080\u8BF7\u6027\u52A0\u53EB" : "\u90E8\u5206\u5B9A\u7EA6\u52A0\u53EB";
    const originallyRaisedPartner = ownBids[0]?.call.strain === opening?.call.strain && ownBids[0]?.seat !== opening?.seat;
    if (!originallyRaisedPartner && ownBids.some((entry) => entry.call.strain === call.strain)) return `\u81EA\u7136\u518D\u53EB${call.level}${call.strain}\uFF1A\u56DE\u5230\u81EA\u5DF1\u5DF2\u663E\u793A\u7684\u82B1\u8272\uFF1B${purpose}${continuesGameForce ? "\uFF0C\u8FDB\u5C40\u903C\u53EB\u4ECD\u7EE7\u7EED" : ""}`;
    return `\u81EA\u7136\u652F\u6301${call.level}${call.strain}\uFF1A${support}\uFF1B${purpose}${continuesGameForce ? "\uFF0C\u8FDB\u5C40\u903C\u53EB\u4ECD\u7EE7\u7EED" : ""}`;
  }
  if (ownBids.some((entry) => entry.call.strain === call.strain)) {
    const ownPriorSuit = ownBids.filter((entry) => entry.call.strain === call.strain && !isArtificialBidAt(auction, entry.index, system));
    if (!ownPriorSuit.length) return `\u672C\u6B21${call.level}${call.strain}\u8F6C\u4E3A\u81EA\u7136\u82B1\u8272\u63CF\u8FF0\uFF1A\u6B64\u524D\u540C\u82B1\u8272\u53EB\u54C1\u5C5E\u4E8E\u4EBA\u5DE5\u8BE2\u95EE\u6216\u56DE\u7B54\uFF0C\u4E0D\u627F\u8BFA\u8BE5\u82B1\u8272\u957F\u5EA6\uFF1B\u4E0D\u80FD\u636E\u6B64\u865A\u6784\u539F\u6709\u4E94\u5F20\u6216\u516D\u5F20\u81EA\u7136\u5957${continuesGameForce ? "\uFF1B\u539F\u6709\u8FDB\u5C40\u903C\u53EB\u7EE7\u7EED" : "\uFF1B\u4E0D\u81EA\u52A8\u5EFA\u7ACB\u65B0\u7684\u903C\u53EB"}`;
    const supported = ownPriorSuit.some((entry) => us.some((partnerEntry) => partnerEntry.seat !== seat && partnerEntry.index < entry.index && partnerEntry.call.strain === call.strain));
    const promised = naturalSuitMinimum(following, seat, call.strain, system);
    const length = supported ? "\u6B64\u524D\u5DF2\u786E\u8BA4\u914D\u5408\uFF0C\u4E0D\u989D\u5916\u627F\u8BFA\u516D\u5F20\u5957" : promised === 4 ? ownPriorSuit[0].index === opening?.index && genuine ? "\u56DB\u5F20\u539F\u4F4E\u82B1\u7684\u7ADE\u4E89\u6027\u56DE\u5957\u4F8B\u5916\uFF0C\u7EF4\u63014+\u5F20\u627F\u8BFA\uFF1B\u4E0D\u5BA3\u79F0\u4E94\u5F20\u6216\u516D\u5F20\u957F\u5957" : "\u7EF4\u6301\u6B64\u524D\u81EA\u7136\u7B2C\u4E8C\u5957\u76844+\u5F20\u627F\u8BFA\uFF0C\u4E0D\u56E0\u91CD\u590D\u53EB\u724C\u5C31\u53D8\u6210\u516D\u5F20\u539F\u5957" : promised >= 6 ? `\u81EA\u7136\u5F3A\u8C03\u81EA\u5DF1\u7684${promised}+\u5F20\u957F\u5957` : promised === 5 ? "\u4FDD\u8BC1\u4E4B\u524D\u663E\u793A\u76845+\u5F20\u5957\uFF0C\u4E0D\u56E0\u6700\u4F4E\u56DE\u53EB\u5C31\u989D\u5916\u627F\u8BFA\u516D\u5F20" : "\u81EA\u7136\u5F3A\u8C03\u6B64\u524D\u82B1\u8272\uFF1B\u6B64\u5E8F\u5217\u6CA1\u6709\u8DB3\u4EE5\u4FDD\u8BC1\u4E94\u5F20\u6216\u516D\u5F20\u7684\u516C\u5F00\u957F\u5EA6\u4FE1\u606F";
    return `\u81EA\u7136\u518D\u53EB${call.level}${call.strain}\uFF1A${length}\uFF1B${gameReached ? "\u53EB\u5230\u6210\u5C40\u6216\u6EE1\u8D2F\u5E76\u539F\u5219\u4E0A\u6B62\u53EB" : continuesGameForce ? "\u8FDB\u5C40\u903C\u53EB\u4ECD\u7EE7\u7EED" : forcedBeforeCall ? "\u5C65\u884C\u672C\u8F6E\u5E94\u53EB\u4E49\u52A1\uFF1B\u672A\u5EFA\u7ACB\u6301\u7EED\u8FDB\u5C40\u903C\u53EB" : "\u672A\u5EFA\u7ACB\u65B0\u7684\u4EBA\u5DE5\u903C\u53EB"}`;
  }
  if (lastOpponent && call.strain === lastOpponent.call.strain) return `\u81EA\u7136\u4F53\u7CFB\u6263\u53EB${call.level}${call.strain}\uFF1A\u6240\u53EB\u82B1\u8272\u5C5E\u4E8E\u5BF9\u624B\uFF0C\u4E0D\u627F\u8BFA\u8BE5\u82B1\u8272\u957F\u5EA6\uFF1B\u8868\u793A\u652F\u6301\u642D\u6863\u6216\u5F3A\u724C\u5E76\u8981\u6C42\u7EE7\u7EED\u63CF\u8FF0`;
  if (lastOpponent) return `${call.level}${call.strain}\u4E3A\u672C\u5361\u672A\u7EA6\u5B9A\u7684\u540E\u7EED\u7ADE\u4E89\u65B0\u82B1\u8272\uFF1A\u540C\u4F34\u6700\u540E\u53EB${partnerBid ? `${partnerBid.call.level}${partnerBid.call.strain}` : "\u5C1A\u65E0\u81EA\u7136\u82B1\u8272"}\u3001\u654C\u65B9\u5DF2\u53EB${lastOpponent.call.level}${lastOpponent.call.strain}\u4E4B\u540E\uFF0C\u6B64\u7EED\u53EB\u6CA1\u6709\u56FA\u5B9A\u957F\u5EA6\u3001\u70B9\u529B\u6216\u903C\u53EB\u7EA6\u5B9A\uFF1B\u4E0D\u80FD\u6309\u9996\u6B21\u81EA\u7136\u4E89\u53EB\u81EA\u52A8\u627F\u8BFA\u4E94\u5F20${continuesGameForce ? "\uFF0C\u5DF2\u5EFA\u7ACB\u7684\u8FDB\u5C40\u903C\u53EB\u4ECD\u7EE7\u7EED" : forcedBeforeCall ? "\uFF0C\u672C\u6B21\u5C65\u884C\u4E4B\u524D\u7684\u4E00\u8F6E\u5E94\u53EB\u4E49\u52A1\uFF0C\u4F46\u4E0D\u81EA\u52A8\u5EFA\u7ACB\u65B0\u903C\u53EB" : ""}`;
  return `${SYSTEMS[system].short}\u540E\u7EED\u65B0\u82B1\u8272${call.level}${call.strain}\uFF1A\u672C\u5361\u672A\u7EA6\u5B9A\u6B64\u7EED\u53EB\u7684\u56FA\u5B9A\u957F\u5EA6\u548C\u7CBE\u786E\u70B9\u529B\uFF1B${gameReached ? "\u9009\u62E9\u6210\u5C40\u6216\u66F4\u9AD8\u5B9A\u7EA6" : continuesGameForce ? "\u5DF2\u5EFA\u7ACB\u7684\u8FDB\u5C40\u903C\u53EB\u7EE7\u7EED" : forcedBeforeCall ? "\u672C\u6B21\u5C65\u884C\u4E00\u8F6E\u5E94\u53EB\u4E49\u52A1\uFF0C\u4E0D\u81EA\u52A8\u7EE7\u7EED\u903C\u53EB" : "\u4E0D\u80FD\u4EC5\u51ED\u65B0\u82B1\u8272\u8BA4\u5B9A\u903C\u53EB"}`;
}

// scripts/replay-v033-findings.ts
var decode = (text) => text === "P" ? PASS : text === "X" ? { kind: "double" } : text === "XX" ? { kind: "redouble" } : { kind: "bid", level: +text[0], strain: text.slice(1) };
var label = (call) => call.kind === "bid" ? `${call.level}${call.strain}` : call.kind === "pass" ? "P" : call.kind === "double" ? "X" : "XX";
var hash = createHash("sha256");
for (const file of ["bidding.ts", "bidding-semantics.ts", "competition.ts", "systems.ts", "suit-evaluation.ts"]) hash.update(file).update(readFileSync(`src/ai/${file}`));
var sourceSha256 = hash.digest("hex");
var coverage = JSON.parse(readFileSync("artifacts/v033-model-review-coverage.json", "utf8"));
if (!coverage.complete) throw Error("Complete all 2000 baseline GPT reviews before replaying repairs.");
var findings = JSON.parse(readFileSync("artifacts/v033-model-review-findings.json", "utf8"));
var baseline = JSON.parse(readFileSync("artifacts/v033-baseline-auctions.json", "utf8"));
var vulnerabilities = new Map(baseline.boards.map((board) => [board.board, board.vulnerability]));
var rows = findings.filter((row) => row.callVerdict === "error" || row.meaningVerdict === "error").map((row) => {
  const hand = row.hand.split(".").flatMap((text, i) => [...text.replace("-", "")].map((symbol) => {
    const suit = ["S", "H", "D", "C"][i], rank = "23456789TJQKA".indexOf(symbol) + 2;
    return { suit, rank, id: `${suit}${rank}` };
  }));
  const auction = row.publicHistory.split(" ").filter(Boolean).map((token) => {
    const [seat, bid4] = token.split(":");
    return { seat, call: decode(bid4) };
  });
  const obs = { phase: "auction", board: row.board % 16 + 1, seat: row.seat, actingSeat: row.seat, vulnerability: vulnerabilities.get(row.board), auction, hand, legalCalls: legalCalls(auction, row.seat) };
  const chosen = chooseBid2(obs, "sayc");
  return { ...row, baselineSourceSha256: row.sourceSha256, sourceSha256, newCall: label(chosen), newMeaning: describeCall(auction, row.seat, chosen, "sayc"), originalCallNewMeaning: describeCall(auction, row.seat, decode(row.call), "sayc") };
});
writeFileSync(process.argv[2] ?? "artifacts/v033-findings-replay-observations.json", JSON.stringify({ sourceSha256, purpose: "Observations only; GPT must judge repaired calls and explanations.", rows }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ positions: rows.length, changedCalls: rows.filter((r) => r.call !== r.newCall).length, changedOriginalMeanings: rows.filter((r) => r.meaning !== r.originalCallNewMeaning).length, sourceSha256 }));
