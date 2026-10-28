#!/usr/bin/env node
/**
 * Parses every locale message with vue-i18n's message compiler so syntax
 * errors (`@`, `{`, `}` and malformed interpolations) fail fast.
 *
 * Run with: pnpm check:locales
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const localesDir = join(root, 'src', 'locales');

async function loadCompiler() {
  try {
    return await import('@intlify/message-compiler');
  } catch {
    // pnpm does not hoist transitive dependencies, so resolve it from .pnpm.
  }
  const pnpmDir = join(root, 'node_modules', '.pnpm');
  let entries = [];
  try {
    entries = readdirSync(pnpmDir)
      .filter((name) => name.startsWith('@intlify+message-compiler@'))
      .sort()
      .reverse();
  } catch {
    throw new Error('node_modules not found. Run `pnpm install` first.');
  }
  for (const entry of entries) {
    const file = join(
      pnpmDir,
      entry,
      'node_modules',
      '@intlify',
      'message-compiler',
      'dist',
      'message-compiler.node.mjs',
    );
    try {
      return await import(pathToFileURL(file).href);
    } catch {
      // Try the next version.
    }
  }
  throw new Error(
    'Could not load @intlify/message-compiler. Install dependencies with `pnpm install`.',
  );
}

const { createParser } = await loadCompiler();

function walk(value, prefix, visit) {
  if (typeof value === 'string') {
    visit(prefix, value);
    return;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const [key, child] of Object.entries(value)) {
    walk(child, prefix ? `${prefix}.${key}` : key, visit);
  }
}

const files = readdirSync(localesDir)
  .filter((name) => name.endsWith('.json'))
  .sort();

let messages = 0;
let failures = 0;

for (const file of files) {
  const path = join(localesDir, file);
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    failures += 1;
    console.error(`${file}: invalid JSON - ${error.message}`);
    continue;
  }
  walk(data, '', (key, message) => {
    messages += 1;
    const errors = [];
    const parser = createParser({ onError: (error) => errors.push(error) });
    parser.parse(message);
    if (!errors.length) return;
    failures += 1;
    const detail = errors
      .map((error) => error.message)
      .filter(Boolean)
      .join(' | ');
    console.error(`${file}: ${key}\n  ${JSON.stringify(message)}\n  ${detail}`);
  });
}

if (failures > 0) {
  console.error(`\n${failures} invalid message(s) across ${messages} checked.`);
  process.exit(1);
}

console.log(`Checked ${messages} messages in ${files.length} locales: 0 errors.`);
