import { useMemo, useState } from 'react';
import { deck } from '../core/deal';
import { type Seat, type Suit, type Vulnerability, SEATS, SUITS } from '../core/types';
import { rankLabel, seatName, vulnerabilityName } from '../ui/format';
import { SuitGlyph } from '../ui/SuitGlyph';
import { assignmentsFromHands, deleteDeal, emptyAssignments, handsFromAssignments, loadDealLibrary, newDealId, saveDeal, type CardAssignments, type DealDefinition } from './model';
import styles from './DealEditorPage.module.css';

const cards = deck();
const suits = [...SUITS].reverse();
export default function DealEditorPage({ onStart }: { onStart: (deal: DealDefinition) => void }) {
  const [deals, setDeals] = useState(() => { try { return loadDealLibrary(localStorage); } catch { return []; } });
  const [assignments, setAssignments] = useState<CardAssignments>(() => emptyAssignments());
  const [selectedSeat, setSelectedSeat] = useState<Seat>('N');
  const [selectedSuit, setSelectedSuit] = useState<Suit>('S');
  const [view, setView] = useState<'edit' | 'library'>('edit');
  const [libraryPage, setLibraryPage] = useState(0);
  const [metaOpen, setMetaOpen] = useState(false);
  const [id, setId] = useState(() => newDealId());
  const [name, setName] = useState('');
  const [dealer, setDealer] = useState<Seat>('N');
  const [vulnerability, setVulnerability] = useState<Vulnerability>('None');
  const [notice, setNotice] = useState<string | null>(null);
  const counts = useMemo(() => Object.fromEntries(SEATS.map(seat => [seat, Object.values(assignments).filter(value => value === seat).length])) as Record<Seat, number>, [assignments]);
  const clear = () => { setAssignments(emptyAssignments()); setId(newDealId()); setName(''); setDealer('N'); setVulnerability('None'); setNotice(null); setView('edit'); };
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
    setAssignments(assignmentsFromHands(deal.hands)); setNotice(`已载入“${deal.name}”`); setView('edit');
  };
  const remove = (deal: DealDefinition) => {
    if (!window.confirm(`删除牌例“${deal.name}”？`)) return;
    try { setDeals(deleteDeal(localStorage, deal.id)); if (deal.id === id) clear(); }
    catch (error) { setNotice(error instanceof Error ? error.message : '牌例无法删除'); }
  };
  const hand = (seat: Seat) => <div className={styles.hand} key={seat} data-testid={`editor-hand-${seat}`}><b>{seatName[seat]}家 · {counts[seat]} / 13</b>{suits.map(suit => <div className={styles.handSuit} key={suit}><SuitGlyph suit={suit} /><span>{cards.filter(card => card.suit === suit && assignments[card.id] === seat).reverse().map(card => rankLabel(card.rank)).join(' ') || '—'}</span></div>)}</div>;
  const pageCount = Math.max(1, Math.ceil(deals.length / 3));
  const safePage = Math.min(libraryPage, pageCount - 1);
  return <section className={styles.page} data-testid="deal-editor">
    <header className={styles.intro}><div><span>DEAL WORKBENCH</span><h1>牌例工作台</h1></div><button onClick={clear} data-testid="new-deal">新建</button></header>
    <div className={styles.toolbar}><div className={styles.tabs} role="tablist" aria-label="工作台视图"><button role="tab" aria-selected={view === 'edit'} onClick={() => setView('edit')}>分配手牌</button><button role="tab" aria-selected={view === 'library'} onClick={() => setView('library')}>保存库 · {deals.length}</button></div><button className={styles.metaButton} onClick={() => setMetaOpen(true)} data-testid="deal-metadata"><span>{name || '未命名牌例'}</span><small>{seatName[dealer]}发牌 · {vulnerabilityName[vulnerability]} · 设置</small></button></div>
    {view === 'edit' ? <div className={styles.editor} data-testid="deal-editor-panel">
      <div className={styles.seats} role="tablist" aria-label="当前分配位置">{SEATS.map(seat => <button key={seat} role="tab" aria-selected={selectedSeat === seat} onClick={() => setSelectedSeat(seat)}><b>{seatName[seat]}家</b><span>{counts[seat]} / 13</span></button>)}</div>
      <div className={styles.editorBody}>
        <div className={styles.mobileHand}>{hand(selectedSeat)}</div>
        <div className={styles.deckPanel}><div className={styles.suitTabs} role="tablist" aria-label="待分配花色">{suits.map(suit => <button key={suit} role="tab" aria-selected={selectedSuit === suit} onClick={() => setSelectedSuit(suit)} aria-label={`${suit} 花色`}><SuitGlyph suit={suit} /></button>)}</div><div className={styles.deck} data-testid="assignment-deck">{suits.map(suit => <div className={styles.suitRow} data-active={suit === selectedSuit} key={suit}><strong><SuitGlyph suit={suit} /></strong><div>{cards.filter(card => card.suit === suit).reverse().map(card => { const owner = assignments[card.id]; return <button key={card.id} className={owner ? styles.assigned : ''} data-owner={owner ?? ''} data-testid={`assign-${card.id}`} aria-label={`${rankLabel(card.rank)}${suit} ${owner ? `已分给${seatName[owner]}家` : '未分配'}`} onClick={() => selectCard(card.id)}><span>{rankLabel(card.rank)}</span><small>{owner ? seatName[owner] : '—'}</small></button>; })}</div></div>)}</div><p className={styles.help}>点牌分给{seatName[selectedSeat]}家，再点可移回。四家各 13 张即可保存。</p></div>
        <aside className={styles.summary} aria-label="四家手牌摘要">{SEATS.map(hand)}</aside>
      </div>
    </div> : <div className={styles.library} data-testid="deal-library"><h2>已保存牌例</h2><div className={styles.libraryItems}>{deals.slice(safePage * 3, safePage * 3 + 3).map(deal => <article key={deal.id}><button className={styles.load} onClick={() => load(deal)}><b>{deal.name}</b><span>{seatName[deal.dealer]}家发牌 · {vulnerabilityName[deal.vulnerability]}</span></button><button className={styles.delete} aria-label={`删除牌例 ${deal.name}`} onClick={() => remove(deal)}>删除</button></article>)}{!deals.length && <p>尚未保存牌例。完成分配后可在下方保存。</p>}</div><nav className={styles.pagination} aria-label="保存库分页"><button disabled={safePage === 0} onClick={() => setLibraryPage(safePage - 1)}>上一页</button><span>{safePage + 1} / {pageCount}</span><button disabled={safePage + 1 === pageCount} onClick={() => setLibraryPage(safePage + 1)}>下一页</button></nav></div>}
    <footer className={styles.footer}>{notice && <p className={styles.notice} role="alert">{notice}<button aria-label="关闭提示" onClick={() => setNotice(null)}>×</button></p>}<div className={styles.actions}><span>{Object.values(counts).reduce((sum, value) => sum + value, 0)} / 52 已分配</span><button onClick={persist} data-testid="save-deal">保存牌例</button><button className={styles.primary} data-testid="simulate-deal" onClick={() => { const deal = persist(); if (deal) onStart(deal); }}>保存并模拟</button></div></footer>
    {metaOpen && <div className={styles.backdrop} onClick={() => setMetaOpen(false)}><section className={styles.metaDialog} role="dialog" aria-modal="true" aria-label="牌例设置" onClick={event => event.stopPropagation()}><h2>牌例设置</h2><label>牌例名称<input autoFocus aria-label="牌例名称" value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder="为这副牌命名" /></label><div className={styles.metaGrid}><label>发牌人<select aria-label="发牌人" value={dealer} onChange={event => setDealer(event.target.value as Seat)}>{SEATS.map(seat => <option key={seat} value={seat}>{seatName[seat]}家</option>)}</select></label><label>局况<select aria-label="局况" value={vulnerability} onChange={event => setVulnerability(event.target.value as Vulnerability)}>{(['None', 'NS', 'EW', 'Both'] as Vulnerability[]).map(value => <option key={value} value={value}>{vulnerabilityName[value]}</option>)}</select></label></div><button className={styles.primary} onClick={() => setMetaOpen(false)}>完成</button></section></div>}
  </section>;
}
