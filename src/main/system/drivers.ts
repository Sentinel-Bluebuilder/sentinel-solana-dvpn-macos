// ─── VPN drivers / tools (F1, F17) — macOS ───
// What dvpnd needs on the Mac: WireGuard (wg, wg-quick, wireguard-go, bash 4+), AmneziaWG
// (awg, awg-quick, amneziawg-go; built from pinned source), OpenVPN, pf (kill switch) and
// networksetup (DNS). V2Ray, Xray and Hysteria2 ship in the app. Homebrew installs the tools as
// the Mac user (never root); setup copies them into the root-owned /usr/local/lib/devnet-dvpn
// and records a report there. The app (or CLI) re-checks the live state with the same script
// (--CheckOnly: no root, installs nothing) and can repair with one administrator prompt.
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getHost } from '../host';
import { log } from '../logger';
import { runElevated } from './elevate';
import { scriptPath, loginName } from '../daemon/manager';

export type DriverStatus = 'present' | 'installed' | 'upgraded' | 'missing' | 'failed' | 'incompatible';
export interface DriverRow { name: string; wanted: string; found: string; status: DriverStatus; detail: string }
export interface DriverReport { at: string; ok: boolean; rebootRequired: boolean; deps: DriverRow[] }
export interface DriversView {
  supported: boolean;
  live: DriverReport | null;
  /** What the package install did, if it ran on this computer. */
  installer: DriverReport | null;
  error: string | null;
}

export const DRIVER_LABELS: Record<string, string> = {
  macos: 'macOS 12 or newer',
  homebrew: 'Homebrew',
  wireguard: 'WireGuard tools',
  amneziawg: 'AmneziaWG (userspace)',
  openvpn: 'OpenVPN',
  pf: 'pf (kill switch)',
  dns: 'DNS (networksetup)',
};

const installerReportPath = (): string => '/Library/devnet-dvpn/install-deps.json';

/** Parse a report the script wrote. Exported for tests. */
export function parseReport(text: string): DriverReport | null {
  const raw = JSON.parse(text.replace(/^﻿/, '')) as Partial<DriverReport> & { deps?: DriverRow[] | DriverRow };
  if (typeof raw !== 'object' || raw === null) return null;
  const deps = Array.isArray(raw.deps) ? raw.deps : raw.deps ? [raw.deps] : [];
  return { at: String(raw.at ?? ''), ok: raw.ok === true, rebootRequired: raw.rebootRequired === true, deps };
}

function readInstallerReport(): DriverReport | null {
  const p = installerReportPath();
  if (!fs.existsSync(p)) return null;
  try {
    return parseReport(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    log.warn('installer driver report unreadable', { err: (err as Error).message });
    return null;
  }
}

/** Run the script in --CheckOnly mode; never installs, never prompts. */
function checkLive(): Promise<DriverReport> {
  const out = path.join(getHost().dataDir, 'drivers-check');
  fs.mkdirSync(out, { recursive: true });
  return new Promise((resolve, reject) => {
    execFile('/bin/bash', [scriptPath('install-deps.sh'), '--CheckOnly', '1', '--OutDir', out], { timeout: 60_000 }, (err) => {
      // Exit 2 = "something missing": the report is still written and is the answer.
      const file = path.join(out, 'install-deps.json');
      if (fs.existsSync(file)) {
        try {
          const r = parseReport(fs.readFileSync(file, 'utf8'));
          if (r) { resolve(r); return; }
        } catch (parseErr) {
          reject(new Error(`driver check report unreadable: ${(parseErr as Error).message}`));
          return;
        }
      }
      reject(new Error(err ? `driver check failed: ${err.message.slice(0, 200)}` : 'driver check wrote no report'));
    });
  });
}

export async function driversStatus(): Promise<DriversView> {
  const installer = readInstallerReport();
  try {
    return { supported: true, live: await checkLive(), installer, error: null };
  } catch (err) {
    log.warn('driver check', { err: (err as Error).message });
    return { supported: true, live: null, installer, error: (err as Error).message };
  }
}

// ─── Repair: a long user phase, then one short administrator step ───
// On an Intel Mac Homebrew has no ready-made packages for openvpn/bash/go and builds them from
// source (over an hour on the test rig). That work runs as the user, outside the administrator
// step: an elevated step with a time limit was killed at 30 min while Homebrew kept building as
// an orphan, and the tools were never copied for the service (the macOS app, 2026-10-22).
const USER_PHASE_LIMIT_MS = 4 * 60 * 60 * 1000;
const COPY_STEP_MS = 300_000;
export const driversInstallLog = (): string => path.join(getHost().dataDir, 'drivers-install.log');

/** A line worth showing while the user phase runs (exported for tests): our stages, Homebrew's steps. */
export function progressLine(raw: string): string | null {
  // eslint-disable-next-line no-control-regex
  const l = raw.replace(/\x1b\[[0-9;]*m/g, '').trim();
  const ours = /^PROGRESS (.+)$/.exec(l);
  if (ours) return ours[1];
  const brew = /^==> ((?:Installing|Pouring|Upgrading|Downloading|Fetching|Building|\.\/configure|make|cmake).*)$/i.exec(l);
  if (brew) return `Homebrew: ${brew[1]}`.slice(0, 160);
  if (/^🍺/u.test(l)) return `Homebrew: done ${l.replace(/^🍺\s*/u, '').split(':')[0].split('/').slice(-2, -1)[0] ?? ''}`.trim();
  return null;
}

function runUserPhase(onProgress: (line: string) => void): Promise<{ code: number | null; last: string }> {
  const logFile = driversInstallLog();
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const out = fs.createWriteStream(logFile, { flags: 'w', mode: 0o600 });
  return new Promise((resolve) => {
    const child = spawn('/bin/bash', [scriptPath('install-deps.sh'), '--UserPhase', '1'], { env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1' } });
    let last = '';
    let rest = '';
    const onData = (buf: Buffer): void => {
      out.write(buf);
      const lines = (rest + buf.toString('utf8')).split('\n');
      rest = lines.pop() ?? '';
      for (const raw of lines) {
        const shown = progressLine(raw);
        if (shown) onProgress(shown);
        const t = raw.replace(/\x1b\[[0-9;]*m/g, '').trim(); // eslint-disable-line no-control-regex
        if (t) last = t;
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => {
      log.warn('driver user phase over its limit: stopping it', { limitMs: USER_PHASE_LIMIT_MS });
      child.kill('SIGTERM');
    }, USER_PHASE_LIMIT_MS);
    child.on('error', (err) => { clearTimeout(timer); out.end(); resolve({ code: null, last: err.message }); });
    child.on('close', (code) => { clearTimeout(timer); out.end(); resolve({ code, last }); });
  });
}

/**
 * Install or repair every missing driver: Homebrew + the AmneziaWG build as this user (no time
 * limit, progress through onProgress), then one administrator prompt that only copies the tools
 * into the service folder.
 */
export async function repairDrivers(onProgress: (line: string) => void = () => undefined): Promise<{ ok: boolean; error?: string; view: DriversView }> {
  const user = loginName();
  if (!user) return { ok: false, error: 'Could not tell which Mac user owns Homebrew. Run the repair from your own login.', view: await driversStatus() };
  const phase = await runUserPhase(onProgress);
  log.info('driver user phase finished', { code: phase.code, last: phase.last.slice(0, 200) });
  // 0 = all built · 3 = AmneziaWG build failed (still copy WireGuard / OpenVPN) · else = Homebrew failed
  if (phase.code !== 0 && phase.code !== 3) {
    return { ok: false, error: `Homebrew could not install the VPN tools: ${phase.last.slice(0, 200) || 'stopped'}. Full log: ${driversInstallLog()}`, view: await driversStatus() };
  }
  onProgress('Copying the tools for the VPN service (administrator permission)');
  const r = await runElevated(scriptPath('install-deps.sh'), { User: user, Built: '1' }, COPY_STEP_MS);
  const view = await driversStatus();
  if (r.status === 'ok') return { ok: true, view };
  return { ok: false, error: r.status === 'cancelled' ? r.detail : `Some drivers could not be installed: ${r.detail}${phase.code === 3 ? ` (AmneziaWG build log: ${driversInstallLog()})` : ''}`, view };
}

/**
 * Windows-only problem (OpenVPN's Wintun adapter, UPSTREAM-GAPS #27): on macOS OpenVPN opens its
 * own utun device per session, so there is nothing to re-create. Kept so callers match.
 */
export async function recreateOpenvpnAdapter(): Promise<{ ok: boolean; detail: string }> {
  return { ok: true, detail: 'not needed on macOS (OpenVPN opens its utun device per session)' };
}

/** One line per driver, for the CLI and the in-app terminal. */
export function driverLines(r: DriverReport): string[] {
  return r.deps.map((d) => {
    const mark = d.status === 'failed' || d.status === 'incompatible' ? 'FAIL' : d.status === 'missing' ? 'miss' : 'ok  ';
    const ver = d.found ? ` ${d.found}` : '';
    return `${mark}  ${(DRIVER_LABELS[d.name] ?? d.name).padEnd(28)} ${d.status}${ver}${d.detail ? `  (${d.detail})` : ''}`;
  });
}

/** macOS: OpenVPN has no shared adapter to lose (see recreateOpenvpnAdapter). */
export function openvpnAdapterMissing(): Promise<boolean> {
  return Promise.resolve(false);
}
