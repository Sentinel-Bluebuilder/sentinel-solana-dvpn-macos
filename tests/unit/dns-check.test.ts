import { describe, expect, it } from 'vitest';
import { leftoverDns, parseDnsServers, parseNetworkServices } from '../../src/main/system/dns-check';
import { benchMs, resetRpcTransport } from '../../src/core/chain/rpc';

describe('DNS leftover check (UPSTREAM-GAPS #25) — macOS', () => {
  // `networksetup -listallnetworkservices` / `-getdnsservers <svc>` on the Sonoma guest.
  const services = parseNetworkServices('An asterisk (*) denotes that a network service is disabled.\nEthernet\n*Thunderbolt Bridge\nWi-Fi\n');

  it('lists enabled network services only', () => {
    expect(services).toEqual(['Ethernet', 'Wi-Fi']);
  });

  it('reads "no servers set" as none, and keeps IPv4 + IPv6 servers', () => {
    expect(parseDnsServers("There aren't any DNS Servers set on Ethernet.\n")).toEqual([]);
    expect(parseDnsServers('1.1.1.1\n2606:4700:4700::1111\n')).toEqual(['1.1.1.1', '2606:4700:4700::1111']);
  });

  it('treats the daemon report as a false alarm when no service keeps the VPN DNS', () => {
    expect(leftoverDns([{ alias: 'Ethernet', servers: ['10.0.2.3'] }], ['1.1.1.1', '1.0.0.1'])).toEqual([]);
    expect(leftoverDns([], ['1.1.1.1'])).toEqual([]);
  });

  it('flags a real leftover on a network service', () => {
    const rows = [{ alias: 'Ethernet', servers: ['1.1.1.1'] }, { alias: 'Wi-Fi', servers: ['192.168.1.1'] }];
    expect(leftoverDns(rows, ['1.1.1.1', '1.0.0.1']).map((a) => a.alias)).toEqual(['Ethernet']);
  });
});

describe('RPC bench after a route change', () => {
  it('benches briefly while routes settle, a minute otherwise, 8 s on 429', () => {
    resetRpcTransport();
    const now = Date.now();
    expect(benchMs(new Error('fetch failed'), now + 1_000)).toBe(3_000);
    expect(benchMs(new Error('fetch failed'), now + 60_000)).toBe(60_000);
    expect(benchMs(new Error('429 Too Many Requests'), now + 1_000)).toBe(8_000);
  });
});
