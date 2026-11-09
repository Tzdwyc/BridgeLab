import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './TableReviewControls.module.css';

/** Review only: content must contain public auction entries and completed tricks. */
export function TableReviewControls({ history, lastTrick, resetKey }: {
  history: ReactNode; lastTrick?: ReactNode | null; resetKey?: string | number;
}) {
  const [open, setOpen] = useState<'history' | 'lastTrick' | null>(null);
  const [position, setPosition] = useState({ left: 12, bottom: 76, maxHeight: 240 });
  const host = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const id = useId();
  useEffect(() => setOpen(null), [resetKey]);
  useEffect(() => { if (!lastTrick) setOpen(value => value === 'lastTrick' ? null : value); }, [lastTrick]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = host.current?.getBoundingClientRect();
      if (!rect) return;
      const bottom = Math.max(68, innerHeight - rect.top + 8);
      const width = Math.min(420, innerWidth - 24);
      setPosition({ left: Math.max(12, Math.min(rect.left, innerWidth - width - 12)), bottom, maxHeight: Math.max(80, innerHeight - bottom - 12) });
    };
    place();
    const outside = (event: PointerEvent) => {
      const node = event.target as Node;
      if (!host.current?.contains(node) && !dialog.current?.contains(node)) setOpen(null);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      host.current?.querySelector<HTMLButtonElement>(`[data-review="${open}"]`)?.focus();
      setOpen(null);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keyboard);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', keyboard);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  const toggle = (value: 'history' | 'lastTrick') => setOpen(previous => previous === value ? null : value);
  return <div ref={host} className={styles.controls} data-testid="table-review-controls">
    <button type="button" data-review="history" aria-expanded={open === 'history'} aria-controls={open === 'history' ? id : undefined} aria-haspopup="dialog" onClick={() => toggle('history')}>叫牌记录</button>
    <button type="button" data-review="lastTrick" disabled={!lastTrick} aria-expanded={open === 'lastTrick'} aria-controls={open === 'lastTrick' ? id : undefined} aria-haspopup="dialog" onClick={() => toggle('lastTrick')}>上一墩</button>
    {open && createPortal(<section ref={dialog} id={id} role="dialog" aria-labelledby={`${id}-title`} className={styles.dialog} style={position} data-testid="table-review-dialog">
      <header><h2 id={`${id}-title`}>{open === 'history' ? '叫牌记录' : '上一墩'}</h2><button type="button" aria-label="关闭记录" onClick={() => setOpen(null)}>×</button></header>
      <div className={styles.content}>{open === 'history' ? history : lastTrick}</div>
    </section>, document.body)}
  </div>;
}
