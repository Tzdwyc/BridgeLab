import { useMemo, useState } from 'react';
import { deck } from '../core/deal';
import { type Seat, type Vulnerability, SEATS, SUITS } from '../core/types';
import { rankLabel, seatName, vulnerabilityName } from '../ui/format';
import { SuitGlyph } from '../ui/SuitGlyph';
import { assignmentsFromHands, deleteDeal, emptyAssignments, handsFromAssignments, loadDealLibrary, newDealId, saveDeal, type CardAssignments, type DealDefinition } from './model';
import styles from './DealEditorPage.module.css';

export default function DealEditorPage({ onStart }: { onStart: (deal: DealDefinition) => void }) {
  const [deals, setDeals] = useState(() => { try { return loadDealLibrary(localStorage); } catch { return []; } });
  const [assignments, setAssignments] = useState<CardAssignments>(() => emptyAssignments());
  const [selectedSeat, setSelectedSeat] = useState<Seat>('N');
  const [id, setId] = useState(() => newDealId());
  const [name, setName] = useState('');
  const [dealer, setDealer] = useState<Seat>('N');
  const [vulnerability, setVulnerability] = useState<Vulnerability>('None');
  const [notice, setNotice] = useState<string | null>(null);
  const counts = useMemo(() => Object.fromEntries(SEATS.map(seat => [seat, Object.values(assignments).filter(value => value === seat).length])) as Record<Seat, number>, [assignments]);

  const clear = () => { setAssignments(emptyAssignments()); setId(newDealId()); setName(''); setDealer('N'); setVulnerability('None'); setNotice(null); };
  const selectCard = (cardId: string) => {
    const current = assignments[cardId];
    if (current !== selectedSeat && counts[selectedSeat] >= 13) { setNotice(`${seatName[selectedSeat]}家已经有 13 张牌`); return; }
    setAssignments({ ...assignments, [cardId]: current === selectedSeat ? undefined : selectedSeat }); setNotice(null);
  };
  const definition = (): DealDefinition => ({ id, name, dealer, vulnerability, hands: handsFromAssignments(assignments) });
  const persist = () => {
    try { const deal = definition(); setDeals(saveDeal(localStorage, deal)); setNotice(`已保存“${deal.name}”`); return deal; }
    catch (error) { setNotice(error instanceof Error ? error.message : '牌例无法保存'); return null; }
  };
  const load = (deal: DealDefinition) => {
    setId(deal.id); setName(deal.name); setDealer(deal.dealer); setVulnerability(deal.vulnerability);
    setAssignments(assignmentsFromHands(deal.hands)); setNotice(`已载入“${deal.name}”`);
  };
  const remove = (deal: DealDefinition) => {
    if (!window.confirm(`删除牌例“${deal.name}”？`)) return;
    try { setDeals(deleteDeal(localStorage, deal.id)); if (deal.id === id) clear(); }
    catch (error) { setNotice(error instanceof Error ? error.message : '牌例无法删除'); }
  };

  return <section className={styles.page} data-testid="deal-editor">
    <div className={styles.intro}><div><span>DEAL WORKBENCH</span><h1>牌例工作台</h1><p>选择一家，再点击牌张完成分配。四家各 13 张、全部 52 张无重复后，可保存并进入正常叫牌、完整打牌和牌后双明手分析。</p></div><button onClick={clear}>新建空白牌例</button></div>
    <div className={styles.layout}><div className={styles.editor}>
      <div className={styles.meta}>
        <label>牌例名称<input aria-label="牌例名称" value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder="例如：北家 8 HCP 应叫" /></label>
        <label>发牌人<select aria-label="发牌人" value={dealer} onChange={event => setDealer(event.target.value as Seat)}>{SEATS.map(seat => <option key={seat} value={seat}>{seatName[seat]}家</option>)}</select></label>
        <label>局况<select aria-label="局况" value={vulnerability} onChange={event => setVulnerability(event.target.value as Vulnerability)}>{(['None', 'NS', 'EW', 'Both'] as Vulnerability[]).map(value => <option key={value} value={value}>{vulnerabilityName[value]}</option>)}</select></label>
      </div>
      <div className={styles.seats} role="tablist" aria-label="当前分配位置">{SEATS.map(seat => <button key={seat} role="tab" aria-selected={selectedSeat === seat} onClick={() => setSelectedSeat(seat)}><b>{seatName[seat]}家</b><span>{counts[seat]} / 13</span></button>)}</div>
      <div className={styles.deck}>{[...SUITS].reverse().map(suit => <div className={styles.suitRow} key={suit}><strong><SuitGlyph suit={suit} /></strong><div>{deck().filter(card => card.suit === suit).reverse().map(card => { const owner = assignments[card.id]; return <button key={card.id} className={owner ? styles.assigned : ''} data-owner={owner ?? ''} aria-label={`${rankLabel(card.rank)}${suit} ${owner ? `已分给${seatName[owner]}家` : '未分配'}`} onClick={() => selectCard(card.id)}><span>{rankLabel(card.rank)}</span><small>{owner ? seatName[owner] : '—'}</small></button>; })}</div></div>)}</div>
      <div className={styles.summary}>{SEATS.map(seat => <div key={seat}><b>{seatName[seat]}家 · {counts[seat]} 张</b><p>{[...SUITS].reverse().map(suit => `${suit}:${deck().filter(card => card.suit === suit && assignments[card.id] === seat).reverse().map(card => rankLabel(card.rank)).join('') || '—'}`).join('　')}</p></div>)}</div>
      {notice && <p className={styles.notice} role="alert">{notice}</p>}
      <div className={styles.actions}><button onClick={persist}>保存牌例</button><button className={styles.primary} onClick={() => { const deal = persist(); if (deal) onStart(deal); }}>保存并开始模拟</button></div>
    </div><aside className={styles.library}><h2>已保存牌例</h2>{deals.length ? deals.map(deal => <article key={deal.id}><button className={styles.load} onClick={() => load(deal)}><b>{deal.name}</b><span>{seatName[deal.dealer]}家发牌 · {vulnerabilityName[deal.vulnerability]}</span></button><button className={styles.delete} aria-label={`删除牌例 ${deal.name}`} onClick={() => remove(deal)}>删除</button></article>) : <p>尚未保存牌例。</p>}</aside></div>
  </section>;
}
