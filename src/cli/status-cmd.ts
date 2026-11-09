// ─── `status` — wallet, device, service, session and what the session really covers ───
// Split from commands.ts (500-line rule). Same snapshot the app shows; a live session is
// titled by core/session/coverage, measured here because the CLI runs no scheduler.
import type { Cmd } from './commands';
import { log } from '../main/logger';
import { runJobNow } from '../main/scheduler';
import { patch, snapshot } from '../main/app-state';
import { refreshWallet } from '../main/services/wallet';
import { adoptRunningSession, sessionStateUnknown } from '../main/services/connection';
import { daemonInfo } from '../main/daemon/manager';
import { clearSystemProxy, systemProxyActive } from '../main/system/proxy';
import { leftoverTunnels } from '../main/system/tunnels';
import { formatBytes } from '../shared/format';
import { tdvpn, sol } from '../core/chain/amounts';
import { MODE_STREAM } from '../core/chain/idl';
import { readSettlements } from '../main/services/settlement';
import { internetReachable } from '../core/quality/reachability';
import { getRpcUrls } from '../core/chain/rpc';
import { sessionWarningCopy } from '../core/session/state';

/** How the live session is paid: a plan has no channel; a deposit is per hour (stream) or per GB. */
export function paymentLabel(channel: string, mode: number | null): string {
  if (!channel) return 'plan';
  if (mode === null) return 'deposit';
  return mode === MODE_STREAM ? 'per hour' : 'per GB';
}

// Q0372 (QA, TWD): during a tunnel cut with the kill switch on, every network read waits for its
// own timeout (the RPC and IP services sit behind the dead tunnel), one after another: status took
// 71-90 s. Each read now gets STATUS_NET_BUDGET_MS, the wallet read and IP check run together, and a
// read that misses the budget shows as unknown (the CLI exits 400 ms after printing, so an abandoned
// read cannot hold it open).
export const STATUS_NET_BUDGET_MS = 2500;

/** p, or undefined once ms have passed (logged). */
export async function within<T>(p: Promise<T>, ms: number, what: string): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => { log.warn(`status: ${what} took over ${ms} ms; shown as unknown`); resolve(undefined); }, ms);
  });
  try {
    return await Promise.race([p, late]);
  } finally {
    clearTimeout(timer);
  }
}

const short = (s: string): string => (s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s);

export const statusCmd: Cmd = async (_a, o) => {
  let adoptDone = false;
  await within(adoptRunningSession().then(() => { adoptDone = true; }), STATUS_NET_BUDGET_MS, 'reading the daemon session');
  const ipCheck = async (): Promise<void> => {
    if (!snapshot().session) return;
    // The system proxy may have been set by the app or an earlier CLI run for this user.
    patch({ proxyActive: systemProxyActive() });
    const r = await runJobNow('ip');
    if (r.error) log.warn('status: ip check failed', { err: r.error });
  };
  // Q0366 pass 2 (QA fedora): with no session and the kill switch blocking, status took 5-8 s:
  // the wallet read, then the leftover check, then the internet probe, one after another. Once the
  // session read says "none", those start together with the wallet read (each still bounded).
  const noSession = adoptDone && !snapshot().session && !sessionStateUnknown();
  const leftoverRead = noSession ? within(leftoverTunnels(), STATUS_NET_BUDGET_MS, 'the leftover-tunnel check') : null;
  const internetRead = noSession ? within(internetReachable(getRpcUrls(), { timeoutMs: STATUS_NET_BUDGET_MS }), STATUS_NET_BUDGET_MS + 300, 'the internet check') : null;
  const [wallet] = await Promise.all([
    within(refreshWallet(), STATUS_NET_BUDGET_MS, 'the wallet read'),
    within(ipCheck(), STATUS_NET_BUDGET_MS, 'the IP check'),
  ]);
  const w = wallet ?? null;
  const d = daemonInfo();
  let pay = '';
  const live = snapshot().session;
  if (live) {
    let mode: number | null = null;
    if (live.channel) {
      try { mode = (await within(readSettlements(), STATUS_NET_BUDGET_MS, 'the deposit read'))?.find((x) => x.channel === live.channel)?.mode ?? null; } catch (err) { log.warn('status: channel read failed', { err: (err as Error).message }); }
    }
    pay = paymentLabel(live.channel, mode);
  }
  const s = snapshot();
  // Q0373: a running dvpnd that did not answer may be redialing: never "Not connected", no Restore advice.
  const unknown = !s.session && (sessionStateUnknown() || !adoptDone);
  const ipLine = s.session && s.publicIp?.sid === s.session.id
    ? `IP       ${s.publicIp.ip}${s.publicIp.viaProxy ? ` through the VPN proxy; apps not using it: ${s.publicIp.directIp ?? 'unknown'}` : ''}${s.homeIp ? `  (yours when not connected: ${s.homeIp})` : ''}`
    : null;
  const lines = [
    `Wallet   ${s.owner ?? 'none'}${w ? `  ${sol(w.ownerLamports)} SOL  ${tdvpn(w.ownerTdvpn)} tDVPN  refundable ${tdvpn(w.userBalance)}` : s.owner ? '  balances unknown (the network could not be reached)' : ''}`,
    `Device   ${d.device ?? 'not set up'}${w?.grant ? `  allowance ${tdvpn(w.grant.allowance)} tDVPN  ${sol(w.deviceLamports)} SOL` : d.device ? (w ? '  no spending permission' : '  spending limit unknown (the network could not be reached)') : ''}`,
    `Daemon   ${d.reachable ? `running ${d.version}${d.networkOk === false ? '  WRONG NETWORK' : ''}` : `not reachable (${d.error ?? d.bridge})`}`,
    `Session  ${s.session ? `${s.conn.title}  node ${short(s.session.node)}  ${s.session.service}  ${pay}  down ${formatBytes(s.session.rxBytes)}  up ${formatBytes(s.session.txBytes)}  spent ${tdvpn(s.session.spent)} tDVPN` : unknown ? 'unknown: the VPN service is running but did not answer (it may be reconnecting)' : s.conn.title}`,
  ];
  if (ipLine) lines.push(ipLine);
  if (s.session && s.conn.detail) lines.push(`         ${s.conn.detail}`);
  // dvpnd's live warning (Q0357 "large-packets"): the same words as the app's Home banner.
  const warning = sessionWarningCopy(s.session?.warning);
  if (warning) lines.push(`Warning  ${warning}`);
  // A tunnel with no session behind it (gaps #29, the Linux app) blocks or silently reroutes traffic.
  const leftover = s.session || unknown || !leftoverRead ? [] : (await leftoverRead) ?? [];
  if (leftover.length) lines.push(`Leftover ${leftover.join(', ')} still running with no session: run "daemon restore-network"`);
  // A system proxy we set for a session that has since ended (process killed, node gone, no app
  // running to restore it) points every proxy-aware app at a dead port: put the user's back.
  if (!s.session && !unknown && systemProxyActive()) {
    try {
      await clearSystemProxy();
      lines.push('Proxy    restored your own proxy setting (it still pointed at a session that has ended)');
    } catch (err) {
      lines.push(`Proxy    still points at an ended session and could not be restored (${(err as Error).message}): run "proxy off"`);
    }
  }
  // With no session the internet should work. The kill switch keeps the RPC open, so the wallet
  // line can read fine while every other site is blocked (dvpnd rc+ holds the block after it
  // crashed mid-session, persist mode holds it after a restart): probe an ordinary site.
  // Same check as the app's Restore network: TCP dials only, RPC hosts dropped (the kill switch
  // leaves them open), no third-party HTTP, so it runs even with third-party checks off (C15).
  const internet = s.session || unknown || !internetRead ? null : (await internetRead) ?? null;
  if (internet === false) lines.push('Internet blocked or down. If the kill switch is still blocking (after a crash or restart), "disconnect" gives the internet back.');
  o.print(lines.join('\n'), { owner: s.owner, wallet: w, daemon: d, conn: s.conn, session: s.session, payment: pay || null, coverage: s.coverage, publicIp: s.publicIp, homeIp: s.homeIp, leftover, internet });
};
