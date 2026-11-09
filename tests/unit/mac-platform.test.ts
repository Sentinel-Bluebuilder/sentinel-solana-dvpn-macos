// ─── macOS platform layer: pure parts of autostart, terminal, Keychain, scripts, packaging ───
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ safeStorage: {} }));

import { autostartEntry, autostartPath, AUTOSTART_LABEL } from '../../src/main/system/autostart';
import { cliShellRc, commandFile, shq } from '../../src/main/services/cli-exec';
import { keychainAccount, keyringError, securityLine, addCommand, KEYCHAIN_SERVICE } from '../../src/cli/keystore';
import { backendIsStrong } from '../../src/main/wallet/electron-keystore';
import { daemonLinkCopy } from '../../src/core/daemon/link-copy';
import { initArgs, instanceDir, legacyHome } from '../../src/core/daemon/layout';

const fwd = (p: string): string => p.split('\\').join('/');
const onMac = process.platform === 'darwin';

describe('login item (LaunchAgent)', () => {
  it('starts the app hidden at login', () => {
    const e = autostartEntry('/Applications/Devnet dVPN.app/Contents/MacOS/Devnet dVPN');
    expect(e).toContain(`<key>Label</key><string>${AUTOSTART_LABEL}</string>`);
    expect(e).toContain('<array><string>/Applications/Devnet dVPN.app/Contents/MacOS/Devnet dVPN</string><string>--hidden</string></array>');
    expect(e).toContain('<key>RunAtLoad</key><true/>');
  });
  it('escapes XML in the path', () => {
    expect(autostartEntry('/Users/a&b/<x>/app')).toContain('<string>/Users/a&amp;b/&lt;x&gt;/app</string>');
  });
  it('lives in ~/Library/LaunchAgents', () => {
    expect(fwd(autostartPath('/Users/u'))).toBe('/Users/u/Library/LaunchAgents/network.sentinel.devnet-dvpn.app.plist');
  });
  it('is a valid plist (plutil)', () => {
    if (!onMac) return; // the macOS run is the one that counts
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ddv-la-')), 'a.plist');
    fs.writeFileSync(f, autostartEntry('/Applications/Devnet dVPN.app/Contents/MacOS/Devnet dVPN'));
    execFileSync('/usr/bin/plutil', ['-lint', f]);
  });
});

describe('Terminal for the CLI', () => {
  it('binds devnet-dvpn to this app with every path single-quoted', () => {
    const rc = cliShellRc('/Applications/Devnet dVPN.app/Contents/MacOS/Devnet dVPN', "/x/it's/cli.cjs", '/r', '/d');
    expect(rc).toContain("export DVPN_DATA_DIR='/d'");
    expect(rc).toContain("ELECTRON_RUN_AS_NODE=1 NODE_NO_WARNINGS=1 '/Applications/Devnet dVPN.app/Contents/MacOS/Devnet dVPN' '/x/it'\\''s/cli.cjs' \"$@\"");
    expect(shq("a'b")).toBe("'a'\\''b'");
  });
  it('the .command file runs Apple bash with the rc file', () => {
    const c = commandFile('/Users/u/Library/Application Support/Devnet dVPN/cli-shell.rc', '/x');
    expect(c.split('\n')[0]).toBe('#!/bin/bash');
    expect(c).toContain("exec /bin/bash --rcfile '/Users/u/Library/Application Support/Devnet dVPN/cli-shell.rc' -i");
  });
  it('the rc and .command files are valid bash', () => {
    if (process.platform === 'win32') return;
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ddv-rc-'));
    fs.writeFileSync(path.join(d, 'rc'), cliShellRc('/x y/app', '/c.cjs', '/r', '/d'));
    fs.writeFileSync(path.join(d, 'c'), commandFile(path.join(d, 'rc'), d));
    execFileSync('/bin/bash', ['-n', path.join(d, 'rc')]);
    execFileSync('/bin/bash', ['-n', path.join(d, 'c')]);
  });
});

describe('CLI Keychain wallet', () => {
  it('names the wallet by this data folder', () => {
    expect(KEYCHAIN_SERVICE).toBe('devnet-dvpn');
    expect(keychainAccount('/Users/u/Library/Application Support/Devnet dVPN')).toBe(`cli-wallet:${path.resolve('/Users/u/Library/Application Support/Devnet dVPN')}`);
  });
  it('sends the secret hex-encoded on stdin, never as an argument', () => {
    if (process.platform === 'win32') return; // path.resolve adds a backslash, which securityLine refuses
    const line = addCommand('/d', '[1,2,3]');
    expect(line).toContain(`-X ${Buffer.from('[1,2,3]').toString('hex')}`);
    expect(line).not.toContain('[1,2,3]');
    expect(line).toContain('-U');
    expect(line.endsWith('\n')).toBe(true);
  });
  it('quotes values with spaces and refuses quotes or newlines', () => {
    expect(securityLine(['find-generic-password', '-a', 'cli-wallet:/Users/u/Library/Application Support/x'])).toBe('find-generic-password -a "cli-wallet:/Users/u/Library/Application Support/x"\n');
    expect(() => securityLine(['a"b'])).toThrow(/quote or newline/);
    expect(() => securityLine(['a\nb'])).toThrow(/quote or newline/);
  });
  it('turns Keychain failures into an action', () => {
    expect(keyringError('security: SecKeychainItemCopyContent: User interaction is not allowed.').message).toMatch(/locked.*--keyfile/);
    expect(keyringError('weird').message).toMatch(/could not store or read the wallet: weird/);
  });
});

describe('desktop app wallet encryption', () => {
  it('macOS: safeStorage is Keychain-backed; basic_text is still refused', () => {
    expect(backendIsStrong('unknown', 'darwin')).toBe(true);
    expect(backendIsStrong('basic_text', 'darwin')).toBe(false);
    expect(backendIsStrong('basic_text', 'linux')).toBe(false);
  });
});

describe('socket and daemon home', () => {
  it('device init never asks the daemon to chown to the socket group (EPERM for a non-member)', () => {
    // cb33: `init --instance c0 --home <staging> --owner <o> --plain-key`. --instance c0 sets the
    // client role (no --role), and no group flag — the daemon gives the socket its group only when
    // run as the real instance (setup-daemon.sh does that), so init never chowns and cannot EPERM.
    const args = initArgs('/staging', 'OWNER');
    expect(args).toEqual(['init', '--instance', 'c0', '--home', '/staging', '--owner', 'OWNER', '--plain-key']);
    expect(args).not.toContain('--socket-group');
    expect(args).not.toContain('--group');
    expect(args).not.toContain('--role');
    // The real client home is the cb33 instance dir; the pre-cb33 home is only the migration source.
    expect(instanceDir('darwin')).toBe('/Library/Application Support/sentinel-dvpn/c0');
    expect(legacyHome('darwin')).toBe('/var/db/dvpnd/client');
  });
  it('a refused socket says what to do', () => {
    expect(daemonLinkCopy('connect EACCES /var/db/dvpnd/client/daemon.sock')).toMatch(/not allowed/);
    expect(daemonLinkCopy('connect ENOENT /var/db/dvpnd/client/daemon.sock')).toMatch(/not running/);
  });
  it('setup gives the user an inherited ACL so the re-created socket stays reachable', () => {
    const s = fs.readFileSync('resources/scripts/setup-daemon.sh', 'utf8');
    expect(s).toContain('file_inherit');
    expect(s).toContain('dseditgroup -o edit -a "$USER_NAME" -t user "$GROUP"');
  });
  it('uninstall asks dvpnd to release a held kill switch before removing the service', () => {
    const src = fs.readFileSync('src/main/daemon/manager.ts', 'utf8');
    const body = src.slice(src.indexOf('export async function uninstallService'));
    expect(body.indexOf("daemon().stopSession('', {})")).toBeGreaterThan(0);
    expect(body.indexOf("daemon().stopSession('', {})")).toBeLessThan(body.indexOf("runElevated(scriptPath('uninstall-cleanup.sh')"));
  });
  it('a reinstall puts the user\'s AmneziaWG build back (uninstall empties the service folder)', () => {
    const setup = fs.readFileSync('resources/scripts/setup-daemon.sh', 'utf8');
    expect(setup).toContain('--CopyOnly 1 ${USER_NAME:+--User "$USER_NAME"}');
    const deps = fs.readFileSync('resources/scripts/install-deps.sh', 'utf8');
    const copyOnly = deps.slice(deps.indexOf('if [ "$COPY_ONLY" = 1 ]; then'), deps.indexOf('exit 0', deps.indexOf('if [ "$COPY_ONLY" = 1 ]; then')));
    expect(copyOnly).toContain('install_awg_from "$(awg_cache "$home_u")" "$USER_NAME"');
  });
});

// ─── Root scripts run under Apple's /bin/bash 3.2 with BSD tools ───
const SCRIPTS = [
  ...fs.readdirSync('resources/scripts').map((f) => path.join('resources/scripts', f)),
  ...(fs.existsSync('build/mac') ? fs.readdirSync('build/mac').filter((f) => f.endsWith('.sh')).map((f) => path.join('build/mac', f)) : []),
  'build/cli/devnet-dvpn',
  ...fs.readdirSync('scripts/e2e/mac').filter((f) => f.endsWith('.sh')).map((f) => path.join('scripts/e2e/mac', f)),
];
const ROOT_SCRIPTS = fs.readdirSync('resources/scripts').map((f) => path.join('resources/scripts', f));

describe('shell scripts', () => {
  it.each(SCRIPTS)('%s has LF line ends and a bash shebang', (f) => {
    const s = fs.readFileSync(f, 'utf8');
    expect(s.includes('\r')).toBe(false);
    if (!f.endsWith('_lib.sh')) expect(s.startsWith('#!/bin/bash') || s.startsWith('#!/bin/sh') || s.startsWith('#!/usr/bin/env bash')).toBe(true);
  });
  it.each(SCRIPTS)('%s parses (bash -n)', (f) => {
    if (process.platform === 'win32') return;
    execFileSync('/bin/bash', ['-n', f]);
  });
  // Each of these works on Linux and breaks on macOS (bash 3.2, BSD userland).
  const BANNED: Array<[RegExp, string]> = [
    [/declare -A|local -A/, 'associative arrays (bash 4)'],
    [/\$\{[A-Za-z_]+(,,|\^\^)\}/, 'case conversion (bash 4)'],
    [/\bmapfile\b|\breadarray\b/, 'mapfile (bash 4)'],
    [/readlink -[fm]\b/, 'readlink -f/-m (GNU)'],
    [/realpath -m/, 'realpath -m (GNU)'],
    [/sed -i (?!'')/, "sed -i without '' (GNU)"],
    [/stat -c/, 'stat -c (GNU)'],
    [/--no-preserve/, 'cp --no-preserve (GNU)'],
    [/\bgetent\b|\bsystemctl\b|\bjournalctl\b|\bsetfacl\b|\bgroupadd\b|\busermod\b|\bnft\b|\bip (link|rule|route)\b|\/proc\//, 'Linux-only tool'],
    [/date [^|]*%F|%T/, 'date %F/%T is fine on BSD, but keep the explicit form'],
  ];
  it.each(ROOT_SCRIPTS)('%s uses nothing Linux-only (bash 3.2 + BSD tools)', (f) => {
    const lines = fs.readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l));
    for (const [re, why] of BANNED) {
      const hit = lines.find((l) => re.test(l));
      expect(hit, `${f}: ${why}: ${hit}`).toBeUndefined();
    }
  });
  it('never runs a user-writable interpreter as root', () => {
    for (const f of ROOT_SCRIPTS) {
      const s = fs.readFileSync(f, 'utf8');
      expect(s, f).not.toMatch(/^#!\/usr\/bin\/env bash/);
      expect(s, f).not.toMatch(/(\/opt\/homebrew|\/usr\/local)\/bin\/bash\b/);
    }
  });
  it('every helper step has its script, and nothing else is reachable', async () => {
    const { HELPER_STEPS } = await import('../../src/main/system/elevate');
    for (const s of HELPER_STEPS) expect(fs.existsSync(`resources/scripts/${s}.sh`)).toBe(true);
    const helper = fs.readFileSync('resources/scripts/dvpn-helper', 'utf8');
    const listed = /case "\$step" in\n\s+([a-z|-]+)\)/.exec(helper)?.[1].split('|');
    expect(listed?.sort()).toEqual([...HELPER_STEPS].sort());
  });
  it('restore network never flushes or disables all of pf', () => {
    for (const f of ROOT_SCRIPTS) {
      const s = fs.readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
      expect(s, f).not.toMatch(/pfctl -F all(?! )/);
      expect(s, f).not.toMatch(/pfctl -d\b/);
      expect(s, f).not.toMatch(/pfctl -F (rules|nat|states)/);
    }
    expect(fs.readFileSync('resources/scripts/remove-tunnels.sh', 'utf8')).toContain('pfctl -a sentinel-dvpn-c0 -F all');
  });
});

describe('shell scripts under the real /bin/bash (macOS run)', () => {
  it('_lib.sh: args, JSON escaping and path checks', () => {
    if (!onMac) return;
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'devnet-dvpn-T'));
    const out = execFileSync('/bin/bash', ['-c', [
      'set -uo pipefail', `source ${shq(path.resolve('resources/scripts/_lib.sh'))}`,
      `parse_args --Result ${shq(path.join(d, 'result.json'))} --Name 'a "b" c'`,
      'echo "$ARG_Name"', 'json_str "x\\"y\\\\z"; echo',
      'under /var/db/dvpnd/client /var/db/dvpnd && echo in', 'under /var/db/dvpnd/../x /var/db/dvpnd || echo out',
      'under /private/var/db/dvpnd/client/x /var/db/dvpnd && echo private-ok',
      'write_result ok "done"', `cat ${shq(path.join(d, 'result.json'))}`,
    ].join('\n')], { encoding: 'utf8' }).split('\n');
    expect(out[0]).toBe('a "b" c');
    expect(out[1]).toBe('"x\\"y\\\\z"');
    expect(out[2]).toBe('in');
    expect(out[3]).toBe('out');
    expect(out[4]).toBe('private-ok');
    expect(JSON.parse(out[5])).toMatchObject({ status: 'ok', detail: 'done' });
  });
});

describe('doctor sees the service PATH', () => {
  it('tools folder first, then protocol folders, the user PATH last', async () => {
    const { servicePathFor } = await import('../../src/main/daemon/manager');
    const p = servicePathFor('/usr/local/bin:/usr/bin', '/Library/devnet-dvpn/tools', ['/A/xray', '/A/v2ray']).split(require('node:path').delimiter);
    expect(p[0]).toBe('/Library/devnet-dvpn/tools');
    expect(p.slice(1, 3)).toEqual(['/A/xray', '/A/v2ray']);
    expect(p[p.length - 1]).toBe('/usr/local/bin:/usr/bin'.split(require('node:path').delimiter).pop());
    expect(servicePathFor('', null, [])).toBe('');
  });
});

describe('doctor run as the desktop user', () => {
  it('a running service owns the key and DB: those denials are not failures', async () => {
    const { doctorForUser } = await import('../../src/main/daemon/manager');
    const rows = [
      { name: 'key', ok: false, level: 'fail' as const, detail: 'loading key: reading key file: open /var/db/dvpnd/client/client/keys/device.json: permission denied' },
      { name: 'kill_switch', ok: true, level: 'warn' as const, detail: 'store unusable: sqlite3: unable to open database file' },
      { name: 'rpc', ok: false, level: 'fail' as const, detail: 'permission denied' },
    ];
    const up = doctorForUser(rows, true, false);
    expect(up[0].level).toBe('ok');
    expect(up[1].level).toBe('ok');
    expect(up[2].level).toBe('fail');
    expect(doctorForUser(rows, false, false)[0].level).toBe('fail');
    expect(doctorForUser(rows, true, true)[0].level).toBe('fail');
  });
  it('privileges: the user is not root, the answering service is', async () => {
    const { doctorForUser } = await import('../../src/main/daemon/manager');
    const rows = [{ name: 'privileges', ok: false, level: 'fail' as const, detail: 'insufficient privileges: the client role must run as root' }];
    expect(doctorForUser(rows, true, false)[0]).toMatchObject({ ok: true, level: 'ok' });
    expect(doctorForUser(rows, false, false)[0].level).toBe('fail'); // no service: a real problem
  });
});

describe('device address without the secret', () => {
  it('reads device.pub and rejects anything that is not an address', async () => {
    const { readDevicePub } = await import('../../src/main/daemon/manager');
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ddv-pub-'));
    expect(readDevicePub(d)).toBeNull();
    fs.writeFileSync(path.join(d, 'device.pub'), '8HfzUKNUnzt9zNpfnh1A3FZRDpZbKzaDCPaESAh4DPVh\n');
    expect(readDevicePub(d)).toBe('8HfzUKNUnzt9zNpfnh1A3FZRDpZbKzaDCPaESAh4DPVh');
    fs.writeFileSync(path.join(d, 'device.pub'), '{"secret":[1,2,3]}');
    expect(readDevicePub(d)).toBeNull();
  });
  it('setup writes only the public key at 0600 with a user read ACL, and keeps keys root-only', () => {
    const s = fs.readFileSync('resources/scripts/setup-daemon.sh', 'utf8');
    expect(s).toContain('key list --instance "$INSTANCE" --home');
    expect(s).not.toContain('keys list');
    expect(s).toContain('chmod 600 "$HOME_DIR/device.pub"');
    expect(s).toMatch(/device\.pub.*chmod \+a "user:\$USER_NAME allow read,readattr" "\$HOME_DIR\/device\.pub"/);
    expect(s).toMatch(/chown -R root:wheel "\$k"; chmod -R go-rwx "\$k"/);
  });
  it('doctor-clean modes: home 0750, config subdirs 0700, config.toml 0600 (user reaches them by ACL)', () => {
    const s = fs.readFileSync('resources/scripts/setup-daemon.sh', 'utf8');
    expect(s).toContain('chmod 750 "$HOME_DIR"');
    expect(s).toMatch(/-mindepth 1 -type d .* -exec chmod 700 \{\} \+/);
    expect(s).toMatch(/-name config\.toml .* -exec chmod 600 \{\} \+/);
    expect(s).not.toContain('-exec chmod 750 {} +');
    expect(s).not.toContain('-exec chmod 640 {} +');
  });
  it('cb33 upgrade clears a stale legacy pf kill-switch anchor so KS-on can attach', () => {
    const s = fs.readFileSync('resources/scripts/setup-daemon.sh', 'utf8');
    expect(s).toContain('pfctl -a dvpnd -F all');
    expect(s).toContain('pfctl -a "sentinel-dvpn-$INSTANCE" -F all');
    const r = fs.readFileSync('resources/scripts/remove-tunnels.sh', 'utf8');
    expect(r).toContain('pfctl -a dvpnd -F all');
  });
  it('cb33 upgrade boots out and removes the pre-cb33 LaunchDaemon (old label), only if present', () => {
    const s = fs.readFileSync('resources/scripts/setup-daemon.sh', 'utf8');
    expect(s).toContain('OLD_LABEL="network.sentinel.devnet-dvpn.dvpnd"');
    // guarded on presence and on not matching our own label, then bootout + delete
    expect(s).toMatch(/\[ "\$OLD_LABEL" != "\$LABEL" \] && \[ -f "\$OLD_PLIST" \]/);
    expect(s).toMatch(/launchctl bootout "system\/\$OLD_LABEL"/);
    expect(s).toMatch(/rm -f "\$OLD_PLIST"/);
  });
});

describe('dvpnd doctor rows', () => {
  it('reads cf4c372 (name/ok/detail) and dfe36c7 (Name/OK/Detail) output, grant copy is plain', async () => {
    const { parseDoctorRows } = await import('../../src/main/daemon/manager');
    const v2 = parseDoctorRows('[{"detail":"","name":"rpc","ok":true},{"detail":"missing on PATH: [xray]","name":"service_binaries_xray","ok":true},{"detail":"8Hfz… holds no grant from Hyi…; run dvpnctl grant open-grant --key <owner>","name":"grant","ok":false}]');
    expect(v2.map((r) => r.level)).toEqual(['ok', 'warn', 'fail']);
    expect(v2[2].detail).toMatch(/no spending permission yet/);
    expect(v2[2].detail).not.toMatch(/dvpnctl/);
    const v1 = parseDoctorRows('[{"Name":"key","OK":true,"Detail":""}]');
    expect(v1).toEqual([{ name: 'key', ok: true, level: 'ok', detail: '' }]);
  });
});

describe('LaunchDaemon', () => {
  const s = fs.readFileSync('resources/scripts/setup-daemon.sh', 'utf8');
  it('keeps retries a minute apart while the device has no grant (RPC budget)', () => {
    expect(s).toContain('<key>ThrottleInterval</key><integer>60</integer>');
    expect(s).toContain('<key>KeepAlive</key><true/>');
    expect(s).toContain('plutil -lint');
  });
  it('the service PATH holds only root-owned folders', () => {
    const line = /SVC_PATH="\$LIB\/tools"[\s\S]*?SVC_PATH="\$SVC_PATH:\/usr\/bin:\/bin:\/usr\/sbin:\/sbin"/.exec(s)?.[0] ?? '';
    expect(line).not.toMatch(/homebrew|\/usr\/local\/bin/);
  });
  it('reads launchctl kickstart results', async () => {
    const { classifyServiceStart } = await import('../../src/main/daemon/manager');
    expect(classifyServiceStart(0, '')).toBe('started');
    expect(classifyServiceStart(1, 'Could not kickstart service "x": 1: Operation not permitted')).toBe('no-right');
    expect(classifyServiceStart(113, 'Could not find service "network.sentinel.devnet-dvpn.dvpnd" in domain for system')).toBe('no-service');
    expect(classifyServiceStart(5, 'Bootstrap failed: 5: Input/output error')).toBe('failed');
  });
});

describe('cb33 config migration (sentinel-dvpnd ignores the old key names)', () => {
  const m = fs.readFileSync('resources/scripts/migrate-daemon-config.sh', 'utf8');
  it('renames the same keys as the Windows and Linux scripts, now in the one config.toml', () => {
    // cb33 keeps ONE config.toml, so the table is `old new` (the file column is gone), plus a
    // trailing `socket_group` with no replacement (cb33 has no such key; the line is dropped).
    const table = /RENAMES='([^']+)'/.exec(m)?.[1]
      .split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);
    expect(table).toEqual([
      'pipe endpoint',
      'compute_unit_margin compute_unit_margin_percent',
      'loaded_data_limit loaded_data_limit_bytes',
      'max_priority_fee max_priority_fee_lamports',
      'priority_fee priority_fee_lamports',
      'escrow escrow_base_units',
      'dns dns_backend',
      'socket_group',
    ]);
  });
  it('runs at setup, only under the cb33 state root', () => {
    expect(fs.readFileSync('resources/scripts/setup-daemon.sh', 'utf8')).toContain('migrate-daemon-config.sh" --DaemonHome "$HOME_DIR"');
    expect(m).toContain('under "$HOME_DIR" "$DAEMON_ROOT"');
  });
});

describe('AmneziaWG source pins', () => {
  it('builds the same generation as the nodes, pinned to a commit', () => {
    const s = fs.readFileSync('resources/scripts/install-deps.sh', 'utf8');
    expect(s).toContain('AWG_TOOLS_TAG=v3.1.20260812; AWG_TOOLS_COMMIT=ee0f0a9aa34ff0a0da4b3433b9512781cfe02843');
    expect(s).toMatch(/AWG_GO_COMMIT=[0-9a-f]{40}/);
    // built as the user, never root: the user phase refuses root, and root runs it as the user
    expect(s).toContain("|| die 'the user phase runs as the Mac user");
    expect(s).toContain('sudo -u "$USER_NAME" -H /bin/bash "$0" --UserPhase 1');
  });
});

describe('uninstall restores the system proxy', () => {
  it('reads the backup the app writes and only undoes a value still ours', () => {
    const s = fs.readFileSync('resources/scripts/uninstall-cleanup.sh', 'utf8');
    expect(s).toContain('state.services');
    expect(s).toContain('[ "$cur_en" = Yes ] && [ "$cur_host:$cur_port" = "$ours" ]');
    expect(s).toContain('Library/Application\\ Support/Devnet\\ dVPN/proxy-backup.json');
  });
});

describe('service update after a .dmg update', () => {
  it('lists every shipped file whose root copy differs, nothing when equal', async () => {
    const { serviceStaleFiles } = await import('../../src/main/daemon/manager');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ddv-stale-'));
    const put = (p: string, s: string): void => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), s); };
    put('bundle/bin/sentinel-dvpnd', 'd2'); put('bundle/bin/xray/xray', 'x1'); put('bundle/bin/xray/geoip.dat', 'g2'); put('bundle/scripts/remove-tunnels.sh', 's2');
    put('lib/sentinel-dvpnd', 'd1'); put('lib/xray/xray', 'x1'); put('lib/xray/geoip.dat', 'g1'); put('lib/scripts/remove-tunnels.sh', 's2');
    const run = (): string[] => serviceStaleFiles(path.join(root, 'lib'), path.join(root, 'bundle/bin'), path.join(root, 'bundle/scripts'), path.join(root, 'bundle/bin/sentinel-dvpnd'));
    expect(run()).toEqual(['sentinel-dvpnd', 'xray/geoip.dat']);
    put('lib/sentinel-dvpnd', 'd2'); put('lib/xray/geoip.dat', 'g2');
    expect(run()).toEqual([]);
    put('bundle/scripts/_lib.sh', 'new file');
    expect(run()).toEqual(['scripts/_lib.sh']);
  });
  it('setup deletes only a daemon-staging folder under /Users, never a link', () => {
    const s = fs.readFileSync('resources/scripts/setup-daemon.sh', 'utf8');
    expect(s).toContain('[[ "$STAGING" == /Users/?*/daemon-staging ]]');
    expect(s).toContain('[ ! -L "$STAGING" ]');
    expect(s.indexOf('unexpected staging folder')).toBeLessThan(s.indexOf('rm -rf -- "$STAGING"'));
  });
});

describe('driver repair keeps its output and says why AmneziaWG is missing', () => {
  const s = fs.readFileSync('resources/scripts/install-deps.sh', 'utf8');
  it('the user phase (Homebrew + AmneziaWG) logs to install-deps.log as root, never /dev/null', () => {
    expect(s).toContain('LOG="$OUT/install-deps.log"');
    expect(s).toContain('--UserPhase 1 >> "$LOG" 2>&1');
  });
  it('the app runs the long part as the user with no 30-minute cut, then a short copy step', () => {
    const d = fs.readFileSync('src/main/system/drivers.ts', 'utf8');
    expect(d).toContain("'--UserPhase', '1'");
    expect(d).toContain("{ User: user, Built: '1' }, COPY_STEP_MS");
    expect(d).not.toContain('1_800_000');
    expect(s).toContain('exit 3; }'); // an AmneziaWG build failure still lets WireGuard / OpenVPN be copied
  });
  it('progress lines: our stages and Homebrew steps, colour codes removed', async () => {
    const { progressLine } = await import('../../src/main/system/drivers');
    expect(progressLine('PROGRESS Homebrew: installing openvpn')).toBe('Homebrew: installing openvpn');
    expect(progressLine('\x1b[34m==>\x1b[0m \x1b[1mInstalling wireguard-tools dependency: gettext\x1b[0m')).toBe('Homebrew: Installing wireguard-tools dependency: gettext');
    expect(progressLine('checking for gcc... gcc')).toBeNull();
  });
  it('the report and the error carry the build failure', () => {
    expect(s).toContain('${AWG_WHY:+; build failed: $AWG_WHY}');
    expect(s).toContain('${AWG_WHY:+ (AmneziaWG: $AWG_WHY)}. Details: $LOG');
  });
});

describe('AmneziaWG awg-quick is fixed on install', () => {
  it('the copy step pipes awg-quick through fix_awg_quick and refuses a script that still uses wg paths', () => {
    const s = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../resources/scripts/install-deps.sh'), 'utf8') as string;
    expect(s).toMatch(/tail -n \+2 "\$dir\/awg-quick" \| fix_awg_quick/);
    expect(s).toMatch(/awg_quick_ok "\$TOOLS\/awg-quick" \|\|/);
    expect(s).toContain("s|/var/run/wireguard/|/var/run/amneziawg/|g");
  });
});

describe('setup after a wallet switch (fleet bug W1)', () => {
  const s = fs.readFileSync('resources/scripts/setup-daemon.sh', 'utf8');
  it('a staged device key that differs from the installed one replaces the home; the old home is kept, never deleted', () => {
    expect(s).toContain('[ "$staged_key" != "$installed_key" ]');
    expect(s).toMatch(/svc_stop \|\| die/);
    expect(s).toContain('mv "$HOME_DIR" "$prev"');
    expect(s).toContain('.prev-$(date -u');
    expect(s.indexOf('mv "$HOME_DIR" "$prev"')).toBeLessThan(s.indexOf('cp -Rp "$STAGING/." "$HOME_DIR/"'));
    expect(s).not.toMatch(/rm -rf "\$HOME_DIR"|rm -rf "\$prev"/);
  });
});
