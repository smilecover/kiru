import { call } from './tauri';
import { sleep } from './util';
import type { BtStatus, ExtensionBangumiWatch } from '../types/models';

const VIDEO_EXTENSIONS = [
  '.mp4',
  '.mkv',
  '.webm',
  '.avi',
  '.mov',
  '.m4v',
  '.ts',
  '.m2ts',
  '.flv',
  '.wmv',
  '.mpg',
  '.mpeg',
];

const SUBTITLE_EXTENSIONS = ['.srt', '.ass', '.ssa', '.vtt', '.ttml'];

export function lowerExtension(filename: string): string {
  const clean = filename.split('?')[0]?.split('#')[0] ?? filename;
  const index = clean.lastIndexOf('.');
  return index >= 0 ? clean.slice(index).toLowerCase() : '';
}

export function isVideoFile(filename: string): boolean {
  return VIDEO_EXTENSIONS.includes(lowerExtension(filename));
}

export function isSubtitleFile(filename: string): boolean {
  return SUBTITLE_EXTENSIONS.includes(lowerExtension(filename));
}

export function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export interface TorrentSubtitleStream {
  file: string;
  title: string;
  url: string;
}

export interface TorrentStream {
  infoHash: string;
  files: string[];
  mediaFile: string;
  streamUrl: string;
  subtitles: TorrentSubtitleStream[];
}

export async function waitForBtServer(timeoutMs = 18_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const status = await call<BtStatus>('bt_status');
      if (status.running) return;
    } catch {
      // Server still starting.
    }
    await sleep(400);
  }
  throw new Error('BT Server did not start in time');
}

export async function ensureBtServer(): Promise<void> {
  await call('bt_start');
  await waitForBtServer();
}

function pickMediaFile(files: string[]): string | undefined {
  return (
    files.find(isVideoFile) ??
    files.find((file) => !isSubtitleFile(file)) ??
    files[0]
  );
}

/**
 * Starts the BT server, adds a torrent and resolves the first playable file
 * plus every subtitle file into localhost stream URLs.
 */
export async function resolveTorrentStream(
  watch: Pick<ExtensionBangumiWatch, 'url' | 'headers'>,
  onPhase?: (phase: 'starting' | 'adding' | 'files') => void,
): Promise<TorrentStream> {
  onPhase?.('starting');
  await ensureBtServer();
  onPhase?.('adding');
  const infoHash = await call<string>('bt_add_torrent', {
    url: watch.url,
    headers: watch.headers ?? {},
  });

  onPhase?.('files');
  let files: string[] = [];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    files = await call<string[]>('bt_files', { infoHash });
    if (files.length > 0) break;
    await sleep(500);
  }
  if (files.length === 0) {
    throw new Error('The torrent contains no files');
  }

  const mediaFile = pickMediaFile(files);
  if (!mediaFile) throw new Error('No playable file found in torrent');
  const streamUrl = await call<string>('bt_stream_url', { infoHash, file: mediaFile });
  const subtitleStreams = await Promise.all(
    files
      .filter(isSubtitleFile)
      .map(async (file) => ({
        file,
        title: basename(file),
        url: await call<string>('bt_stream_url', { infoHash, file }),
      })),
  );

  return { infoHash, files, mediaFile, streamUrl, subtitles: subtitleStreams };
}

export async function torrentFileUrl(
  infoHash: string,
  file: string,
): Promise<string> {
  return call<string>('bt_stream_url', { infoHash, file });
}

export async function removeTorrent(infoHash: string): Promise<void> {
  try {
    await call('bt_remove_torrent', { infoHash });
  } catch {
    // Torrent may already be gone or the server may have stopped.
  }
}
