import { getCurrentWindow, LogicalPosition, LogicalSize } from '@tauri-apps/api/window';
import { db, persist } from './db';
import { SettingKey } from './defaults';
import { isTauri } from './util';

const MIN_WIDTH = 960;
const MIN_HEIGHT = 600;

function parsePair(value: unknown): [number, number] | null {
  if (typeof value !== 'string') return null;
  const [first, second] = value.split(',').map((part) => Number(part.trim()));
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
  return [first, second];
}

function clampToScreen(width: number, height: number, x?: number, y?: number): {
  width: number;
  height: number;
  x?: number;
  y?: number;
} {
  const availWidth = Math.max(MIN_WIDTH, window.screen?.availWidth ?? 1280);
  const availHeight = Math.max(MIN_HEIGHT, window.screen?.availHeight ?? 800);
  const nextWidth = Math.min(Math.max(MIN_WIDTH, width), availWidth);
  const nextHeight = Math.min(Math.max(MIN_HEIGHT, height), availHeight);
  if (x === undefined || y === undefined) {
    return { width: nextWidth, height: nextHeight };
  }
  const nextX = Math.min(Math.max(0, x), Math.max(0, availWidth - 160));
  const nextY = Math.min(Math.max(0, y), Math.max(0, availHeight - 80));
  return { width: nextWidth, height: nextHeight, x: nextX, y: nextY };
}

export async function restoreWindowState(): Promise<void> {
  if (!isTauri()) return;
  const win = getCurrentWindow();
  try {
    const size = parsePair(db.settings[SettingKey.windowSize]);
    const position = parsePair(db.settings[SettingKey.windowPosition]);
    if (size) {
      const [width, height] = size;
      if (width >= MIN_WIDTH && height >= MIN_HEIGHT) {
        const target = clampToScreen(
          width,
          height,
          position?.[0],
          position?.[1],
        );
        await win.setSize(new LogicalSize(target.width, target.height));
        if (target.x !== undefined && target.y !== undefined) {
          await win.setPosition(new LogicalPosition(target.x, target.y));
        }
      }
    }
  } catch (error) {
    console.warn('[window] failed to restore window state', error);
  }
}

export async function trackWindowState(): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const win = getCurrentWindow();
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function saveState(): Promise<void> {
    try {
      if (await win.isMaximized()) return;
      if (await win.isFullscreen()) return;
      const [size, position] = await Promise.all([
        win.innerSize(),
        win.outerPosition(),
      ]);
      const scale = await win.scaleFactor();
      const width = Math.round(size.width / scale);
      const height = Math.round(size.height / scale);
      const x = Math.round(position.x / scale);
      const y = Math.round(position.y / scale);
      if (width < MIN_WIDTH || height < MIN_HEIGHT) return;
      db.settings[SettingKey.windowSize] = `${width},${height}`;
      db.settings[SettingKey.windowPosition] = `${x},${y}`;
      persist();
    } catch {
      /* window is closing */
    }
  }

  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void saveState();
    }, 500);
  }

  const unlisteners: (() => void)[] = [];
  try {
    unlisteners.push(await win.onResized(schedule));
    unlisteners.push(await win.onMoved(schedule));
  } catch (error) {
    console.warn('[window] failed to track window state', error);
  }
  return () => {
    if (timer) clearTimeout(timer);
    for (const unlisten of unlisteners) unlisten();
  };
}
