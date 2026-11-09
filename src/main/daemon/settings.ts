// ─── Daemon settings (D4, F14, F15, F16b, F18) ───
// Kill switch, DNS, allow_lan, basis/escrow/prepay and the daemon's RPC URL live in the daemon's
// own TOML, not in gRPC. cb33 (sentinel-dvpnd, instance c0): ONE <instance dir>/config.toml holds
// every section (client keys at the top level, [network], [split], [key], [daemon], [log], [rpc],
// [tx]); the per-service whole-device flag is at <instance dir>/<svc>/config.toml. The file is
// root:sentinel-dvpn 0600 plus a read ACL for the user who ran setup, so the app reads it live.
// We read the live file, render + validate a new one (core/daemon/config.renderConfig), stage it
// under userData, and apply with one administrator prompt + service restart.
import fs from 'node:fs';
import path from 'node:path';
import { parseConfig, parseWholeDevice, readToml, renderConfig, renderServiceConfig, TUN_SERVICES, validateForApply, type DaemonSettings } from '../../core/daemon/config';
import { fullSplit, splitNotApplied } from '../../core/session/state';
import { DEFAULT_DAEMON_HOME, SERVICE_NAME, daemonInfo, deviceRecord, relinkDaemon, scriptPath } from './manager';
import { runElevated } from '../system/elevate';
import { log } from '../logger';
import { getHost } from '../host';
import { PREPAY_CAP_BYTES, PREPAY_CAP_SECONDS, prepayOverCap } from '../../shared/prepay-cap';

function home(): string {
  return deviceRecord()?.home ?? DEFAULT_DAEMON_HOME;
}

/** The ONE instance config.toml (cb33). null = not readable (no setup, or no read ACL for this user). */
function readLive(): string | null {
  try {
    return fs.readFileSync(path.join(home(), 'config.toml'), 'utf8');
  } catch (err) {
    log.warn('daemon config not readable as this user', { err: (err as Error).message });
    return null;
  }
}

function readServiceConfigs(): Partial<Record<(typeof TUN_SERVICES)[number], string>> {
  const out: Partial<Record<(typeof TUN_SERVICES)[number], string>> = {};
  for (const s of TUN_SERVICES) {
    const f = path.join(home(), s, 'config.toml');
    try {
      if (fs.existsSync(f)) out[s] = fs.readFileSync(f, 'utf8');
    } catch (err) {
      log.warn('service config not readable as this user', { service: s, err: (err as Error).message });
    }
  }
  return out;
}

/**
 * True when this V2Ray/Xray session runs in whole-device mode (utun, dvpnd -mac1+): every app is
 * already covered, so the app must not also set the system proxy (that would send proxy-aware
 * apps through the SOCKS port whatever the split tunnelling choice says). Older builds run
 * V2Ray/Xray as a SOCKS proxy only, so this is false and the app sets the system proxy.
 */
export function serviceUsesTun(service: string | null | undefined): boolean {
  if (!service || !fullSplit(process.platform, daemonInfo().version)) return false;
  const s = service.toLowerCase();
  if (!(TUN_SERVICES as readonly string[]).includes(s)) return false;
  const toml = readServiceConfigs()[s as (typeof TUN_SERVICES)[number]];
  return toml !== undefined && parseWholeDevice([toml]) === true;
}

/**
 * The split tunnelling dvpnd applies to a session of this protocol: [split] from the one config,
 * filtered by what this dvpnd build does (splitNotApplied). null = full tunnel.
 */
export function splitForSession(service: string | null | undefined): 'include' | 'exclude' | null {
  const live = readLive();
  if (!live || !service) return null;
  const mode = readToml(live, 'split', 'mode');
  if (mode !== 'include' && mode !== 'exclude') return null;
  const list = (k: string): string[] => { const v = readToml(live, 'split', k); return Array.isArray(v) ? v : []; };
  const apps = list('apps');
  if (!apps.length && !list('routes').length) return null;
  const why = splitNotApplied({
    daemonVersion: daemonInfo().version,
    service,
    killSwitch: String(readToml(live, 'network', 'kill_switch') ?? 'on'),
    wholeDevice: (TUN_SERVICES as readonly string[]).includes(service.toLowerCase()) ? serviceUsesTun(service) : undefined,
    hasApps: apps.length > 0,
    platform: process.platform,
  });
  if (why) log.info('split tunnelling not in effect for this session', { service, why });
  return why ? null : mode;
}

/** missing = the service was never set up on this computer (no config file), not a permission problem. */
export function getDaemonSettings(): { readable: boolean; missing?: boolean; settings: Partial<DaemonSettings> } {
  const live = readLive();
  if (!live) return { readable: false, missing: !fs.existsSync(path.join(home(), 'config.toml')), settings: {} };
  const wholeDevice = parseWholeDevice(Object.values(readServiceConfigs()));
  return { readable: true, settings: { ...parseConfig(live), ...(wholeDevice !== undefined ? { wholeDevice } : {}) } };
}

/** True when the installed service config is exactly what this apply staged. Exported for tests. */
export function appliedAsStaged(live: string | null, staged: string): boolean {
  return !!live && live === staged;
}

export async function applyDaemonSettings(next: DaemonSettings): Promise<{ ok: boolean; error?: string }> {
  // Q0468/Q0478: the stored http RPC gate is carried through; a newly typed RPC stays https-only.
  validateForApply(next, getDaemonSettings().settings);
  // Q0338: dvpnd caps the prepay without a word; say it once here.
  const capped = prepayOverCap(next.prepayBytes, next.prepaySeconds);
  if (capped.length) log.warn('prepay above the service cap; dvpnd will use the cap', { capped, capBytes: String(PREPAY_CAP_BYTES), capSeconds: String(PREPAY_CAP_SECONDS) });
  const live = readLive();
  if (!live) return { ok: false, error: 'This app cannot read the VPN service settings on this account. Log out and back in (setup added you to the sentinel-dvpn group), or re-run setup.' };
  const out = renderConfig(live, next);
  const staged = path.join(getHost().dataDir, 'staged');
  fs.mkdirSync(staged, { recursive: true });
  fs.writeFileSync(path.join(staged, 'config.toml'), out, 'utf8');
  // Whole-device mode: only the service configs that exist, only when the setting is given.
  for (const s of TUN_SERVICES) fs.rmSync(path.join(staged, `${s}.config.toml`), { force: true });
  if (next.wholeDevice !== undefined) {
    for (const [s, text] of Object.entries(readServiceConfigs())) {
      fs.writeFileSync(path.join(staged, `${s}.config.toml`), renderServiceConfig(text, next.wholeDevice), 'utf8');
    }
  }
  const r = await runElevated(scriptPath('apply-daemon-config.sh'), { Staged: staged, DaemonHome: home(), Service: SERVICE_NAME });
  log.info('daemon settings apply', { status: r.status, detail: r.detail });
  relinkDaemon();
  if (r.status === 'ok') return { ok: true };
  // A slow admin step can time out after the change went through (fleet bug #3): read it back.
  if (r.status === 'error' && appliedAsStaged(readLive(), out)) {
    log.info('daemon settings apply: no result, but the service config reads back as applied');
    return { ok: true };
  }
  return { ok: false, error: r.detail };
}
