// ─── Proxy on connect is proxy mode only (the macOS app rig 3: excluded Firefox exited at the node) ───
// A whole-device V2Ray/Xray session carries every app through its TUN. Pointing the system proxy
// at its SOCKS port sent browsers past split tunnelling: Xray routes that inbound straight to the
// node, so an app the user excluded still exited at the node (9/9 probes over 80 s).
import { describe, it, expect, vi } from 'vitest';

const st = vi.hoisted(() => ({ tun: false, proxyOnConnect: true }));
vi.mock('../../src/main/app-state', () => ({
  snapshot: () => ({}),
  patch: vi.fn(),
  setSplitInEffect: vi.fn(),
  setWholeDeviceInEffect: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('../../src/main/services/daemon-wait', () => ({ SERVICE_WAIT_MS: 1, waitForDaemon: async () => ({ reachable: true, device: 'Dev', networkOk: true }) }));
vi.mock('../../src/main/wallet/vault', () => ({ ownerAddress: () => 'Owner' }));
vi.mock('../../src/main/services/connect-checks', () => ({
  preflight: async () => null, reusableChannel: async () => null, prepayCost: () => '1',
  planLimitReached: async () => null, heldTicket: async () => null, nodeHasRoom: async () => false,
}));
vi.mock('../../src/main/home-ip', () => ({ ensureHomeIp: async () => undefined }));
vi.mock('../../src/core/nodes/discovery', () => ({ discoverNode: async () => ({ pricePerGb: '1000', pricePerHour: '1000', country: 'US' }) }));
vi.mock('../../src/main/logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/main/services/history', () => ({ recordStart: vi.fn(), recordEnd: vi.fn() }));
vi.mock('../../src/main/system/proxy', () => ({ setSystemProxy: vi.fn(), clearSystemProxy: async () => undefined }));
vi.mock('../../src/main/system/tunnels', () => ({ leftoverTunnels: async () => [], rivalVpns: async () => [], removeTunnelServices: async () => undefined }));
vi.mock('../../src/main/system/dns-check', () => ({ dnsReallyLeftOver: async () => false, flushDnsCache: vi.fn() }));
vi.mock('../../src/core/chain/rpc', () => ({ getRpcUrls: () => [], resetRpcTransport: vi.fn(), onRpcRetry: () => () => undefined }));
vi.mock('../../src/main/daemon/settings', () => ({ getDaemonSettings: () => ({ settings: { killSwitch: 'off', dnsServers: [] } }), serviceUsesTun: () => st.tun, splitForSession: vi.fn() }));
vi.mock('../../src/main/services/net-settle', () => ({ waitForDirectPath: async () => true }));
vi.mock('../../src/main/services/first-data', () => ({ firstData: async () => undefined }));
vi.mock('../../src/main/services/stop-session', () => ({ stopLiveOrCurrent: async () => ({ session: null, dnsRevertFailed: false }) }));
vi.mock('../../src/main/services/settlement', () => ({ claimForReuse: () => true, settleChannelSoon: vi.fn() }));
vi.mock('../../src/main/daemon/manager', () => ({ daemon: () => ({}), daemonInfo: () => ({ reachable: true }) }));
vi.mock('../../src/main/system/settings', () => ({ getSettings: () => ({ proxyOnConnect: st.proxyOnConnect, poll: {} }) }));

const { proxyOnConnectFor } = await import('../../src/main/services/connection');
const xray = { proxyEndpoint: '127.0.0.1:1080', service: 'xray' };

describe('proxyOnConnectFor', () => {
  it('proxy mode V2Ray/Xray: the system proxy follows the session (owner 2026-10-21)', () => {
    st.tun = false; st.proxyOnConnect = true;
    expect(proxyOnConnectFor(xray)).toBe(true);
  });
  it('whole-device V2Ray/Xray: never set on connect, it would bypass split tunnelling', () => {
    st.tun = true; st.proxyOnConnect = true;
    expect(proxyOnConnectFor(xray)).toBe(false);
  });
  it('setting off, or a full-tunnel protocol (no SOCKS endpoint): never', () => {
    st.tun = false; st.proxyOnConnect = false;
    expect(proxyOnConnectFor(xray)).toBe(false);
    st.proxyOnConnect = true;
    expect(proxyOnConnectFor({ proxyEndpoint: '', service: 'wireguard' })).toBe(false);
  });
});
