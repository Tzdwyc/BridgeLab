export interface NativeFiles {
  saveFile(filename: string, text: string): Promise<boolean>;
  openFile(): Promise<{ name: string; text: string } | null>;
}
declare global { interface Window { BridgeLabNativeFiles?: NativeFiles } }
export function nativeFiles(): NativeFiles | null {
  const bridge = typeof window !== 'undefined' ? window.BridgeLabNativeFiles : undefined;
  return bridge && typeof bridge.saveFile === 'function' && typeof bridge.openFile === 'function' ? bridge : null;
}
