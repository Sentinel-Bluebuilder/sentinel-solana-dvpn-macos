// QA-M6 (2026-11-08): the `daemon set` confirm echo must never print the RPC gate token.
// daemon-cmd.ts builds the confirm prompt from redactSettingsForDisplay(next), not the raw next,
// so rpcUrl/rpcWsUrl with an API key never reach the terminal / scrollback / CI logs.
import { describe, it, expect } from 'vitest';
import { redactSettingsForDisplay } from '../../src/cli/daemon-cmd';
import { DNS_PRESETS, type DaemonSettings } from '../../src/core/daemon/config';

const TOKEN = '0123456789abcdef0123456789abcdef';
const WITH_TOKEN: DaemonSettings = {
  killSwitch: 'on',
  allowLan: true,
  dnsServers: DNS_PRESETS.cloudflare.servers,
  basis: 'per_gb',
  escrow: '1',
  prepayBytes: '0',
  prepaySeconds: '0',
  rpcUrl: `https://devnet.helius-rpc.com/?api-key=${TOKEN}`,
  rpcWsUrl: `wss://devnet.helius-rpc.com/?api-key=${TOKEN}`,
} as DaemonSettings;

describe('daemon set confirm echo never leaks the RPC gate token', () => {
  it('redacts rpcUrl and rpcWsUrl in the display copy', () => {
    const shown = redactSettingsForDisplay(WITH_TOKEN);
    const echo = JSON.stringify(shown, null, 2);
    expect(echo).not.toContain(TOKEN);
    expect(echo).toContain('<redacted>');
    // Not percent-encoded (the confirm prompt is plain text, like Diagnostics).
    expect(echo).not.toMatch(/%3C|%3E/);
  });

  it('leaves the unredacted settings untouched for applyDaemonSettings', () => {
    const shown = redactSettingsForDisplay(WITH_TOKEN);
    expect(WITH_TOKEN.rpcUrl).toContain(TOKEN); // source object not mutated
    expect(shown.rpcUrl).not.toBe(WITH_TOKEN.rpcUrl);
  });

  it('preserves every non-RPC field verbatim', () => {
    const shown = redactSettingsForDisplay(WITH_TOKEN);
    expect(shown.killSwitch).toBe('on');
    expect(shown.allowLan).toBe(true);
    expect(shown.basis).toBe('per_gb');
    expect(shown.dnsServers).toEqual(DNS_PRESETS.cloudflare.servers);
  });

  it('is a no-op when no RPC url is set', () => {
    const noRpc = { ...WITH_TOKEN, rpcUrl: undefined, rpcWsUrl: undefined } as unknown as DaemonSettings;
    const shown = redactSettingsForDisplay(noRpc);
    expect(JSON.stringify(shown)).not.toContain('<redacted>');
  });
});
