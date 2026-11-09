// ─── Installed + running apps for the split-tunnelling picker ───
// macOS: the .app bundles in the usual folders, resolved to their executable through Info.plist
// (`plutil`), plus running bundle executables (`ps`). Windows: resources/scripts/list-apps.ps1
// (Start Menu + running windowed programs). No admin either way; core/split/apps.ts merges and
// cleans the list. The app adds icons (Electron); the CLI does not.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { log } from '../logger';
import { scriptPath } from '../daemon/manager';
import { bundleExecutable, bundleName, isMacBundleExe, mergeApps, type AppEntry, type RawProcess, type RawShortcut } from '../../core/split/apps';

const MAC_APP_DIRS = ['/Applications', '/Applications/Utilities', '/System/Applications', '/System/Applications/Utilities', path.join(os.homedir(), 'Applications')];

function run(file: string, args: string[], timeout = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) reject(new Error(`${path.basename(file)} failed: ${err.message.slice(0, 200)}`));
      else resolve(String(stdout));
    });
  });
}

/** CFBundleExecutable of a bundle, or null (no Info.plist, not an app). */
export async function macBundleExecutable(appPath: string): Promise<string | null> {
  try {
    const exe = (await run('/usr/bin/plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', path.join(appPath, 'Contents', 'Info.plist')])).trim();
    const p = bundleExecutable(appPath, exe);
    return p && fs.existsSync(p) ? p : null;
  } catch (err) {
    log.debug('bundle executable', { appPath, err: (err as Error).message });
    return null;
  }
}

/** `ps -axo comm=` lines → running bundle executables. Exported for tests. */
export function parseMacProcesses(text: string): RawProcess[] {
  const seen = new Set<string>();
  const out: RawProcess[] = [];
  for (const line of text.split('\n')) {
    const p = line.trim();
    if (!isMacBundleExe(p) || seen.has(p)) continue;
    seen.add(p);
    out.push({ name: bundleName(p), path: p });
  }
  return out;
}

async function macApps(): Promise<{ shortcuts: RawShortcut[]; procs: RawProcess[] }> {
  const bundles: string[] = [];
  for (const dir of MAC_APP_DIRS) {
    let names: string[] = [];
    try { names = fs.readdirSync(dir); } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.debug('app folder', { dir, err: (err as Error).message });
    }
    for (const n of names) if (n.endsWith('.app')) bundles.push(path.join(dir, n));
  }
  const exes = await Promise.all(bundles.map(async (b) => ({ b, exe: await macBundleExecutable(b) })));
  const shortcuts = exes.filter((x) => x.exe).map((x) => ({ name: path.basename(x.b, '.app'), target: x.exe as string }));
  const procs = parseMacProcesses(await run('/bin/ps', ['-axo', 'comm=']));
  return { shortcuts, procs };
}

export interface AppsView { supported: boolean; apps: AppEntry[]; error: string | null }

/** ConvertTo-Json writes a one-element array as a bare object; normalise both. */
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? v : v ? [v] : []) as T[];

export function parseAppsJson(text: string): { shortcuts: RawShortcut[]; procs: RawProcess[] } {
  const raw = JSON.parse(text.replace(/^﻿/, '').trim() || '{}') as { shortcuts?: unknown; procs?: unknown };
  return {
    shortcuts: list<RawShortcut>(raw.shortcuts).filter((s) => typeof s?.target === 'string').map((s) => ({ name: String(s.name ?? ''), target: s.target })),
    procs: list<RawProcess>(raw.procs).filter((p) => typeof p?.path === 'string').map((p) => ({ name: String(p.name ?? ''), path: p.path })),
  };
}

function runScript(): Promise<string> {
  const env = { ...process.env };
  delete env.PSModulePath; // a PowerShell 7 parent breaks 5.1's module autoload (elevate.ts)
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath('list-apps.ps1')],
      { timeout: 45_000, windowsHide: true, env, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
        if (err && !stdout) reject(new Error(`app list failed: ${err.message.slice(0, 200)}`));
        else resolve(String(stdout));
      });
  });
}

/** Apps to choose from; `chosen` (paths already in [split]) are always listed, even if gone from the Start Menu. */
export async function listApps(chosen: string[] = []): Promise<AppsView> {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return { supported: false, apps: [], error: null };
  try {
    const { shortcuts, procs } = process.platform === 'darwin' ? await macApps() : parseAppsJson(await runScript());
    return { supported: true, apps: mergeApps(shortcuts, procs, chosen), error: null };
  } catch (err) {
    log.warn('app list', { err: (err as Error).message });
    return { supported: true, apps: mergeApps([], [], chosen), error: (err as Error).message };
  }
}
