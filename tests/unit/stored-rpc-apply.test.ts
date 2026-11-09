// Q0468/Q0478 (3rd call site): applyDaemonSettings validated with no opts, so a stored http RPC gate
// made `daemon set --kill-switch on --yes` fail "RPC url must use https://". The stored RPC passes;
// a newly typed http RPC is still refused.
import { describe, it, expect } from 'vitest';
import { validateForApply, DNS_PRESETS, type DaemonSettings } from '../../src/core/daemon/config';

const STORED: DaemonSettings = {
  killSwitch: 'off', allowLan: true, dnsServers: DNS_PRESETS.cloudflare.servers, basis: 'per_gb',
  escrow: '1', prepayBytes: '0', prepaySeconds: '0',
  rpcUrl: 'http://10.0.0.5:8899', rpcWsUrl: 'ws://10.0.0.5:8900',
} as DaemonSettings;

describe('validateForApply', () => {
  it('stored http RPC + kill switch on succeeds', () => {
    expect(() => validateForApply({ ...STORED, killSwitch: 'on' }, STORED)).not.toThrow();
  });
  it('newly typed http RPC is still rejected', () => {
    expect(() => validateForApply({ ...STORED, rpcUrl: 'http://evil.example:8899' }, STORED)).toThrow(/https/);
  });
  it('stored value with injected characters is still rejected', () => {
    const bad = { ...STORED, rpcUrl: 'http://10.0.0.5:8899"\nkill_switch = off' };
    expect(() => validateForApply(bad, bad)).toThrow();
  });
});
