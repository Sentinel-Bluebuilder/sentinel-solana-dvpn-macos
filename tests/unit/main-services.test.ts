import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Keypair, PublicKey } from '@solana/web3.js';
import { setHost } from '../../src/main/host';
import { initStore } from '../../src/main/store';
import { setSystemProxy, clearSystemProxy, systemProxyActive, setProxyRunner, setSocksCheck, oursFor, oursMarker, isOurs, restorePlan, parseSocksProxy, type ProxyState } from '../../src/main/system/proxy';
import { helperArgs, stepOf, adminCommand, osascriptArgs, shQuote, promptCancelled, helperFor } from '../../src/main/system/elevate';
import { sanitize } from '../../src/main/system/settings';
import { historyCsv } from '../../src/main/services/history';
import { redactUrls, redact } from '../../src/main/logger';
import { parseArgs } from '../../src/cli/args';
import { nodeApiOverride } from '../../src/core/nodes/discovery';
import { providerApiOverride } from '../../src/core/plans/plans';
import { closeChannel } from '../../src/core/chain/builders';
import { pda } from '../../src/core/chain/program';
import { DEFAULT_SETTINGS } from '../../src/shared/types';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvpn-unit-'));
beforeAll(() => {
  setHost({ name: 'cli', resourcesDir: dir, dataDir: dir, emit: () => undefined, keyStore: { kind: 'memory', exists: () => false, load: () => null, save: () => undefined, remove: () => undefined } });
  initStore(dir);
});

// ─── System proxy: never touches the real network settings here ───
describe('system proxy (macOS networksetup)', () => {
  // Two services: Ethernet with the user's own (disabled) SOCKS host, Wi-Fi with nothing.
  const userState: ProxyState = {
    backend: 'networksetup',
    services: {
      Ethernet: { enabled: 'No', server: 'corp-socks', port: '1081' },
      'Wi-Fi': { enabled: 'No', server: '', port: '0' },
    },
  };
  const clone = (s: ProxyState): ProxyState => ({ backend: s.backend, services: JSON.parse(JSON.stringify(s.services)) as ProxyState['services'] });
  const fake = (start: ProxyState, backend: 'networksetup' | null = 'networksetup') => {
    let cur = clone(start);
    const sets: ProxyState[] = [];
    setProxyRunner({
      backend: async () => backend,
      query: async () => clone(cur),
      set: async (s) => {
        sets.push(clone(s));
        for (const [svc, p] of Object.entries(s.services)) {
          // networksetup keeps the old host when only the state changes
          cur.services[svc] = p.server ? { ...p } : { ...cur.services[svc], enabled: p.enabled };
        }
        return clone(cur);
      },
    });
    return { now: () => cur, sets, change: (s: ProxyState) => { cur = clone(s); } };
  };
  it('saves every service first, restores all of it exactly, and only undoes its own value', async () => {
    setSocksCheck(async () => ({ ok: true, reason: 'stub' }));
    const f = fake(userState);
    await setSystemProxy('127.0.0.1:1080');
    expect(f.now().services.Ethernet).toEqual({ enabled: 'Yes', server: '127.0.0.1', port: '1080' });
    expect(f.now().services['Wi-Fi']).toEqual({ enabled: 'Yes', server: '127.0.0.1', port: '1080' });
    expect(systemProxyActive()).toBe(true);
    await clearSystemProxy();
    expect(f.now().services.Ethernet).toEqual(userState.services.Ethernet);
    // networksetup cannot blank a host: a service that had none comes back OFF (host kept)
    expect(f.now().services['Wi-Fi'].enabled).toBe('No');
    expect(systemProxyActive()).toBe(false);
  });
  it('covers every enabled service', () => {
    expect(Object.keys(oursFor('127.0.0.1:1080', ['Ethernet', 'Wi-Fi']).services)).toEqual(['Ethernet', 'Wi-Fi']);
  });
  it('leaves a service the user changed meanwhile alone, restores the rest', async () => {
    const f = fake(userState);
    await setSystemProxy('127.0.0.1:1080');
    const theirs = clone(f.now());
    theirs.services.Ethernet = { enabled: 'Yes', server: 'other', port: '3128' };
    f.change(theirs);
    await clearSystemProxy();
    expect(f.now().services.Ethernet).toEqual({ enabled: 'Yes', server: 'other', port: '3128' });
    expect(f.now().services['Wi-Fi']).toEqual({ enabled: 'No', server: '127.0.0.1', port: '1080' });
    expect(systemProxyActive()).toBe(false);
  });
  it('restorePlan writes back only services still ours', () => {
    const now: ProxyState = { backend: 'networksetup', services: { A: { enabled: 'Yes', server: '127.0.0.1', port: '1080' }, B: { enabled: 'Yes', server: 'x', port: '1' }, C: { enabled: 'Yes', server: '127.0.0.1', port: '1080' } } };
    const saved: ProxyState = { backend: 'networksetup', services: { A: { enabled: 'No', server: '', port: '0' }, B: { enabled: 'No', server: '', port: '0' } } };
    const plan = restorePlan(now, saved, oursMarker('127.0.0.1:1080'));
    expect(plan.services).toEqual({ A: { enabled: 'No', server: '', port: '0' }, C: { enabled: 'No', server: '', port: '0' } });
  });
  it('fails when macOS does not take the setting', async () => {
    setProxyRunner({ backend: async () => 'networksetup', query: async () => clone(userState), set: async () => clone(userState) });
    await expect(setSystemProxy('127.0.0.1:1080')).rejects.toThrow(/did not accept/);
    fake(userState);
    await clearSystemProxy();
  });
  it('refuses with no networksetup, changing nothing', async () => {
    const f = fake(userState, null);
    await expect(setSystemProxy('127.0.0.1:1080')).rejects.toThrow(/no networksetup.*Nothing was changed/);
    expect(f.sets).toEqual([]);
    expect(systemProxyActive()).toBe(false);
  });
  it('reads networksetup -getsocksfirewallproxy', () => {
    expect(parseSocksProxy('Enabled: Yes\nServer: 127.0.0.1\nPort: 1080\nAuthenticated Proxy Enabled: 0\n')).toEqual({ enabled: 'Yes', server: '127.0.0.1', port: '1080' });
    expect(parseSocksProxy('Enabled: No\nServer: \nPort: 0\nAuthenticated Proxy Enabled: 0\n')).toEqual({ enabled: 'No', server: '', port: '0' });
    expect(isOurs({ backend: 'networksetup', services: { E: { enabled: 'No', server: '127.0.0.1', port: '1080' } } }, oursMarker('127.0.0.1:1080'))).toBe(false);
  });
  it('refuses a non-loopback endpoint', async () => {
    await expect(setSystemProxy('10.0.0.5:1080')).rejects.toThrow(/non-loopback/);
  });
});

describe('elevated helper arguments', () => {
  it('passes paths with spaces as single arguments and rejects injection', () => {
    const a = helperArgs('setup-daemon', { Dvpnd: '/Applications/Devnet dVPN.app/Contents/Resources/resources/bin/dvpnd', User: 'alice' });
    expect(a).toEqual(['setup-daemon', '--Dvpnd', '/Applications/Devnet dVPN.app/Contents/Resources/resources/bin/dvpnd', '--User', 'alice']);
    expect(() => helperArgs('setup-daemon', { Owner: "a'; rm -rf /" })).toThrow(/unsafe/);
    expect(() => helperArgs('setup-daemon', { Owner: '$(reboot)' })).toThrow(/unsafe/);
    expect(() => helperArgs('setup-daemon', { Owner: '--Result' })).toThrow(/unsafe/);
    expect(() => helperArgs('setup-daemon', { 'Bad-Name': 'a' })).toThrow(/parameter/);
  });
  it('runs only whitelisted steps', () => {
    expect(() => helperArgs('rm', {})).toThrow(/unknown elevated step/);
    expect(stepOf('/x/resources/scripts/apply-daemon-config.sh')).toBe('apply-daemon-config');
  });
  it('builds the osascript prompt without splicing anything into AppleScript', () => {
    const cmd = adminCommand('/Applications/Devnet dVPN.app/Contents/Resources/resources/scripts/dvpn-helper', ['service-ctl', '--Action', 'start']);
    expect(cmd).toBe("'/bin/bash' '/Applications/Devnet dVPN.app/Contents/Resources/resources/scripts/dvpn-helper' 'service-ctl' '--Action' 'start'");
    const a = osascriptArgs(cmd);
    expect(a.slice(0, 6)).toEqual(['-e', 'on run argv', '-e', 'do shell script (item 1 of argv) with prompt (item 2 of argv) with administrator privileges', '-e', 'end run']);
    expect(a[6]).toBe(cmd);
    expect(shQuote("it's")).toBe("'it'\\''s'");
    expect(promptCancelled('0:120: execution error: User canceled. (-128)')).toBe(true);
    expect(promptCancelled('execution error: dvpn-helper: unknown step')).toBe(false);
  });
  it('runs the root-owned helper copy after setup, the bundled one for setup itself', () => {
    const bundle = '/Applications/Devnet dVPN.app/Contents/Resources/resources/scripts';
    expect(helperFor('remove-tunnels', bundle, true).split('\\').join('/')).toBe('/Library/devnet-dvpn/scripts/dvpn-helper');
    expect(helperFor('setup-daemon', bundle, true).split('\\').join('/')).toBe(`${bundle}/dvpn-helper`);
    expect(helperFor('remove-tunnels', bundle, false).split('\\').join('/')).toBe(`${bundle}/dvpn-helper`);
  });
});

describe('settings allow-list', () => {
  it('drops unknown keys and invalid values, keeps valid ones', () => {
    const s = sanitize({ rpcUrls: ['http://evil.example', 'https://ok.example'], defaultGb: 3, theme: 'dark', bogus: 1 } as never);
    expect(s.rpcUrls).toEqual(['https://ok.example']);
    expect(s.defaultGb).toBe(DEFAULT_SETTINGS.defaultGb);
    expect(s.theme).toBe('dark');
    expect((s as unknown as Record<string, unknown>).bogus).toBeUndefined();
  });
});

describe('history csv', () => {
  it('escapes commas and quotes', () => {
    const csv = historyCsv([{ id: 'a', node: 'n', country: 'Korea, South', service: 'wg', startedAt: 1, endedAt: 2, rxBytes: '1', txBytes: '2', spent: '3', channel: 'c', closeReason: 'say "hi"' }]);
    expect(csv.split('\n')[1]).toBe('a,n,"Korea, South",wg,1,2,1,2,3,c,"say ""hi"""');
  });
});

describe('redaction', () => {
  it('strips query strings from http and ws URLs, and secret keys from objects', () => {
    expect(redactUrls('url = wss://rpc.example/?api-key=SECRET')).toBe('url = wss://rpc.example/?<redacted>');
    expect(JSON.stringify(redact({ mnemonic: 'a b c', url: 'https://x/?k=1' }))).toBe('{"mnemonic":"[redacted]","url":"https://x/?<redacted>"}');
    // user:password@ is a credential too; an @ later in the path is not userinfo
    expect(redactUrls('unknown job "https://u:p@127.0.0.1:9/?api-key=S"')).toBe('unknown job "https://<redacted>@127.0.0.1:9/?<redacted>"');
    expect(redactUrls('see https://host/a@b and wss://k@rpc.x/ws')).toBe('see https://host/a@b and wss://<redacted>@rpc.x/ws');
  });
});

describe('cli args', () => {
  it('parses positionals, flags, booleans and -y', () => {
    const a = parseArgs(['connect', 'N', '--units', '2', '--yes', '--basis=per_hour', '-y', '--json']);
    expect(a._).toEqual(['connect', 'N']);
    expect(a.flags).toEqual({ units: '2', yes: true, basis: 'per_hour', json: true });
  });
});

describe('test-rig overrides', () => {
  it('match only the named account', () => {
    expect(nodeApiOverride('A', 'A=https://127.0.0.1:1,B=https://x:2')).toBe('https://127.0.0.1:1');
    expect(nodeApiOverride('C', 'A=https://127.0.0.1:1')).toBeNull();
    expect(providerApiOverride('P', 'P=https://127.0.0.1:19443/')).toBe('https://127.0.0.1:19443');
  });
});

// ─── close_channel grant (grants program, 2026-10-21) ───
describe('close_channel grant', () => {
  const owner = Keypair.generate().publicKey;
  const device = Keypair.generate().publicKey;
  const ch = { address: Keypair.generate().publicKey, owner, opener: device, node: Keypair.generate().publicKey, rentPayer: device, mode: 1 };
  const keysOf = (ix: { keys: Array<{ pubkey: PublicKey }> }): string[] => ix.keys.map((k) => k.pubkey.toBase58());
  it('owner-signed close of a device channel passes no grant', async () => {
    const ix = await closeChannel({ signer: owner, ch });
    expect(keysOf(ix)).not.toContain(pda.grant(owner, device).toBase58());
  });
  it('device-signed stream close passes the [owner, signer, default] grant', async () => {
    const ix = await closeChannel({ signer: device, ch });
    expect(keysOf(ix)).toContain(pda.grant(owner, device).toBase58());
  });
  it('voucher close passes no grant (anyone may close after the grace)', async () => {
    const ix = await closeChannel({ signer: device, ch: { ...ch, mode: 0 } });
    expect(keysOf(ix)).not.toContain(pda.grant(owner, device).toBase58());
  });
});

// ─── Display formatting shared by renderer, CLI and main ───
describe('format', () => {
  it('formats balances, bytes, durations and countdowns', async () => {
    const f = await import('../../src/shared/format');
    expect(f.formatTdvpn('946397711839')).toBe('946,397.71');
    expect(f.formatTdvpn('1994000')).toBe('1.994');
    expect(f.formatTdvpn('999123456')).toBe('999.123456');
    expect(f.formatBytes(3_200_000)).toBe('3.2 MB');
    expect(f.formatDuration(3725)).toBe('1:02:05');
    expect(f.formatCountdown(5700)).toBe('1 h 35 min');
  });
});

describe('quick pick', () => {
  it('prefers favourites, then preferred country, then lowest latency; online only', async () => {
    const { pickQuickNode } = await import('../../src/shared/quick-pick');
    const n = (address: string, cc: string, ms: number | null, fav = false) => ({ address, countryCode: cc, favourite: fav, probe: ms === null ? { ok: false } : { ok: true, latencyMs: ms } }) as never;
    const list = [n('A', 'DE', 80), n('B', 'US', 20), n('C', 'DE', 40), n('D', 'IN', 5, true), n('E', 'US', null, true)];
    expect(pickQuickNode(list, null)!.address).toBe('D');
    expect(pickQuickNode(list.slice(0, 3), 'DE')!.address).toBe('C');
    expect(pickQuickNode(list.slice(0, 3), null)!.address).toBe('B');
    expect(pickQuickNode([n('E', 'US', null)], null)).toBeNull();
  });
});

const userStateSafety: ProxyState = { backend: 'networksetup', services: { Ethernet: { enabled: 'No', server: '', port: '0' } } };
describe('system proxy safety', () => {
  it('a dead SOCKS endpoint changes nothing (the internet stays up)', async () => {
    const calls: string[][] = [];
    setProxyRunner({ backend: async () => { calls.push(['backend']); return 'networksetup'; }, query: async () => { calls.push(['query']); return userStateSafety; }, set: async (s) => { calls.push(['set']); return s; } });
    setSocksCheck(async () => ({ ok: false, reason: 'ECONNREFUSED' }));
    await expect(setSystemProxy('127.0.0.1:1080')).rejects.toThrow(/not answering.*Nothing was changed/);
    expect(calls).toEqual([]);
  });
});
