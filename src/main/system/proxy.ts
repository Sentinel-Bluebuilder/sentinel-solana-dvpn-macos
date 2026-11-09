// ─── System proxy for per-app split (F16a) — macOS ───
// macOS keeps proxy settings per network service (Ethernet, Wi-Fi …) and applies them system-wide.
// `networksetup -setsocksfirewallproxy` changes them; Safari, Chrome, Edge and every app using the
// system proxy (CFNetwork) follow. The previous settings of every enabled service are saved to
// disk BEFORE we change them, so a crash is undone on the next start (restoreProxyOnStartup), and
// the uninstaller can put them back too (resources/scripts/uninstall-cleanup.sh reads the same
// file). Only V2Ray/Xray sessions expose a SOCKS endpoint. No shell: execFile argument arrays.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { readJson, writeJson, storePath } from '../store';
import { log } from '../logger';
import { patch } from '../app-state';
import { checkSocks5 } from '../../core/quality/socks-check';
import { parseNetworkServices } from './dns-check';

const BACKUP = 'proxy-backup.json';

export type ProxyBackend = 'networksetup';
export interface ServiceProxy { enabled: 'Yes' | 'No'; server: string; port: string }
/** SOCKS proxy of every enabled network service. */
export interface ProxyState { backend: ProxyBackend; services: Record<string, ServiceProxy> }

interface Saved { state: ProxyState; ours: string }

export interface ProxyRunner {
  backend(): Promise<ProxyBackend | null>;
  query(backend: ProxyBackend): Promise<ProxyState>;
  set(s: ProxyState): Promise<ProxyState>;
}

const NETWORKSETUP = '/usr/sbin/networksetup';
const run = (args: string[]): Promise<string> => new Promise((resolve, reject) => {
  execFile(NETWORKSETUP, args, { timeout: 15_000 }, (err, stdout, stderr) => {
    // networksetup prints some failures on stdout with exit 0 ("** Error: …")
    const out = String(stdout);
    if (err || /^\*\* Error/m.test(out)) reject(new Error(`networksetup ${args.slice(0, 2).join(' ')}: ${(String(stderr).trim() || out.trim()).split('\n')[0] || err?.message}`));
    else resolve(out.replace(/\n$/, ''));
  });
});

/** Parse `networksetup -getsocksfirewallproxy <svc>`. Exported for tests. */
export function parseSocksProxy(out: string): ServiceProxy {
  const get = (k: string): string => new RegExp(`^${k}:[ \\t]*(.*)$`, 'm').exec(out)?.[1]?.trim() ?? '';
  return { enabled: get('Enabled') === 'Yes' ? 'Yes' : 'No', server: get('Server'), port: get('Port') || '0' };
}

/** What we set: SOCKS on every enabled service. */
export function oursFor(endpoint: string, services: string[]): ProxyState {
  const [host, port] = endpoint.split(':');
  return { backend: 'networksetup', services: Object.fromEntries(services.map((s) => [s, { enabled: 'Yes', server: host, port }])) };
}

/** A short marker of "ours", stored with the backup: `socks <host>:<port>`. */
export function oursMarker(endpoint: string): string {
  return `socks ${endpoint}`;
}

/** Is this service's setting exactly the SOCKS proxy we made for `marker`? Exported for tests. */
export function serviceIsOurs(p: ServiceProxy | undefined, marker: string): boolean {
  const [host, port] = marker.replace(/^socks /, '').split(':');
  return !!p && p.enabled === 'Yes' && p.server === host && p.port === port;
}

/** Every service carries our setting. Exported for tests. */
export function isOurs(s: ProxyState, marker: string): boolean {
  const all = Object.values(s.services);
  return all.length > 0 && all.every((p) => serviceIsOurs(p, marker));
}

/** SOCKS off: what a service gets back when the only thing to restore was our own proxy. */
export const DIRECT_SERVICE: ServiceProxy = { enabled: 'No', server: '', port: '0' };

/**
 * A proxy this app set: SOCKS on loopback, any port (Q0281, port of the Windows app ddc80db). A leftover of ours
 * (a crash, a restore that failed) must never be saved or restored as "what the user had", or every later
 * "proxy off" puts it back on and, with no session, every app using the system proxy has no internet.
 * Exported for tests.
 */
export function looksOurs(p: ServiceProxy | undefined): boolean {
  return !!p && p.enabled === 'Yes' && p.server === '127.0.0.1' && /^\d{2,5}$/.test(p.port);
}

/** The state to save or restore, with any proxy of ours read as SOCKS off. Exported for tests. */
export function withoutOurs(s: ProxyState): ProxyState {
  return { backend: s.backend, services: Object.fromEntries(Object.entries(s.services).map(([svc, p]) => [svc, looksOurs(p) ? DIRECT_SERVICE : p])) };
}

/** What to write back: the saved value for each service still ours; others are left alone. Exported for tests. */
export function restorePlan(now: ProxyState, saved: ProxyState, marker: string): ProxyState {
  const services: Record<string, ServiceProxy> = {};
  const clean = withoutOurs(saved);
  for (const [svc, cur] of Object.entries(now.services)) {
    if (!serviceIsOurs(cur, marker) && !looksOurs(cur)) continue;
    services[svc] = clean.services[svc] ?? DIRECT_SERVICE;
  }
  return { backend: 'networksetup', services };
}

let runner: ProxyRunner = {
  async backend() {
    return fs.existsSync(NETWORKSETUP) ? 'networksetup' : null;
  },
  async query() {
    const services: Record<string, ServiceProxy> = {};
    for (const svc of parseNetworkServices(await run(['-listallnetworkservices']))) {
      services[svc] = parseSocksProxy(await run(['-getsocksfirewallproxy', svc]));
    }
    return { backend: 'networksetup', services };
  },
  async set(s) {
    for (const [svc, p] of Object.entries(s.services)) {
      // host + port first (this also turns the proxy on), the on/off state last
      if (p.server) await run(['-setsocksfirewallproxy', svc, p.server, p.port || '0']);
      await run(['-setsocksfirewallproxystate', svc, p.enabled === 'Yes' ? 'on' : 'off']);
    }
    return runner.query('networksetup');
  },
};

/** Tests only: never touch the real proxy settings. */
export function setProxyRunner(r: ProxyRunner): void {
  runner = r;
}

let socksCheck: typeof checkSocks5 = checkSocks5;
/** Tests only: replace the SOCKS liveness check. */
export function setSocksCheck(c: typeof checkSocks5): void {
  socksCheck = c;
}

/** `endpoint` = the session's proxy_endpoint, e.g. "127.0.0.1:1080". */
export async function setSystemProxy(endpoint: string): Promise<void> {
  if (!/^127\.0\.0\.1:\d{2,5}$/.test(endpoint)) throw new Error(`refusing non-loopback proxy endpoint ${endpoint}`); // copy:internal
  // A dead proxy as the system proxy cuts every app's internet: prove it works here first.
  const live = await socksCheck(endpoint);
  if (!live.ok) throw new Error(`The VPN's SOCKS proxy is not answering on this computer (${live.reason}). Nothing was changed.`);
  const backend = await runner.backend();
  if (!backend) throw new Error(`This Mac has no networksetup tool. Set SOCKS5 127.0.0.1 port ${endpoint.split(':')[1]} in your apps instead. Nothing was changed.`);
  const before = await runner.query(backend);
  if (!Object.keys(before.services).length) throw new Error('This Mac has no enabled network service to set a proxy on. Nothing was changed.');
  if (!fs.existsSync(storePath(BACKUP))) {
    const left = Object.entries(before.services).filter(([, p]) => looksOurs(p)).map(([svc]) => svc);
    if (left.length) log.warn('system proxy: found our own SOCKS proxy left on; saving SOCKS off as the setting to restore', { services: left });
    writeJson(BACKUP, { state: withoutOurs(before), ours: oursMarker(endpoint) } satisfies Saved);
  } else {
    const prev = readJson<Saved | null>(BACKUP, null);
    if (prev) writeJson(BACKUP, { ...prev, ours: oursMarker(endpoint) });
  }
  const now = await runner.set(oursFor(endpoint, Object.keys(before.services)));
  if (!isOurs(now, oursMarker(endpoint))) throw new Error('This Mac did not accept the proxy setting. Nothing else was changed.');
  patch({ proxyActive: true });
  log.info('system proxy set', { endpoint, services: Object.keys(now.services) });
}

export function systemProxyActive(): boolean {
  return fs.existsSync(storePath(BACKUP));
}

/**
 * Put back exactly what the user had. No-op when we never set it. `orphan`: an explicit "proxy off" also
 * turns off a SOCKS proxy of ours left on with no backup (Q0281); app start and session end skip that query.
 */
export async function clearSystemProxy(opts: { orphan?: boolean } = {}): Promise<void> {
  const saved = readJson<Saved | null>(BACKUP, null);
  if (!saved?.state?.services) {
    if (fs.existsSync(storePath(BACKUP))) fs.rmSync(storePath(BACKUP), { force: true });
    if (!opts.orphan || !(await runner.backend())) return;
    const now = await runner.query('networksetup');
    const left = Object.entries(now.services).filter(([, p]) => looksOurs(p)).map(([svc]) => svc);
    if (!left.length) return;
    await runner.set({ backend: 'networksetup', services: Object.fromEntries(left.map((svc) => [svc, DIRECT_SERVICE])) });
    patch({ proxyActive: false });
    log.warn('system proxy: our SOCKS proxy was on with no backup; turned off', { services: left });
    return;
  }
  try {
    // Only undo services still ours: the user may have changed one since.
    const now = await runner.query('networksetup');
    const plan = restorePlan(now, saved.state, saved.ours);
    if (Object.keys(plan.services).length) await runner.set(plan);
    const kept = Object.keys(now.services).filter((s) => !plan.services[s]);
    if (kept.length) log.info('system proxy changed by someone else since; left as it is', { services: kept });
    fs.rmSync(storePath(BACKUP), { force: true });
    patch({ proxyActive: false });
    log.info('system proxy restored', { services: Object.keys(plan.services) });
  } catch (err) {
    log.error('system proxy restore failed', err);
    throw err;
  }
}

export const restoreProxyOnStartup = clearSystemProxy;
