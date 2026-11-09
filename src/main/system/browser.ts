// ─── Browser through the VPN (F16.2) — macOS ───
// Starts Chrome, Chromium, Edge or Brave in its OWN profile with every request sent to the
// session's SOCKS endpoint and name lookups done by the node (no DNS from this computer for that
// window). The user's normal browser windows are not touched. Only V2Ray / Xray sessions expose
// a SOCKS endpoint today.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { storePath } from '../store';
import { log } from '../logger';

export type BrowserName = 'chrome' | 'chromium' | 'edge' | 'brave';
export const BROWSERS: BrowserName[] = ['chrome', 'chromium', 'edge', 'brave'];
export const BROWSER_TITLES: Record<BrowserName, string> = { chrome: 'Google Chrome', chromium: 'Chromium', edge: 'Microsoft Edge', brave: 'Brave Browser' };

/** App bundle name and the executable inside Contents/MacOS. */
export const BROWSER_BUNDLES: Record<BrowserName, [string, string]> = {
  chrome: ['Google Chrome.app', 'Google Chrome'],
  chromium: ['Chromium.app', 'Chromium'],
  edge: ['Microsoft Edge.app', 'Microsoft Edge'],
  brave: ['Brave Browser.app', 'Brave Browser'],
};

/** Full paths to try for `name`: /Applications, then ~/Applications (exported for tests). */
export function browserCandidates(name: BrowserName, home = os.homedir()): string[] {
  const [bundle, exe] = BROWSER_BUNDLES[name];
  return ['/Applications', path.join(home, 'Applications')].map((d) => path.join(d, bundle, 'Contents', 'MacOS', exe));
}

export function findBrowser(name: BrowserName, exists: (p: string) => boolean = fs.existsSync): string | null {
  return browserCandidates(name).find((p) => exists(p)) ?? null;
}

/** Command-line flags. Exported for tests: the DNS rule is what keeps lookups off this computer. */
export function browserArgs(endpoint: string, profileDir: string, url: string): string[] {
  if (!/^127\.0\.0\.1:\d{2,5}$/.test(endpoint)) throw new Error(`"${endpoint}" is not a local SOCKS endpoint.`);
  return [
    `--proxy-server=socks5://${endpoint}`,
    // Chrome resolves names itself unless every host is mapped away; with this rule the SOCKS5
    // proxy (the node) resolves them. 127.0.0.1 is kept so the proxy itself is reachable.
    '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-quic', // QUIC is UDP; a SOCKS5 proxy here carries TCP only.
    '--new-window',
    url,
  ];
}

export interface LaunchResult { browser: BrowserName; exe: string; endpoint: string; profileDir: string }

/** Launch the first installed browser (or the one asked for) through `endpoint`. */
export function launchBrowser(endpoint: string, want?: BrowserName, url = 'https://api.ipify.org'): LaunchResult {
  const order = want ? [want] : BROWSERS;
  for (const name of order) {
    const exe = findBrowser(name);
    if (!exe) continue;
    const profileDir = storePath(`browser-${name}`);
    fs.mkdirSync(profileDir, { recursive: true });
    // Its own --user-data-dir makes it a separate browser process even when the user's normal
    // window of the same browser is open (so the proxy flag is honoured).
    const child = spawn(exe, browserArgs(endpoint, profileDir, url), { detached: true, stdio: 'ignore' });
    child.on('error', (err) => log.error('browser launch failed', { exe, err: err.message }));
    child.unref();
    log.info('browser launched through the VPN', { browser: name, endpoint });
    return { browser: name, exe, endpoint, profileDir };
  }
  throw new Error(want ? `${BROWSER_TITLES[want]} is not installed on this Mac.` : 'None of Google Chrome, Chromium, Microsoft Edge or Brave is installed on this Mac.');
}

/** Tests / diagnostics: the browser's own version line (`Google Chrome --version`). */
export function browserVersion(exe: string): string {
  try { return execFileSync(exe, ['--version'], { encoding: 'utf8', timeout: 10_000 }).trim(); } catch (err) { log.warn('browser version unreadable', { exe, err: (err as Error).message }); return ''; }
}
