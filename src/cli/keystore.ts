// ─── CLI key store — macOS ───
// DVPN_KEYFILE (or --keyfile) points at a solana-keygen JSON that is used in place and never
// copied — how tests use the devnet wallet. Otherwise the key is kept in the user's login Keychain
// as a generic password (service `devnet-dvpn`, account `cli-wallet:<data dir>`) through
// /usr/bin/security. The secret never goes on a command line (visible in `ps`): it is written to
// `security -i` on stdin, hex-encoded (-X). <data>/wallet.cli.keyring is only a marker (no
// secret in it) so `exists` needs no Keychain round trip.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Keypair } from '@solana/web3.js';
import { keypairFromInput, keypairToJson } from '../core/wallet/keys';
import type { KeyStore } from '../main/host';

const SECURITY = '/usr/bin/security';
export const KEYCHAIN_SERVICE = 'devnet-dvpn';
const LABEL = 'Devnet dVPN CLI wallet';

/** The Keychain account that names this data folder's wallet (exported for tests). */
export function keychainAccount(dataDir: string): string {
  return `cli-wallet:${path.resolve(dataDir)}`;
}

/** One `security -i` line; values are double-quoted, and our values never hold a quote or newline (exported for tests). */
export function securityLine(args: string[]): string {
  for (const a of args) if (/["\n\r\\]/.test(a)) throw new Error('refusing a Keychain argument with a quote or newline');
  return args.map((a) => (/^[A-Za-z0-9_:/.,@+-]+$/.test(a) ? a : `"${a}"`)).join(' ') + '\n';
}

/** The add command for `security -i`: the secret as hex (-X), -U replaces an old item (exported for tests). */
export function addCommand(dataDir: string, secret: string): string {
  return securityLine(['add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', keychainAccount(dataDir), '-l', LABEL, '-X', Buffer.from(secret, 'utf8').toString('hex')]);
}

/** Map a `security` failure to something a person can act on (exported for tests). */
export function keyringError(raw: string): Error {
  if (/ENOENT|not found|No such file/i.test(raw) && !/could not be found in the keychain/i.test(raw)) {
    return new Error('The macOS security tool is missing. Use a key file instead: --keyfile <path> or DVPN_KEYFILE.');
  }
  if (/User interaction is not allowed|interaction|locked|-25308|-25293/i.test(raw)) {
    return new Error('The login Keychain is locked in this session (for example an SSH login). Unlock it (security unlock-keychain), or use a key file: --keyfile <path> or DVPN_KEYFILE.');
  }
  return new Error(`The Keychain could not store or read the wallet: ${raw.split('\n')[0]}`);
}

function security(args: string[], input?: string): string {
  try {
    return execFileSync(SECURITY, args, { input, encoding: 'utf8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    const e = err as { stderr?: unknown; stdout?: unknown; code?: string; status?: number; message: string };
    // find of a missing item exits 44 ("could not be found"): not an error for the caller.
    if (args[0] === 'find-generic-password' && e.status === 44) return '';
    if (args[0] === 'delete-generic-password' && e.status === 44) return '';
    throw keyringError(e.code === 'ENOENT' ? 'ENOENT' : String(e.stderr ?? '') || String(e.stdout ?? '') || e.message);
  }
}

function lookup(dataDir: string): string {
  return security(['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', keychainAccount(dataDir), '-w']).trim();
}

export function cliKeyStore(dataDir: string, keyfile?: string): KeyStore {
  if (keyfile) {
    return {
      kind: 'keyfile',
      exists: () => fs.existsSync(keyfile),
      load: (): Keypair | null => (fs.existsSync(keyfile) ? keypairFromInput(fs.readFileSync(keyfile, 'utf8')) : null),
      save() { throw new Error('A --keyfile wallet is read-only. Unset DVPN_KEYFILE to import or create a wallet.'); },
      remove() { throw new Error('A --keyfile wallet is never deleted by this CLI.'); },
    };
  }
  const marker = path.join(dataDir, 'wallet.cli.keyring');
  return {
    // Not 'keyfile': vault.ts skips its "never replace a wallet" check only for a read-only key
    // file, and this store CAN be overwritten (Windows VM sweep 2026-10-21).
    kind: 'keyring',
    exists: () => fs.existsSync(marker),
    load(): Keypair | null {
      if (!fs.existsSync(marker)) return null;
      const json = lookup(dataDir);
      if (!json) throw new Error('The wallet is missing from the Keychain (it was removed outside this app). Import it again, or use a key file.');
      return keypairFromInput(json);
    },
    save(kp) {
      const secret = keypairToJson(kp);
      // `security -i` reads commands from stdin; it prints errors but exits 0, so read back.
      security(['-i'], addCommand(dataDir, secret));
      if (lookup(dataDir) !== secret.trim()) throw new Error('The Keychain did not keep the wallet (is the login Keychain unlocked?). Nothing was saved.');
      fs.writeFileSync(marker, JSON.stringify({ store: 'macos-keychain', service: KEYCHAIN_SERVICE, label: LABEL, at: new Date().toISOString() }) + '\n', { encoding: 'utf8', mode: 0o600 });
    },
    remove() {
      if (fs.existsSync(marker)) security(['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', keychainAccount(dataDir)]);
      fs.rmSync(marker, { force: true });
    },
  };
}
