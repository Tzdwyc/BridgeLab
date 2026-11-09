import { useEffect, useState } from 'react';
import styles from './App.module.css';

type Appearance = { size: 'standard' | 'large'; cards: 'two-color' | 'four-color'; motion: boolean };
const KEY = 'bridgelab.ui.appearance.v3.1';
const defaults: Appearance = { size: 'standard', cards: 'two-color', motion: true };
function read(): Appearance {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return { size: value?.size === 'large' ? 'large' : 'standard', cards: value?.cards === 'four-color' ? 'four-color' : 'two-color', motion: value?.motion !== false };
  } catch { return defaults; }
}
function apply(value: Appearance) {
  document.documentElement.dataset.uiSize = value.size;
  document.documentElement.dataset.cardTheme = value.cards;
  document.documentElement.dataset.motion = value.motion ? 'on' : 'off';
}
/** Appearance is independent of game/session storage and applies to every page. */
export function useAppearance() {
  const [value, setValue] = useState<Appearance>(read);
  useEffect(() => { apply(value); try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* Preferences remain usable when storage is unavailable. */ } }, [value]);
  return { value, update: (patch: Partial<Appearance>) => setValue(previous => ({ ...previous, ...patch })) };
}
export function AppearanceSettings({ appearance }: { appearance: ReturnType<typeof useAppearance> }) {
  const { value, update } = appearance;
  return <section aria-label="外观设置" className={styles.appearanceSettings}><h3>外观与阅读</h3>
    <div className={styles.fieldLabel}>文字大小<div className={styles.settingChoices} role="group" aria-label="文字大小"><button aria-pressed={value.size === 'standard'} onClick={() => update({ size: 'standard' })}>标准</button><button aria-pressed={value.size === 'large'} onClick={() => update({ size: 'large' })}>大字 · 125%</button></div></div>
    <div className={styles.fieldLabel}>牌面花色<div className={styles.settingChoices} role="group" aria-label="牌面花色"><button aria-pressed={value.cards === 'two-color'} onClick={() => update({ cards: 'two-color' })}>传统黑红</button><button aria-pressed={value.cards === 'four-color'} onClick={() => update({ cards: 'four-color' })}>四色花色</button></div></div>
    <div className={styles.fieldLabel}>牌桌动画<div className={styles.settingChoices} role="group" aria-label="牌桌动画"><button aria-pressed={value.motion} onClick={() => update({ motion: true })}>开启</button><button aria-pressed={!value.motion} onClick={() => update({ motion: false })}>关闭</button></div></div>
  </section>;
}
