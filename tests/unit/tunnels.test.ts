// ─── Leftover tunnels (gaps #29 / the Linux app) and the kill-switch connect error — macOS ───
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/main/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/main/system/elevate', () => ({ runElevated: vi.fn() }));
vi.mock('../../src/main/daemon/manager', () => ({ scriptPath: (n: string) => n, binPath: (n: string) => `/Applications/Devnet dVPN.app/Contents/Resources/resources/bin/${n}` }));

import { parseTunnelLinks, orphanProcesses, parsePs, parseScutilVpns, parseRivalRoutesMac } from '../../src/main/system/tunnels';
import { connectErrorCopy } from '../../src/core/session/state';

// wg-quick name files (/var/run/wireguard/<name>.name) + `ifconfig -l` on the Sonoma guest.
const IFCONFIG = 'lo0 gif0 stf0 anpi0 en0 bridge0 ap1 utun0 utun1 utun2 utun3 utun4';

describe('parseTunnelLinks', () => {
  it('finds our wg-quick link whose utun is up, never a user tunnel', () => {
    // cb33 uses ONE interface per instance for every protocol: dvpn-c0.
    expect(parseTunnelLinks({ 'dvpn-c0': 'utun3', 'home-office': 'utun2' }, IFCONFIG)).toEqual(['dvpn-c0 (utun3)']);
  });
  it('ignores a stale name file whose utun is gone, and junk', () => {
    expect(parseTunnelLinks({ 'dvpn-c0': 'utun9' }, IFCONFIG)).toEqual([]);
    expect(parseTunnelLinks({ 'dvpn-c0': 'en0; rm -rf' }, IFCONFIG)).toEqual([]);
    expect(parseTunnelLinks({}, '')).toEqual([]);
  });
});

describe('connectErrorCopy: kill switch apply failure', () => {
  it('names the kill switch instead of "Something went wrong"', () => {
    const c = connectErrorCopy('rpc error: code = FailedPrecondition desc = failed precondition: applying firewall: applying kill switch: finding interface dvpn-c0: route ip+net: no such network interface');
    expect(c.code).toBe('kill-switch-failed');
    expect(c.message).toMatch(/kill switch/);
  });
});

describe('killSwitchBlocksProtocol', () => {
  it('never blocks on macOS: the pf kill switch is for every protocol', async () => {
    const { killSwitchBlocksProtocol } = await import('../../src/core/session/state');
    for (const p of ['wireguard', 'amneziawg', 'openvpn', 'hysteria2', 'v2ray', 'xray']) {
      expect(killSwitchBlocksProtocol('darwin', 'on', p)).toBeNull();
      expect(killSwitchBlocksProtocol('darwin', 'persist', p)).toBeNull();
    }
  });
});

describe('orphanProcesses (gap the Linux app)', () => {
  const BIN = '/Applications/Devnet dVPN.app/Contents/Resources/resources/bin';
  it('finds our hysteria2 / v2ray / xray and dvpnd-config openvpn only', () => {
    const procs = [
      { pid: 10, comm: 'hysteria2', exe: '/Library/devnet-dvpn/hysteria2/hysteria2', cmdline: 'client -c /var/db/dvpnd/client/x.yaml' },
      { pid: 11, comm: 'xray', exe: `${BIN}/xray/xray`, cmdline: 'run' },
      { pid: 12, comm: 'v2ray', exe: '/opt/homebrew/bin/v2ray', cmdline: 'run' }, // the user's own
      { pid: 13, comm: 'openvpn', exe: '/Library/devnet-dvpn/tools/openvpn', cmdline: '--config /private/var/db/dvpnd/client/client/openvpn/client.conf' },
      { pid: 15, comm: 'hysteria2', exe: '/usr/local/lib/devnet-dvpn/hysteria2/hysteria2', cmdline: 'client -c /var/db/dvpnd/client/x.yaml' }, // legacy path still ours (upgrade in flight)
      { pid: 14, comm: 'openvpn', exe: '/opt/homebrew/sbin/openvpn', cmdline: '--config /etc/openvpn/work.conf' }, // the user's own
    ];
    expect(orphanProcesses(procs, BIN)).toEqual(['hysteria2:10', 'xray:11', 'openvpn:13', 'hysteria2:15']);
  });
  it('nothing running = none', () => expect(orphanProcesses([], BIN)).toEqual([]));
  it('reads ps output, including a path with spaces', () => {
    const ps = [
      '  412 /Library/devnet-dvpn/xray/xray /Library/devnet-dvpn/xray/xray run -c /var/db/dvpnd/client/client/xray/client.json',
      `  413 ${BIN}/hysteria2/hysteria2 ${BIN}/hysteria2/hysteria2 client`,
      '  500 /usr/sbin/mDNSResponder /usr/sbin/mDNSResponder',
      '  501 /opt/homebrew/sbin/openvpn openvpn --config /var/db/dvpnd/client/client/openvpn/c.conf',
    ].join('\n');
    const p = parsePs(ps);
    expect(p.map((x) => [x.pid, x.comm])).toEqual([[412, 'xray'], [413, 'hysteria2'], [501, 'openvpn']]);
    expect(p[1].exe).toBe(`${BIN}/hysteria2/hysteria2`);
    expect(orphanProcesses(p, BIN)).toEqual(['xray:412', 'hysteria2:413', 'openvpn:501']);
  });
});

describe('node identity failure (owner laptop 2026-10-21, node 5CBc2eb3)', () => {
  it('names it and says nothing was paid', () => {
    const c = connectErrorCopy('StartSession: failed precondition: verifying node metadata: verifying metadata signature: invalid signature');
    expect(c.code).toBe('node-identity');
    expect(c.message).toMatch(/Nothing was paid/);
    expect(c.retry).toBe(false);
  });
});

describe('dvpnd ledger audit refusals (Mac rig 2026-10-22, gap #73)', () => {
  it('a server that billed more than measured gets plain words, never the catch-all', () => {
    const c = connectErrorCopy('StartSession: failed precondition: node settled exceeds the recorded sessions');
    expect(c.code).toBe('node-ledger');
    expect(c.message).toMatch(/Nothing more was paid/);
    expect(c.message).not.toMatch(/Something went wrong/);
    expect(c.retry).toBe(false);
    for (const e of ['node claims unpaid usage', 'node usage exceeds local usage beyond tolerance', 'node ledger disagrees with the chain']) {
      expect(connectErrorCopy(`StartSession: failed precondition: ${e}`).code).toBe('node-ledger');
    }
  });
  it('a changed price is named', () => {
    expect(connectErrorCopy('failed precondition: node price differs from the listing').code).toBe('node-price');
  });
});

describe('kill switch refusal lifts on dvpnd rc+ (gap #29 fixed in dvpnd)', () => {
  it('refuses on rc, allows on rc', async () => {
    const { killSwitchBlocksProtocol, daemonFixesKillSwitch } = await import('../../src/core/session/state');
    expect(daemonFixesKillSwitch('cf4c372-rc')).toBe(false);
    expect(daemonFixesKillSwitch('cf4c372-rc')).toBe(true);
    expect(daemonFixesKillSwitch('cf4c372-rc')).toBe(true);
    expect(daemonFixesKillSwitch(null)).toBe(false);
    expect(killSwitchBlocksProtocol('win32', 'on', 'wireguard', 'cf4c372-rc')).not.toBeNull();
    for (const p of ['wireguard', 'amneziawg', 'openvpn']) expect(killSwitchBlocksProtocol('win32', 'persist', p, 'cf4c372-rc')).toBeNull();
  });
});

// ─── A 429 on a new-deposit start never pays twice (VM dns6 2026-10-22: connect failed on a 429 burst) ───
import { newDepositAfter429 } from '../../src/core/session/state';
describe('newDepositAfter429', () => {
  const N = 'Node111111111111111111111111111111111111111';
  it('adopts a deposit to this node that appeared during the attempt', () => {
    expect(newDepositAfter429(N, new Set(['A']), [{ address: 'A', node: N, status: 'open' }, { address: 'B', node: N, status: 'open' }])).toEqual({ action: 'adopt', channel: 'B' });
  });
  it('retries when nothing new was opened (nothing paid)', () => {
    expect(newDepositAfter429(N, new Set(['A']), [{ address: 'A', node: N, status: 'open' }, { address: 'C', node: 'other', status: 'open' }])).toEqual({ action: 'retry' });
  });
  it('ignores closed rows and stops when the list is unreadable', () => {
    expect(newDepositAfter429(N, new Set([]), [{ address: 'D', node: N, status: 'closed' }])).toEqual({ action: 'retry' });
    expect(newDepositAfter429(N, null, [])).toEqual({ action: 'unknown' });
    expect(newDepositAfter429(N, new Set([]), null)).toEqual({ action: 'unknown' });
  });
});

// ─── Another VPN on (Cosmos lesson D6), macOS ───
describe('parseScutilVpns', () => {
  it('names connected VPN services only (a disconnected modem or VPN is not a rival)', () => {
    const out = [
      'Available network connection services in the current set (*=enabled):',
      '* (Disconnected)   0A1C68B6-69DF-44D7-A13F-1897470A8FFA PPP --> Built-in Serial Port (1) "Built-in Serial Port (1)"       [PPP:Modem]',
      '* (Connected)      5D3F1E2A-1111-2222-3333-444455556666 VPN (com.wireguard.macos) "Home WG"   [VPN/WireGuard]',
      '  (Connected)      7C5E0000-1111-2222-3333-444455556666 IPSec              "Work VPN"          [IPSec]',
      '* (Disconnected)   8D6F0000-1111-2222-3333-444455556666 VPN (com.nordvpn.macos) "NordVPN"   [VPN/NordVPN]',
    ].join('\n');
    expect(parseScutilVpns(out)).toEqual(['Home WG', 'Work VPN']);
  });
  it('nothing connected: none (rig 3 real output)', () => {
    expect(parseScutilVpns('* (Disconnected)   0A1C PPP --> Built-in Serial Port (1) "Built-in Serial Port (1)" [PPP:Modem]')).toEqual([]);
  });
});

describe('parseRivalRoutesMac', () => {
  const head = 'Routing tables\n\nInternet:\nDestination        Gateway            Flags               Netif Expire\n';
  it('the 0/1 + 128.0/1 pair or a default route on a tunnel interface is a VPN', () => {
    expect(parseRivalRoutesMac(head + [
      'default            10.0.2.2           UGScg                 en0',
      '0/1                10.8.0.1           UGSc                utun5',
      '128.0/1            10.8.0.1           UGSc                utun5',
      'default            link#20            UCS                ipsec0',
    ].join('\n'))).toEqual(['utun5', 'ipsec0']);
  });
  it('a plain network and the interface-scoped defaults macOS keeps on its own utuns are not', () => {
    expect(parseRivalRoutesMac(head + [
      'default            10.0.2.2           UGScg                 en0',
      'default            link#14            UCSIg               utun0',
      '10.0.2/24          link#4             UCS                   en0      !',
    ].join('\n'))).toEqual([]);
  });
});
