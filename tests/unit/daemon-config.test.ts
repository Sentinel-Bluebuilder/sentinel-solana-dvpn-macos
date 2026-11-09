import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { patchToml, readToml, renderConfigs, renderConfig, parseSettings, validateSettings, ConfigError, DNS_PRESETS, type DaemonSettings } from '../../src/core/daemon/config';

// Captured verbatim from `dvpnd init --role client`: v2 = upstream cf4c372 (bundled since
// 2026-10-21), legacy = dfe36c7 (2026-10-20), still on machines installed before that.
const ROOT = readFileSync('tests/fixtures/dvpnd-root.v2.config.toml', 'utf8');
const CLIENT = readFileSync('tests/fixtures/dvpnd-client.v2.config.toml', 'utf8');
const LEGACY_ROOT = readFileSync('tests/fixtures/dvpnd-root.config.toml', 'utf8');
const LEGACY_CLIENT = readFileSync('tests/fixtures/dvpnd-client.config.toml', 'utf8');

const SETTINGS: DaemonSettings = {
  killSwitch: 'off',
  allowLan: true,
  dnsServers: DNS_PRESETS.handshake.servers,
  basis: 'per_hour',
  escrow: '5000000',
  prepayBytes: '500000000',
  prepaySeconds: '1800',
  rpcUrl: 'https://devnet.example-rpc.test/?api-key=abc',
  rpcWsUrl: 'wss://devnet.example-rpc.test/?api-key=abc',
};

describe('daemon config', () => {
  it('reads the fixture defaults', () => {
    const s = parseSettings(ROOT, CLIENT);
    expect(s.killSwitch).toBe('on');
    expect(s.allowLan).toBe(false);
    expect(s.dnsServers).toEqual(['1.1.1.1', '1.0.0.1']);
    expect(s.basis).toBe('per_gb');
    expect(s.escrow).toBe('1000000000');
    expect(s.rpcUrl).toBe('https://api.devnet.solana.com');
  });

  it('writes the DNS mode only when given, and refuses an unknown one', () => {
    const none = parseSettings(ROOT, renderConfigs(ROOT, CLIENT, { ...SETTINGS, dnsMode: 'none' }).client);
    expect(none.dnsMode).toBe('none');
    const rc = parseSettings(ROOT, renderConfigs(ROOT, CLIENT, { ...SETTINGS, dnsMode: 'networksetup' }).client);
    expect(rc.dnsMode).toBe('networksetup');
    expect(() => renderConfigs(ROOT, CLIENT, { ...SETTINGS, dnsMode: 'netsh' })).toThrow(/DNS mode/); // Windows-only backend
    expect(() => renderConfigs(ROOT, CLIENT, { ...SETTINGS, dnsMode: 'dhcp' })).toThrow(/DNS mode/);
  });

  // dvpnd 'on' lifts the block whenever the service stops (cb33092e session.go:404-405), so the
  // app's one "On" is written as 'persist' and never as 'on'.
  it('writes kill switch on as persist; off and persist unchanged', () => {
    const ks = (k: DaemonSettings['killSwitch']): unknown => readToml(renderConfigs(ROOT, CLIENT, { ...SETTINGS, killSwitch: k }).client, 'network', 'kill_switch');
    expect(readToml(CLIENT, 'network', 'kill_switch')).toBe('on'); // dvpnd init's default, before any save
    expect(ks('on')).toBe('persist');
    expect(ks('persist')).toBe('persist');
    expect(ks('off')).toBe('off');
  });

  // QA-M7 / Q0468 (2026-11-08): on a devnet http-gate build the stored rpcUrl is http://… . A
  // KS/DNS-only `daemon set` must still persist — the writer carries the http RPC through and must
  // NOT re-impose the https rule (connect already accepts it). Before the fix this threw
  // "RPC url must use https://" in renderConfig(s) and the kill switch never landed.
  it('a KS-only set persists when the stored RPC is an http gate (writer skips the https rule)', () => {
    const gate = { ...SETTINGS, rpcUrl: 'http://10.128.0.26:8899/tok', rpcWsUrl: 'ws://10.128.0.26:8899/tok', killSwitch: 'on' as const };
    // writer does not throw on the http gate, and the KS lands (as persist)
    expect(() => renderConfigs(ROOT, CLIENT, gate)).not.toThrow();
    const client = renderConfigs(ROOT, CLIENT, gate).client;
    expect(readToml(client, 'network', 'kill_switch')).toBe('persist');
    // single-config (cb33) writer too
    expect(() => renderConfig(CLIENT, gate)).not.toThrow();
    // the https rule is NOT silently gone: validateSettings still enforces it when RPC is checked
    expect(() => validateSettings(gate)).toThrow(/https/);
    expect(() => validateSettings(gate, { skipRpc: true })).not.toThrow();
    // allowInsecureRpc (what the writers use) relaxes ONLY the protocol
    expect(() => validateSettings(gate, { allowInsecureRpc: true })).not.toThrow();
    // ...but the writer still rejects an INJECTED RPC value (quote/newline/kill_switch) — a blanket
    // skipRpc would let it through (QA / Linux the Linux app, 2026-11-08). Char + host checks still run.
    const injected = { ...gate, rpcUrl: "http://x/'\nkill_switch = off\n" };
    expect(() => validateSettings(injected, { allowInsecureRpc: true })).toThrow(/characters a URL cannot hold/);
    expect(() => renderConfig(CLIENT, injected)).toThrow();
    const badHost = { ...gate, rpcUrl: 'http://-bad-/x' };
    expect(() => validateSettings(badHost, { allowInsecureRpc: true })).toThrow(/host/);
  });

  it('round-trips every setting and keeps unrelated keys', () => {
    const out = renderConfigs(ROOT, CLIENT, SETTINGS);
    const back = parseSettings(out.root, out.client);
    const { dnsMode, ...writable } = back; // dnsMode is written only when set (SETTINGS has none)
    expect(writable).toEqual({ ...SETTINGS });
    expect(dnsMode === undefined || typeof dnsMode === 'string').toBe(true);
    expect(readToml(out.client, '', 'owner')).toBe(readToml(CLIENT, '', 'owner'));
    expect(readToml(out.client, 'key', 'name')).toBe('device');
    expect(readToml(out.root, 'daemon', 'socket_group')).toBe('dvpn');
    expect(readToml(out.root, 'tx', 'priority_fee_mode')).toBe('auto');
    // idempotent
    const again = renderConfigs(out.root, out.client, SETTINGS);
    expect(again).toEqual(out);
  });

  it('renames legacy keys the new dvpnd would silently ignore (escrow, dns)', () => {
    const legacy = patchToml(LEGACY_CLIENT, 'network', 'dns', 'none');
    expect(parseSettings(LEGACY_ROOT, legacy).dnsMode).toBe('none');
    expect(parseSettings(LEGACY_ROOT, legacy).escrow).toBe(String(readToml(LEGACY_CLIENT, '', 'escrow')));
    const out = renderConfigs(LEGACY_ROOT, legacy, SETTINGS); // SETTINGS has no dnsMode: the legacy value must survive
    expect(readToml(out.client, '', 'escrow')).toBeNull();
    expect(readToml(out.client, 'network', 'dns')).toBeNull();
    expect(readToml(out.client, '', 'escrow_base_units')).toBe(SETTINGS.escrow);
    expect(readToml(out.client, 'network', 'dns_backend')).toBe('none');
  });

  it('adds a missing key inside the right section', () => {
    const t = patchToml('[a]\nx = 1\n\n[b]\ny = 2\n', 'a', 'z', true);
    expect(t).toBe('[a]\nx = 1\nz = true\n\n[b]\ny = 2\n');
    expect(patchToml('k = 1\n', 'new', 'v', 'x')).toBe('k = 1\n\n[new]\nv = \'x\'\n');
  });

  it('accepts prepay 0 (dvpnd init writes it: the node minimum) so a fresh install can change settings', () => {
    expect(() => validateSettings({ ...SETTINGS, prepayBytes: '0', prepaySeconds: '0' })).not.toThrow();
    expect(() => validateSettings({ ...SETTINGS, prepayBytes: '0', prepaySeconds: '0', killSwitch: 'on' })).not.toThrow();
    expect(() => validateSettings({ ...SETTINGS, prepayBytes: '-1' })).toThrow(ConfigError);
    expect(() => validateSettings({ ...SETTINGS, escrow: '0' })).toThrow(ConfigError);
  });

  it('rejects bad values before anything is staged', () => {
    expect(() => validateSettings({ ...SETTINGS, killSwitch: 'maybe' as never })).toThrow(ConfigError);
    expect(() => validateSettings({ ...SETTINGS, dnsServers: ['1.1.1.1; rm'] })).toThrow(ConfigError);
    expect(() => validateSettings({ ...SETTINGS, dnsServers: [] })).toThrow(ConfigError);
    expect(() => validateSettings({ ...SETTINGS, escrow: '0' })).toThrow(ConfigError);
    expect(() => validateSettings({ ...SETTINGS, prepayBytes: '-1' })).toThrow(ConfigError);
    expect(() => validateSettings({ ...SETTINGS, prepaySeconds: '1.5' })).toThrow(ConfigError);
    expect(() => validateSettings({ ...SETTINGS, rpcUrl: 'http://evil.test' })).toThrow(ConfigError);
    // new URL() accepts these after percent-encoding; dvpnd then sat on a dead RPC (the Linux app u2404 fuzz)
    expect(() => validateSettings({ ...SETTINGS, rpcUrl: 'https://x.test/"\\n kill_switch = "off' })).toThrow(/characters a URL cannot hold/);
    expect(() => validateSettings({ ...SETTINGS, rpcUrl: 'https://x.test/a b' })).toThrow(ConfigError);
    expect(() => validateSettings({ ...SETTINGS, rpcWsUrl: 'wss://x.test/\nkill_switch=1' })).toThrow(ConfigError);
    expect(() => validateSettings({ ...SETTINGS, rpcUrl: 'https://devnet.helius-rpc.com/?api-key=abc-123' })).not.toThrow();
    expect(() => patchToml('', 'a', 'b', "it's")).toThrow(ConfigError);
  });

  it('skipRpc leaves an already-stored http gate url alone (a set that changes neither --rpc nor --rpc-ws)', () => {
    // M5: a KS-only `daemon set` carries the stored devnet http gate through validation; without
    // skipRpc it threw "RPC url must use https://" where `connect` accepts the same url.
    const gate = { ...SETTINGS, rpcUrl: 'http://10.128.0.26:8899/tok', rpcWsUrl: 'ws://10.128.0.26:8900/tok' };
    expect(() => validateSettings(gate)).toThrow(/https/); // default still enforces https (the --rpc path)
    expect(() => validateSettings({ ...gate, killSwitch: 'on' }, { skipRpc: true })).not.toThrow();
    // every non-RPC rule still runs under skipRpc
    expect(() => validateSettings({ ...gate, killSwitch: 'maybe' as never }, { skipRpc: true })).toThrow(ConfigError);
    expect(() => validateSettings({ ...gate, escrow: '0' }, { skipRpc: true })).toThrow(ConfigError);
  });
});
