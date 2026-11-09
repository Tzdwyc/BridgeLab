import { Children, cloneElement, useEffect, useRef, useState, type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './ExplainedCall.module.css';

/** Lazy public-call notes. A changed callback alone does not change the auction. */
export function ExplainedCall({ explanation, contextKey, children, className, focusable = false, asChild = false }: {
  explanation: string | (() => string); contextKey: string; children: ReactNode;
  className?: string; focusable?: boolean; asChild?: boolean;
}) {
  const host = useRef<HTMLElement>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const hold = useRef<number | null>(null), consumed = useRef(false);
  const [resolvedExplanation, setResolvedExplanation] = useState<string | null>(null);
  const cancelHold = () => { if (hold.current !== null) window.clearTimeout(hold.current); hold.current = null; };
  const show = () => {
    const rect = host.current?.getBoundingClientRect();
    if (!rect) return;
    setResolvedExplanation(typeof explanation === 'function' ? explanation() : explanation);
    const halfWidth = Math.min(290, innerWidth - 32) / 2;
    setAnchor({ left: Math.min(innerWidth - 16 - halfWidth, Math.max(16 + halfWidth, rect.left + rect.width / 2)),
      top: rect.bottom + 8, above: rect.bottom + 150 > innerHeight });
  };
  const directText = typeof explanation === 'string' ? explanation : null;
  useEffect(() => {
    cancelHold(); consumed.current = false; setAnchor(null); setResolvedExplanation(null);
  }, [contextKey, directText]);
  useEffect(() => () => cancelHold(), []);
  useEffect(() => {
    if (!anchor) return;
    const close = () => setAnchor(null);
    const outside = (event: PointerEvent) => { if (!host.current?.contains(event.target as Node)) close(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    window.addEventListener('scroll', close, true); window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape);
      window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close);
    };
  }, [anchor]);
  const handlers: HTMLAttributes<HTMLElement> = {
    onPointerEnter: event => { if (event.pointerType === 'mouse') show(); },
    onPointerLeave: event => { cancelHold(); if (event.pointerType === 'mouse') setAnchor(null); },
    onFocus: show, onBlur: () => setAnchor(null),
    onPointerDown: event => {
      if (event.pointerType !== 'touch') return;
      cancelHold(); consumed.current = false;
      hold.current = window.setTimeout(() => { consumed.current = true; show(); }, 550);
    },
    onPointerUp: cancelHold, onPointerCancel: cancelHold,
    onClickCapture: event => {
      if (consumed.current) { event.preventDefault(); event.stopPropagation(); consumed.current = false; }
    },
    onContextMenu: event => { event.preventDefault(); show(); },
  };
  const data = { 'data-open': !!anchor || undefined,
    'data-explanation': directText ?? resolvedExplanation ?? '', 'aria-description': resolvedExplanation ?? undefined };
  let content: ReactNode;
  if (asChild) {
    // Keep an existing button or table cell in its original grid/table position.
    // Its onClick, disabled state, and other action props remain untouched.
    const child = Children.only(children) as ReactElement<HTMLAttributes<HTMLElement>>;
    const merged = { ...handlers };
    for (const name of Object.keys(handlers) as Array<keyof HTMLAttributes<HTMLElement>>) {
      const previous = child.props[name], current = handlers[name];
      if (typeof previous === 'function' && typeof current === 'function') {
        Object.assign(merged, { [name]: (event: never) => { previous(event); current(event); } });
      }
    }
    content = cloneElement(child, { ...merged, ...data, ref: host,
      className: [child.props.className, className].filter(Boolean).join(' ') || undefined } as HTMLAttributes<HTMLElement>);
  } else {
    content = <span ref={node => { host.current = node; }} className={[styles.host, className].filter(Boolean).join(' ')}
      tabIndex={focusable ? 0 : undefined} {...data} {...handlers}>{children}</span>;
  }
  return <>{content}{anchor && createPortal(<span className={styles.tooltip} role="tooltip" data-above={anchor.above || undefined}
    style={{ left: anchor.left, top: anchor.above ? host.current!.getBoundingClientRect().top - 8 : anchor.top }}>
    {resolvedExplanation ?? directText ?? ''}<small>电脑悬停 · 手机长按</small>
  </span>, document.body)}</>;
}
