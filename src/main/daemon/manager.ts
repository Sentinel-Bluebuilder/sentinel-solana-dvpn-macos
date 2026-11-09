// ─── Daemon manager (D1, D5, F1, F4.5) — macOS ───
// The app runs as the desktop user; sentinel-dvpnd runs as root under launchd (LaunchDaemon
// `co.sentinel.sentinel-dvpnd.c0`). The daemon serves gRPC on <instance dir>/daemon.sock with
// mode 0660 and gives it to the group `sentinel-dvpn`; setup adds the user to that group and puts
// an inherited ACL for the user on the home, so the app dials the socket directly.
// cb33 (26de5240): the binary is `sentinel-dvpnd`, the client is instance c0, its home is the real
// instance dir `/Library/Application Support/sentinel-dvpn/c0` (ONE config.toml), and the daemon
// runs as `run --instance c0` (no --home) so it reads that dir and gives the socket its group.
// No bridge process: the link is a health probe that re-attaches when the socket comes back.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DaemonClient, DaemonError, socketTarget, type DaemonVersion } from '../../core/daemon/client';
import { MINT, PROGRAM_ID } from '../../core/chain/idl';
import type { DaemonInfo } from '../../shared/types';
import { readJson, writeJson } from '../store';
import { runElevated, type ElevatedResult } from '../system/elevate';
import { log } from '../logger';
import { getHost } from '../host';
import { daemonLinkCopy } from '../../core/daemon/link-copy';
import { carrySettingsInto, readToml, renderServiceConfig, TUN_SERVICES } from '../../core/daemon/config';
import {
  CLIENT_INSTANCE, DAEMON_GROUP, SOCKET_FILE,
  daemonBinaryName, daemonEndpoint, doctorArgs, initArgs, instanceDir,
  keyListArgs, legacyHome, operatorKey, serviceName,
} from '../../core/daemon/layout';

/** The client instance's real home: /Library/Application Support/sentinel-dvpn/c0 (overridable in tests). */
export const DEFAULT_DAEMON_HOME = process.env.DVPN_DAEMON_HOME || instanceDir('darwin');
/** The pre-cb33 client home; carryLiveSettings reads its settings into the new instance. */
export const LEGACY_DAEMON_HOME = legacyHome('darwin');
/** The group the daemon gives its socket to; setup adds the desktop user to it. */
export const SOCKET_GROUP = DAEMON_GROUP;
/** Short service name passed to the helper steps (kept from the Windows app/the Linux app; the macOS steps use the label). */
export const SERVICE_NAME = 'dvpnd-client';
/** The LaunchDaemon label (cb33: co.sentinel.sentinel-dvpnd.c0). */
export const SERVICE_LABEL = serviceName('darwin', CLIENT_INSTANCE);
export const SERVICE_PLIST = `/Library/LaunchDaemons/${SERVICE_LABEL}.plist`;
const DEVICE_FILE = 'device.json';
const HEALTH_MS = 15_000;

// ─── Paths ───
export function resourcesDir(): string {
  return getHost().resourcesDir;
}
export const binPath = (name: string): string => path.join(resourcesDir(), 'bin', name);
export const scriptPath = (name: string): string => path.join(resourcesDir(), 'scripts', name);
export const protoPath = (): string => path.join(resourcesDir(), 'daemon.proto');
export function dvpndPath(): string {
  return process.env.DVPND_BIN && fs.existsSync(process.env.DVPND_BIN) ? process.env.DVPND_BIN : binPath(daemonBinaryName('darwin'));
}

// dvpnd finds V2Ray/Xray/Hysteria2 only on PATH (go-sdk service.LookPath). Each lives in its own
// folder because V2Ray and Xray ship different geoip/geosite files under the same names. The
// service gets these on its own PATH (the LaunchDaemon's EnvironmentVariables, setup-daemon.sh).
export const PROTOCOL_BIN_DIRS = ['v2ray', 'xray', 'hysteria2'];
export const protocolBinDirs = (): string[] => PROTOCOL_BIN_DIRS.map((d) => binPath(d)).filter((d) => fs.existsSync(d));
/** The root-owned tools the service runs (WireGuard, AmneziaWG, OpenVPN, bash 5): install-deps.sh. */
export const SERVICE_TOOLS_DIR = '/Library/devnet-dvpn/tools';
/**
 * PATH for `dvpnd doctor` run as the user: the service's own PATH first (its tools folder, then the
 * protocol folders), the user's PATH last. With the user's PATH first, a Homebrew wg in
 * /usr/local/bin read as "present" while AmneziaWG (only in the tools folder) read as missing,
 * so doctor disagreed with the service (exported for tests).
 */
export function servicePathFor(userPath: string, toolsDir: string | null, protocolDirs: string[]): string {
  return [...(toolsDir ? [toolsDir] : []), ...protocolDirs, ...(userPath ? [userPath] : [])].join(path.delimiter);
}
const withProtocolPath = (): NodeJS.ProcessEnv => ({
  ...process.env,
  PATH: servicePathFor(process.env.PATH ?? '', fs.existsSync(SERVICE_TOOLS_DIR) ? SERVICE_TOOLS_DIR : null, protocolBinDirs()),
});

interface DeviceRecord { device: string; home: string; owner: string; at: number }

// ─── State ───
let client: DaemonClient | null = null;
let retryTimer: NodeJS.Timeout | null = null;
let healthTimer: NodeJS.Timeout | null = null;
let backoffMs = 2000;
let stopping = false;
const info: DaemonInfo = { reachable: false, bridge: 'stopped', version: null, networkOk: null, error: null, home: null, device: null };
const listeners = new Set<() => void>();

export const onDaemonChange = (fn: () => void): (() => void) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (): void => { for (const l of listeners) l(); };

export function daemonInfo(): DaemonInfo {
  const d = readJson<DeviceRecord | null>(DEVICE_FILE, null);
  return { ...info, home: d?.home ?? null, device: d?.device ?? null };
}

export function deviceRecord(): DeviceRecord | null {
  return readJson<DeviceRecord | null>(DEVICE_FILE, null);
}

/** The connected gRPC client, or a clear error the UI can show. */
export function daemon(): DaemonClient {
  if (!client || !info.reachable) throw new DaemonError(Object.assign(new Error(info.error ?? 'The VPN service is not running.'), { code: 14, details: info.error ?? 'The VPN service is not running.' }) as Error, 'daemon');
  return client;
}

// ─── Link lifecycle ───
/** DVPN_DAEMON_SOCKET overrides the control socket (a foreground test daemon). */
export const daemonSocket = (): string =>
  process.env.DVPN_DAEMON_SOCKET || path.join(deviceRecord()?.home ?? DEFAULT_DAEMON_HOME, SOCKET_FILE);

/** Resolves once the first attach attempt finished (success or not). */
let firstAttach: Promise<void> = Promise.resolve();
let resolveFirst: (() => void) | null = null;
export const daemonReady = (timeoutMs = 10_000): Promise<void> => Promise.race([firstAttach, new Promise<void>((r) => setTimeout(r, timeoutMs).unref())]);

const settleFirst = (): void => { if (resolveFirst) { resolveFirst(); resolveFirst = null; } };

export function startDaemonLink(): void {
  stopping = false;
  firstAttach = new Promise((r) => { resolveFirst = r; });
  // DVPN_DAEMON_TARGET=host:port — a TCP-bridged daemon (netns test rig). Test/dev only.
  if (process.env.DVPN_DAEMON_TARGET) {
    info.bridge = 'running';
    void attach(process.env.DVPN_DAEMON_TARGET);
    return;
  }
  const sock = daemonSocket();
  if (!fs.existsSync(sock)) {
    info.bridge = 'missing';
    info.reachable = false;
    info.error = 'The VPN service is not running.';
    emit();
    settleFirst();
    scheduleRetry();
    return;
  }
  info.bridge = 'running';
  void attach(socketTarget(sock));
}

function scheduleRetry(): void {
  if (retryTimer || stopping) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    startDaemonLink();
  }, backoffMs);
  retryTimer.unref(); // the CLI must be able to exit while the service is down
  backoffMs = Math.min(backoffMs * 2, 30_000);
}

/** While attached, re-check every 15 s: a restarted service gets a new socket, a stopped one none. */
function startHealth(): void {
  if (healthTimer) return;
  healthTimer = setInterval(() => {
    if (!client || stopping) return;
    client.getVersion().catch((err: Error) => {
      log.warn('daemon stopped answering', { err: err.message });
      detach();
      info.error = daemonLinkCopy(err.message);
      info.bridge = 'stopped';
      emit();
      scheduleRetry();
    });
  }, HEALTH_MS);
  healthTimer.unref();
}

async function attach(target: string): Promise<void> {
  detach();
  client = new DaemonClient(target, protoPath());
  try {
    const v = await client.getVersion();
    info.reachable = true;
    info.version = v.tag || v.commit || 'unknown';
    info.networkOk = networkMatches(v);
    info.error = info.networkOk ? null : `The VPN service is set up for a different network (${v.network}). This app is devnet only.`;
    backoffMs = 2000;
    log.info('daemon attached', { version: info.version, network: v.network, networkOk: info.networkOk });
    startHealth();
  } catch (err) {
    info.reachable = false;
    info.bridge = 'error';
    info.error = daemonLinkCopy((err as Error).message);
    // Busy starting or a slow machine: retry with backoff (the Windows app 2169efe; here the retry also
    // re-checks that the socket still exists).
    log.warn('daemon attach failed', { err: (err as Error).message, retryInMs: backoffMs });
    scheduleRetry();
  }
  emit();
  settleFirst();
}

export function networkMatches(v: Pick<DaemonVersion, 'programId' | 'mint'>): boolean {
  return v.programId === PROGRAM_ID.toBase58() && v.mint === MINT.toBase58();
}

function detach(): void {
  if (client) {
    client.close();
    client = null;
  }
  info.reachable = false;
}

export function stopDaemonLink(): void {
  stopping = true;
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
  detach();
  info.bridge = 'stopped';
}

/** Re-probe now (after setup or a settings restart). */
export function relinkDaemon(): void {
  backoffMs = 2000;
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  stopping = false;
  startDaemonLink();
}

// ─── Doctor (F1.6) ───
// dvpnd reports advisories as OK=true with a Detail (e.g. a protocol binary missing): that is a warning.
export interface DoctorCheck { name: string; ok: boolean; level: 'ok' | 'warn' | 'fail'; detail: string }
/** dvpnd's real advisories (OK=true + Detail): a protocol program or adapter missing, plan delegate. */
const ADVISORY = /^(service_|delegate$)/;

/**
 * `dvpnd doctor` runs as the desktop user, who by design cannot read the device key
 * (root 0700) or the service's database. When the service is up and answering it has
 * already loaded both, so those two denials are not failures (exported for tests).
 */
export function doctorForUser(rows: DoctorCheck[], serviceAnswers: boolean, isRoot: boolean): DoctorCheck[] {
  if (isRoot || !serviceAnswers) return rows;
  const denied = /permission denied|unable to open database/i;
  return rows.map((r) => {
    if (['key', 'kill_switch'].includes(r.name) && denied.test(r.detail)) {
      return { ...r, ok: true, level: 'ok', detail: 'held by the running service (readable by root only)' };
    }
    // The privileges check asks whether THIS process is root; the service that answered is.
    if (r.name === 'privileges' && !r.ok && /must run as root/i.test(r.detail)) {
      return { ...r, ok: true, level: 'ok', detail: 'the service runs as root (this check ran as you)' };
    }
    return r;
  });
}

export async function runDoctor(home = deviceRecord()?.home ?? DEFAULT_DAEMON_HOME): Promise<DoctorCheck[]> {
  const rows = await rawDoctor(home);
  let answers = false;
  try {
    await daemon().getVersion();
    answers = true;
  } catch (err) {
    log.debug('doctor: service not answering', { err: (err as Error).message });
  }
  const out = doctorForUser(rows, answers, process.getuid?.() === 0);
  if (fs.existsSync(SERVICE_PLIST)) {
    const stale = serviceStaleFiles();
    const names = stale.slice(0, 3).join(', ') + (stale.length > 3 ? ' …' : '');
    out.push(stale.length
      ? { name: 'service_update', ok: false, level: 'warn', detail: `The VPN service runs a different copy of ${names} than this app. Update it: devnet-dvpn daemon install --yes (one administrator prompt).` }
      : { name: 'service_update', ok: true, level: 'ok', detail: '' });
  }
  return out;
}

// ─── Service copies vs this app (a .dmg update has no post-install step) ───
/** Where setup-daemon.sh puts the root-owned copies the service runs. */
export const SERVICE_LIB = '/Library/devnet-dvpn';

function filesUnder(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...filesUnder(dir, r));
    else if (e.isFile()) out.push(r);
  }
  return out;
}

function sha(p: string): string | null {
  try {
    return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  } catch (err) {
    log.debug('service copy unreadable', { p, err: (err as Error).message });
    return null;
  }
}

/**
 * Files this app ships that the installed service runs from a different copy: dvpnd, the protocol
 * binaries and the root helper scripts (later prompts run the ROOT copy of the scripts).
 * Empty = up to date. Roots are parameters for tests.
 */
export function serviceStaleFiles(lib = SERVICE_LIB, bundleBin = path.dirname(binPath('x')), bundleScripts = path.dirname(scriptPath('x')), daemonBin = dvpndPath()): string[] {
  const bin = daemonBinaryName('darwin');
  const pairs: Array<[string, string, string]> = [[bin, daemonBin, path.join(lib, bin)]];
  for (const d of PROTOCOL_BIN_DIRS) {
    const src = path.join(bundleBin, d);
    if (fs.existsSync(src)) for (const r of filesUnder(src)) pairs.push([`${d}/${r}`, path.join(src, r), path.join(lib, d, r)]);
  }
  if (fs.existsSync(bundleScripts)) for (const r of filesUnder(bundleScripts)) pairs.push([`scripts/${r}`, path.join(bundleScripts, r), path.join(lib, 'scripts', r)]);
  return pairs.filter(([, a, b]) => {
    const ha = sha(a);
    return ha !== null && ha !== sha(b);
  }).map(([n]) => n);
}

/**
 * `dvpnd doctor` JSON rows. cf4c372 prints `name/ok/detail`; dfe36c7 printed `Name/OK/Detail`
 * (a v1 binary may still be on disk until the service is set up again). Exported for tests.
 */
export function parseDoctorRows(json: string): DoctorCheck[] {
  const rows = JSON.parse(json) as Array<Record<string, unknown>>;
  if (!Array.isArray(rows)) throw new Error('doctor output is not a list'); // copy:internal
  return rows.map((r) => {
    const name = String(r.name ?? r.Name ?? '?');
    const ok = (r.ok ?? r.OK) === true;
    let detail = String(r.detail ?? r.Detail ?? '');
    if (!ok && (name === 'grant' || name === 'mandate')) {
      log.info('doctor: device has no spending permission', { detail: detail.slice(0, 300) });
      detail = 'This device has no spending permission yet. Set it up: Wallet → "Let this device pay nodes", or `devnet-dvpn device setup`.';
    }
    // The kill-switch row is OK with a status note; "nothing held" is the normal state, not a
    // warning (the Windows app 09bcc19: a healthy laptop showed it as "!").
    if (name === 'kill_switch' && ok) {
      if (/no persisted kill switch/i.test(detail)) detail = 'Nothing held: internet is not blocked.';
      return { name, ok, level: /unpinned|unusable|leftover/i.test(detail) ? 'warn' : 'ok', detail };
    }
    return { name, ok, level: !ok ? 'fail' : detail && ADVISORY.test(name) ? 'warn' : 'ok', detail };
  });
}

function rawDoctor(home: string): Promise<DoctorCheck[]> {
  return new Promise((resolve) => {
    const exe = dvpndPath();
    if (!fs.existsSync(exe)) { resolve([{ name: 'binary', ok: false, level: 'fail', detail: 'dvpnd is not installed with this app.' }]); return; }
    execFile(exe, doctorArgs(home), { timeout: 60_000, env: withProtocolPath() }, (err, stdout, stderr) => {
      const text = String(stdout);
      const start = text.indexOf('[');
      if (start >= 0) {
        try {
          resolve(parseDoctorRows(text.slice(start)));
          return;
        } catch (parseErr) {
          log.warn('doctor output not JSON', { err: (parseErr as Error).message });
        }
      }
      resolve([{ name: 'doctor', ok: false, level: 'fail', detail: (err?.message ?? String(stderr)).slice(0, 300) }]);
    });
  });
}

// ─── First-run setup (F1.5) ───
// dvpnd will not start until its device key holds a grant, so setup is:
//   1. initDevice   — `dvpnd init` as the user into <data>/daemon-staging → device address
//   2. (owner signs device setup: delegate + grant + SOL — services/wallet.deviceSetup)
//   3. installService — ONE administrator prompt (osascript): copy into /var/db/dvpnd, lock keys,
//      add the user to the 'dvpn' group, write + load the LaunchDaemon, link the CLI
export function stagingHome(): string {
  return path.join(getHost().dataDir, 'daemon-staging');
}

/**
 * fleet-bugs W3: a wallet switch installs this fresh home in place of the old one, so copy the
 * user's settings (kill switch, DNS, LAN, split, RPC, payment limits, whole-device) into the new
 * staging home's ONE config.toml first. The source is the installed cb33 home (single config.toml)
 * if there is one, else a pre-cb33 pair home (config.toml + client/config.toml) for a first cb33
 * install over an old one. Nothing installed yet, or unreadable: the daemon's defaults stay.
 * `live`/`legacyHome` are injectable so unit tests stay hermetic (never read the real installed homes).
 */
export function carryLiveSettings(
  staging: string,
  live = DEFAULT_DAEMON_HOME,
  legacyHome = LEGACY_DAEMON_HOME,
): void {
  const freshPath = path.join(staging, 'config.toml');
  if (!fs.existsSync(freshPath)) return;
  const cb33 = path.join(live, 'config.toml');
  const legacyRoot = path.join(legacyHome, 'config.toml');
  const legacyClient = path.join(legacyHome, 'client', 'config.toml');
  // old = {root, client}: for a cb33 source both are the one file (it holds every key); for a pair
  // home they are the two old files. svcBase = where the per-service config.toml live in the source.
  let old: { root: string; client: string } | null = null;
  let svcBase = '';
  if (fs.existsSync(cb33)) {
    const t = fs.readFileSync(cb33, 'utf8');
    old = { root: t, client: t };
    svcBase = live;
  } else if (fs.existsSync(legacyRoot) && fs.existsSync(legacyClient)) {
    old = { root: fs.readFileSync(legacyRoot, 'utf8'), client: fs.readFileSync(legacyClient, 'utf8') };
    svcBase = path.join(legacyHome, 'client');
  }
  if (!old) return;
  try {
    fs.writeFileSync(freshPath, carrySettingsInto(old, fs.readFileSync(freshPath, 'utf8')), 'utf8');
    for (const s of TUN_SERVICES) {
      const from = path.join(svcBase, s, 'config.toml');
      const into = path.join(staging, s, 'config.toml');
      if (!fs.existsSync(from) || !fs.existsSync(into)) continue;
      const tun = readToml(fs.readFileSync(from, 'utf8'), '', 'tun');
      if (typeof tun === 'boolean') fs.writeFileSync(into, renderServiceConfig(fs.readFileSync(into, 'utf8'), tun), 'utf8');
    }
    log.info('settings carried to the new device home', { from: svcBase });
  } catch (err) {
    log.warn('could not carry settings to the new device home; daemon defaults stay', { error: (err as Error).message });
  }
}

export function initDevice(owner: string): Promise<{ ok: boolean; device?: string; error?: string }> {
  const existing = deviceRecord();
  if (existing && existing.owner === owner) return Promise.resolve({ ok: true, device: existing.device });
  const exe = dvpndPath();
  if (!fs.existsSync(exe)) return Promise.resolve({ ok: false, error: 'The VPN service is missing from this install. Reinstall the app.' });
  const staging = stagingHome();
  if (fs.existsSync(path.join(staging, 'config.toml'))) {
    return Promise.resolve({ ok: false, error: 'A half-finished setup exists. Remove it from Settings → Advanced and start again.' });
  }
  // cb33: `init --instance c0 --home <staging> --owner <o> --plain-key`. --instance c0 sets the
  // role (c = client), so there is no --role. No group is set here: the daemon gives the socket its
  // group only when run as the real instance (setup-daemon.sh installs the home there and the
  // service `run --instance c0` applies the group).
  const args = initArgs(staging, owner);
  return new Promise((resolve) => {
    execFile(exe, args, { timeout: 60_000 }, (err, stdout, stderr) => {
      const text = String(stdout);
      const at = text.indexOf('{');
      if (err || at < 0) { resolve({ ok: false, error: `Could not set up the VPN service. Try again, or send the log from Diagnostics (${(err?.message ?? String(stderr)).slice(0, 300)}).` }); return; }
      try {
        const init = JSON.parse(text.slice(at)) as { public_key: string };
        writeJson(DEVICE_FILE, { device: init.public_key, home: DEFAULT_DAEMON_HOME, owner, at: Date.now() } satisfies DeviceRecord);
        log.info('device initialised', { device: init.public_key });
        carryLiveSettings(staging);
        resolve({ ok: true, device: init.public_key });
      } catch (parseErr) {
        resolve({ ok: false, error: `Could not set up the VPN service. Try again, or send the log from Diagnostics (unreadable output: ${(parseErr as Error).message}).` });
      }
    });
  });
}

/** The Mac short name of the person running the app (the elevated step adds it to the socket group; Homebrew runs as it). macOS allows dots and capitals. */
export function loginName(): string {
  const n = process.env.SUDO_USER || process.env.USER || process.env.LOGNAME || '';
  return /^[A-Za-z_][A-Za-z0-9_.-]{0,31}$/.test(n) && n !== 'root' ? n : '';
}

/** The bundled CLI launcher (Contents/Resources/bin/devnet-dvpn in the app); setup links it into /usr/local/bin. */
export function cliLauncherPath(): string | null {
  const p = path.join(path.dirname(resourcesDir()), 'bin', 'devnet-dvpn');
  return fs.existsSync(p) ? p : null;
}

/** L6: poll (bounded) until `probe` is true; probes and sleep are injectable (exported for tests). */
export async function pollUntil(
  probe: () => Promise<boolean>,
  waitMs = 30_000,
  stepMs = 2_000,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<boolean> {
  for (let waited = 0; ; waited += stepMs) {
    if (await probe()) return true;
    if (waited + stepMs > waitMs) return false;
    await sleep(stepMs);
  }
}

function unitRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('launchctl', ['print', `system/${SERVICE_LABEL}`], { timeout: 10_000 }, (_err, stdout) => resolve(/state = running/.test(String(stdout))));
  });
}

/** After the install step ran past its time limit: did the service come up anyway? */
async function verifyInstalled(home: string): Promise<ElevatedResult> {
  const up = await pollUntil(async () => (await unitRunning()) && fs.existsSync(path.join(home, 'daemon.sock')));
  if (up) {
    log.info('install step timed out but the service is running', { service: SERVICE_LABEL });
    return { status: 'ok', detail: 'service installed and running (the administrator step took longer than expected)' };
  }
  return { status: 'error', detail: 'The administrator step took too long and the VPN service is not running. Try again; if it keeps happening, send the log from Diagnostics.' };
}

/** Elevated: move the staged home into /var/db/dvpnd and run it as a LaunchDaemon. Call after device setup. */
export async function installService(): Promise<{ ok: boolean; error?: string; waitingForNetwork?: boolean }> {
  const rec = deviceRecord();
  if (!rec) return { ok: false, error: 'Initialise the device first.' };
  const user = loginName();
  const cli = cliLauncherPath();
  const r = await runElevated(scriptPath('setup-daemon.sh'), {
    Dvpnd: dvpndPath(), Staging: stagingHome(), DaemonHome: rec.home, BinRoot: path.dirname(binPath('x')),
    Group: SOCKET_GROUP, Service: SERVICE_NAME, Instance: CLIENT_INSTANCE, Label: SERVICE_LABEL,
    ...(user ? { User: user } : {}), ...(cli ? { Cli: cli } : {}),
  }, 300_000, () => verifyInstalled(rec.home));
  relinkDaemon();
  // waitingForNetwork: installed, but dvpnd checks the RPC before it serves; launchd retries every minute.
  return r.status === 'ok' ? { ok: true, ...(r.waitingForNetwork === true ? { waitingForNetwork: true } : {}) } : { ok: false, error: r.detail };
}

/**
 * Elevated: remove the service (uninstall-cleanup.sh). A .dmg has no uninstall hook, so this is
 * the Mac's uninstaller: networking put back, LaunchDaemon + root copies + CLI link removed,
 * the device key kept in /var/db/dvpnd (it holds an on-chain permission and SOL).
 */
export async function uninstallService(): Promise<{ ok: boolean; error?: string; detail?: string }> {
  // dvpnd keeps a held or persist-mode kill switch in its database (kept on uninstall with the
  // device key) and re-applies it on its next start. Without this a reinstall blocked the
  // internet with the kill switch set to off (the macOS app rig 2, safety-armed). StopSession with no
  // session releases it; "not found" means nothing was held.
  if (info.reachable) {
    try {
      await daemon().stopSession('', {});
    } catch (err) {
      if (!(err instanceof DaemonError && err.kind === 'not-found')) log.warn('releasing the kill switch before uninstall', { err: (err as Error).message });
    }
  }
  const r = await runElevated(scriptPath('uninstall-cleanup.sh'), {}, 300_000);
  relinkDaemon();
  return r.status === 'ok' ? { ok: true, detail: r.detail } : { ok: false, error: r.detail };
}

export type ServiceStart = 'running' | 'started' | 'no-service' | 'no-right' | 'failed';

/** What `launchctl kickstart` printed / its exit code means for the caller (exported for tests). */
export function classifyServiceStart(code: number, stderr: string): ServiceStart {
  if (code === 0) return 'started';
  if (/could not find service|no such process|not loaded/i.test(stderr)) return 'no-service';
  if (/not privileged|operation not permitted|permission denied/i.test(stderr)) return 'no-right';
  return 'failed';
}

/**
 * Start the installed service if it is not running, without a password prompt. dvpnd refuses to
 * start until the device has a grant; launchd (KeepAlive, ThrottleInterval 60 s) starts it again
 * within a minute of device setup on its own. A non-admin cannot kickstart a system daemon, so
 * this only tries it and otherwise reports 'no-right' (the caller says "starts within a minute").
 */
export function startServiceIfStopped(): Promise<ServiceStart> {
  return (async () => {
    if (!fs.existsSync(SERVICE_PLIST)) return 'no-service';
    if (fs.existsSync(daemonSocket()) && info.reachable) return 'running';
    const s = await new Promise<{ code: number; err: string }>((resolve) => {
      execFile('launchctl', ['kickstart', `system/${SERVICE_LABEL}`], { timeout: 30_000 }, (err, _stdout, stderr) => {
        resolve({ code: err ? (typeof (err as { code?: unknown }).code === 'number' ? Number((err as { code?: unknown }).code) : 1) : 0, err: String(stderr) });
      });
    });
    const r = classifyServiceStart(s.code, s.err);
    if (r === 'started') relinkDaemon();
    else if (r !== 'no-right') log.warn('service start failed', { code: s.code, err: s.err.slice(0, 300) });
    return r;
  })();
}

/** Public half only, written world-readable by setup-daemon.sh (the key folder is root 0700). */
export const DEVICE_PUB_FILE = 'device.pub';

/** The device address a home publishes in device.pub, or null (exported for tests). */
export function readDevicePub(home: string): string | null {
  try {
    const v = fs.readFileSync(path.join(home, DEVICE_PUB_FILE), 'utf8').trim();
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v) ? v : null;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'EACCES') log.warn('device.pub unreadable', { err: (err as Error).message });
    return null;
  }
}

/**
 * The device public key of an existing home: device.pub first (no secret needed), else
 * `dvpnd key list` (cf4c372; was `keys`), which only works when the key folder is readable (e.g. as root).
 */
export function detectDevice(home = DEFAULT_DAEMON_HOME): Promise<{ ok: boolean; device?: string; error?: string }> {
  const pub = readDevicePub(home);
  if (pub) return Promise.resolve({ ok: true, device: pub });
  const exe = dvpndPath();
  if (!fs.existsSync(exe)) return Promise.resolve({ ok: false, error: 'The VPN service is missing from this install. Reinstall the app.' });
  return new Promise((resolve) => {
    execFile(exe, keyListArgs(home), { timeout: 20_000 }, (err, stdout, stderr) => {
      const text = String(stdout);
      const at = text.indexOf('[');
      if (err || at < 0) { resolve({ ok: false, error: `Could not read the service's device key (${(err?.message ?? String(stderr)).trim().slice(0, 160)}). Enter its address instead.` }); return; }
      try {
        const keys = JSON.parse(text.slice(at)) as Array<{ name: string; public_key: string }>;
        const dev = operatorKey(keys);
        resolve(dev ? { ok: true, device: dev.public_key } : { ok: false, error: 'The service home has no device key.' });
      } catch (parseErr) {
        resolve({ ok: false, error: `Could not read the service's device key (unreadable output: ${(parseErr as Error).message}). Enter its address instead.` });
      }
    });
  });
}

/** Record an already-initialised daemon's device key (e.g. service set up by an admin). */
export function registerDevice(device: string, owner: string, home = DEFAULT_DAEMON_HOME): void {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(device)) throw new Error('The device must be a Solana address (base58).');
  writeJson(DEVICE_FILE, { device, home, owner, at: Date.now() } satisfies DeviceRecord);
}
