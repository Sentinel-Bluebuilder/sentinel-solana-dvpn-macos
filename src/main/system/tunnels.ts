// ─── Leftover tunnels (F14.3, UPSTREAM-GAPS #24 / #29 / the Linux app) — macOS ───
// A sentinel-dvpnd that died (SIGKILL, crash, power loss) can leave its tunnel up and its protocol
// process running: the default route still points into the dead tunnel, and the kill switch (pf
// anchor `sentinel-dvpn-c0`) may still drop everything (sentinel-solana docs 25 §3). "Restore
// network" removes only ours; a user's own tunnels are never touched.
// Detection is unelevated: wg-quick's /var/run/{wireguard,amneziawg}/<name>.name files + the
// utun list from `ifconfig -l`, processes from `ps`. (Reading the pf anchor needs root, so it is
// checked and removed by the elevated step.)
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { log } from '../logger';
import { runElevated } from './elevate';
import { binPath, scriptPath } from '../daemon/manager';
import { tunnelInterface } from '../../core/daemon/layout';

/** cb33 uses ONE interface per instance for every protocol: Tag.Interface() = dvpn-c0 (go-sdk instance). */
const OUR_LINKS = [tunnelInterface()];
const NAME_DIRS = ['/var/run/wireguard', '/var/run/amneziawg'];

/** Our wg-quick links that are up: name file present AND its utun in `ifconfig -l`. Exported for tests. */
export function parseTunnelLinks(nameFiles: Record<string, string>, ifconfigList: string): string[] {
  const up = new Set(ifconfigList.trim().split(/\s+/));
  const out: string[] = [];
  for (const [name, utun] of Object.entries(nameFiles)) {
    if (OUR_LINKS.includes(name) && /^utun\d+$/.test(utun) && up.has(utun)) out.push(`${name} (${utun})`);
  }
  return out;
}

function readNameFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dir of NAME_DIRS) {
    for (const n of OUR_LINKS) {
      try {
        out[n] = fs.readFileSync(path.join(dir, `${n}.name`), 'utf8').trim();
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('cannot read wg-quick name file', { dir, n, err: (err as Error).message });
      }
    }
  }
  return out;
}

/** Our tunnel links that exist now ([] when `ifconfig` fails). */
export function runningTunnelServices(): Promise<string[]> {
  const names = readNameFiles();
  if (!Object.keys(names).length) return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile('/sbin/ifconfig', ['-l'], { timeout: 15_000 }, (err, stdout) => {
      if (err && !stdout) { log.warn('ifconfig -l failed; cannot look for leftover tunnels', { err: err.message }); resolve([]); return; }
      resolve(parseTunnelLinks(names, String(stdout)));
    });
  });
}

/** Remove our leftover tunnels, kill switch anchor, DNS change and orphaned protocol processes (one administrator prompt). Call only with no live session. */
export async function removeTunnelServices(): Promise<{ ok: boolean; detail: string }> {
  const r = await runElevated(scriptPath('remove-tunnels.sh'), { BinRoot: path.dirname(binPath('x')) }, 120_000);
  log.info('leftover tunnels', { status: r.status, detail: r.detail });
  return { ok: r.status === 'ok', detail: r.detail };
}

// ─── Orphaned protocol processes (UPSTREAM-GAPS the Linux app) ───
// When sentinel-dvpnd dies, its hysteria2 / v2ray / xray child can keep running and keep the tunnel
// (and, for per-hour channels, the bill) going. Ours = run from the app's own bin folder or the
// service's root-owned copies; openvpn = run with the daemon's config under the instance home
// (/Library/Application Support/sentinel-dvpn/), or a pre-cb33 home under /var/db/dvpnd.
export interface ProcInfo { pid: number; comm: string; exe: string; cmdline: string }

// The service's root-owned copies live at /Library/devnet-dvpn (cb33 DIR 11-08: moved off
// /usr/local/lib so no uid-501 ancestor; no space, since Homebrew's wg-quick can't take one). The two
// legacy roots stay here so an orphan from a process a pre-move build started is still recognised as
// ours during/after an upgrade: /usr/local/lib/devnet-dvpn, and the short-lived "Application Support"
// try (QA 11-08, never shipped past test).
const OUR_DIRS = ['/Applications/Devnet dVPN.app/', '/Library/devnet-dvpn/', '/Library/Application Support/devnet-dvpn/', '/usr/local/lib/devnet-dvpn/'];
const DVPND_HOME_RE = /\/(private\/)?(Library\/Application Support\/sentinel-dvpn|var\/db\/dvpnd)\//;

/** Pure filter, exported for tests. */
export function orphanProcesses(procs: ProcInfo[], appBinDir: string): string[] {
  const out: string[] = [];
  for (const p of procs) {
    const ours = (/^(hysteria2|v2ray|xray)$/.test(p.comm) && (p.exe.startsWith(appBinDir + path.sep) || OUR_DIRS.some((d) => p.exe.startsWith(d))))
      || (p.comm === 'openvpn' && DVPND_HOME_RE.test(p.cmdline));
    if (ours) out.push(`${p.comm}:${p.pid}`);
  }
  return out;
}

/** Parse `ps -axww -o pid=,comm=,args=` (macOS `comm` is the executable path). Exported for tests. */
export function parsePs(out: string): ProcInfo[] {
  const procs: ProcInfo[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const rest = m[2];
    // comm is a path that may contain spaces; args starts with the same path, so split there
    const name = /(?:^|\/)(hysteria2|v2ray|xray|openvpn)(?=\s)/.exec(rest);
    if (!name) continue;
    const exe = rest.slice(0, name.index + name[0].length);
    const cmdline = rest.slice(exe.length).trim();
    procs.push({ pid: Number(m[1]), comm: name[1], exe, cmdline });
  }
  return procs;
}

function listProcs(): Promise<ProcInfo[]> {
  return new Promise((resolve) => {
    execFile('/bin/ps', ['-axww', '-o', 'pid=,comm=,args='], { timeout: 15_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) { log.warn('ps failed; cannot look for orphaned protocol processes', { err: err.message }); resolve([]); return; }
      resolve(parsePs(String(stdout)));
    });
  });
}

/** Our protocol processes running now (unelevated). */
export async function runningProtocolProcesses(): Promise<string[]> {
  return orphanProcesses(await listProcs(), path.dirname(binPath('x')));
}

/** Everything a dead or failed session can leave holding the network: tunnel links + protocol processes. */
export async function leftoverTunnels(): Promise<string[]> {
  const [links, proc] = await Promise.all([runningTunnelServices(), runningProtocolProcesses()]);
  return [...links, ...proc];
}

// ─── Another VPN holding the traffic (Cosmos lesson D6) — macOS ───
// Two VPNs fight over the same traffic: the second tunnel often carries nothing. Two signs:
//  - a connected VPN service in `scutil --nc list` (IKEv2/IPSec/L2TP and every NetworkExtension
//    VPN app: WireGuard, NordVPN, Mullvad…). dvpnd never uses NetworkExtension, so none is ours.
//  - the classic 0/1 + 128.0/1 pair, or a default route, on a tunnel interface. Our own tunnel
//    looks the same, so routes are read only while none of ours is up (a missed warning, never a
//    false one: the same rule as the Windows check).
const TUNNEL_IF = /^(utun|ipsec|ppp|tun|tap)\d+$/;

/** Connected VPN services from `scutil --nc list` (their quoted names). Exported for tests. */
export function parseScutilVpns(text: string): string[] {
  const out = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (!/^\*?\s*\(Connected\)/.test(line)) continue;
    const name = /"([^"]+)"/.exec(line)?.[1];
    if (name) out.add(name);
  }
  return [...out];
}

/** Tunnel interfaces holding the IPv4 default route in `netstat -rn -f inet`. Exported for tests. */
export function parseRivalRoutesMac(text: string): string[] {
  const out = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 4) continue;
    const [dest, , flags, netif] = f;
    // I = interface-scoped (macOS keeps those on its own utun0-3): not the route traffic takes
    if (!TUNNEL_IF.test(netif) || flags.includes('I')) continue;
    if (dest === '0/1' || dest === '128.0/1' || dest === 'default' || dest === '0.0.0.0/1' || dest === '128.0.0.0/1') out.add(netif);
  }
  return [...out];
}

function run(file: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 15_000 }, (err, stdout) => {
      if (err && !stdout) { log.warn('query failed; cannot look for another VPN', { file, err: err.message }); resolve(null); return; }
      resolve(String(stdout));
    });
  });
}

/** Other VPNs on now (unelevated; [] when the queries fail). */
export async function rivalVpns(): Promise<string[]> {
  if (process.platform !== 'darwin') return [];
  const [nc, ours] = await Promise.all([run('/usr/sbin/scutil', ['--nc', 'list']), leftoverTunnels()]);
  const found = nc ? parseScutilVpns(nc) : [];
  if (!ours.length) {
    const routes = await run('/usr/sbin/netstat', ['-rn', '-f', 'inet']);
    if (routes) found.push(...parseRivalRoutesMac(routes));
  }
  return found;
}

/** Doctor row: ok when no other VPN is on, warn with plain copy when one is. */
export async function rivalVpnRow(): Promise<{ name: string; ok: boolean; level: 'ok' | 'warn'; detail: string }> {
  const rivals = await rivalVpns();
  if (rivals.length === 0) return { name: 'other_vpn', ok: true, level: 'ok', detail: 'No other VPN is active.' };
  return {
    name: 'other_vpn', ok: true, level: 'warn',
    detail: `Another VPN is on (${rivals.join(', ')}). Turn it off before you connect: two VPNs fight over the same traffic and yours may carry nothing.`,
  };
}
