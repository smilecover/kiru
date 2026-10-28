import { reactive } from 'vue';
import type { LogEntry, NetworkLog } from '../types/models';
import { db } from './db';
import { SettingKey } from './defaults';
import { call } from './tauri';

let seq = 1;

export const extensionLogs = reactive<LogEntry[]>([]);
export const networkLogs = reactive<NetworkLog[]>([]);
export const MAX_LOGS = 600;

function timestamp(): string {
  return new Date().toISOString();
}

export function writeLogFile(line: string): void {
  if (db.settings[SettingKey.saveLog] === false) return;
  void call('log_append', { line }).catch(() => undefined);
}

export function logInfo(message: string): void {
  const line = `[${timestamp()}] [INFO] ${message}`;
  console.info(message);
  writeLogFile(line);
}

export function logError(message: string): void {
  const line = `[${timestamp()}] [ERROR] ${message}`;
  console.error(message);
  writeLogFile(line);
}

export function addExtensionLog(
  packageName: string,
  name: string,
  level: 'info' | 'error',
  message: string,
): void {
  extensionLogs.push({
    id: seq++,
    time: Date.now(),
    level,
    package: packageName,
    name,
    message,
  });
  if (extensionLogs.length > MAX_LOGS) {
    extensionLogs.splice(0, extensionLogs.length - MAX_LOGS);
  }
  if (level === 'error') {
    writeLogFile(`[${timestamp()}] [EXT:${packageName}] [ERROR] ${message}`);
  }
}

export interface NetworkLogInput {
  packageName: string;
  name: string;
  url: string;
  method: string;
  requestHeaders?: Record<string, unknown>;
  requestBody?: unknown;
  responseBody?: string;
  responseHeaders?: Record<string, string>;
  statusCode?: number;
}

export function addNetworkLog(input: NetworkLogInput): NetworkLog {
  const existing = networkLogs.find(
    (log) =>
      log.package === input.packageName &&
      log.url === input.url &&
      log.method === input.method &&
      Date.now() - log.time < 1500,
  );
  if (existing) {
    Object.assign(existing, {
      requestHeaders: input.requestHeaders,
      requestBody: input.requestBody,
      responseBody: input.responseBody,
      responseHeaders: input.responseHeaders,
      statusCode: input.statusCode,
      time: Date.now(),
    });
    return existing;
  }
  const log: NetworkLog = {
    id: seq++,
    time: Date.now(),
    package: input.packageName,
    name: input.name,
    url: input.url,
    method: input.method,
    requestHeaders: input.requestHeaders,
    requestBody: input.requestBody,
    responseBody: input.responseBody,
    responseHeaders: input.responseHeaders,
    statusCode: input.statusCode,
  };
  networkLogs.push(log);
  if (networkLogs.length > MAX_LOGS) {
    networkLogs.splice(0, networkLogs.length - MAX_LOGS);
  }
  return log;
}

export function clearExtensionLogs(): void {
  extensionLogs.splice(0, extensionLogs.length);
}

export function clearNetworkLogs(): void {
  networkLogs.splice(0, networkLogs.length);
}
