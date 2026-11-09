import { type BiddingNotice } from '../ai/bidding-notices';
import styles from './CallNoticeCards.module.css';

/** A static bidding-box card shared by local and LAN call surfaces. */
export function CallNoticeCards({ notices, compact = false }: { notices: BiddingNotice[]; compact?: boolean }) {
  if (!notices.length) return null;
  return <span className={`${styles.cards} ${compact ? styles.compact : ''}`}>{notices.map(notice =>
    <span key={notice.kind} data-bidding-notice={notice.kind} className={styles.card}
      title={notice.explanation} aria-label={`${notice.label}：${notice.explanation}`}>{notice.label}</span>
  )}</span>;
}
