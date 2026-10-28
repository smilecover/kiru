import { invoke } from '@tauri-apps/api/core';

/**
 * Typed convenience wrapper around Tauri invoke. The application is normally
 * always hosted inside Tauri; during plain browser development the calls fail
 * gracefully and the caller can decide how to degrade.
 */
export async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args);
}

export async function tryCall<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    console.warn(`[tauri] ${command} failed`, error);
    return null;
  }
}

export function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}
