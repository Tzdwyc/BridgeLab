import { createRoot } from 'react-dom/client';
import { Component, type ReactNode } from 'react';
import App from './ui/App';
import './ui/global.css';

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="fatal"><h1>BridgeLab 暂时无法显示牌桌</h1><p>已保存的牌局仍保留在本机。刷新页面会尝试恢复。</p><button onClick={() => location.reload()}>刷新并恢复</button></main>;
    return this.props.children;
  }
}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>);
