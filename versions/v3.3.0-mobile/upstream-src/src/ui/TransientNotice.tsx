import { useEffect, useRef } from 'react';
import styles from './TransientNotice.module.css';

export function TransientNotice({ text, onClose, tone = 'status', closeLabel = '关闭提示' }: {
  text: string;
  onClose: () => void;
  tone?: 'status' | 'error';
  closeLabel?: string;
}) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const timer = window.setTimeout(() => close.current(), tone === 'error' ? 5000 : 2000);
    return () => window.clearTimeout(timer);
  }, [text, tone]);
  return <div className={styles.notice} data-tone={tone} role={tone === 'error' ? 'alert' : 'status'}>
    <span>{text}</span><button type="button" aria-label={closeLabel} onClick={onClose}>×</button>
  </div>;
}
