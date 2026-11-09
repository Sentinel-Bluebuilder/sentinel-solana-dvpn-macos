// ─── safeStorage KeyStore (desktop app) — macOS ───
// Ported from sentinel-node-manager-solana services/wallet.ts: refuse to store the key when the
// OS cannot encrypt it. On macOS, safeStorage encrypts with a per-app key kept in the user's login
// Keychain ("Devnet dVPN Safe Storage"), so isEncryptionAvailable() is the whole test. The Linux
// 'basic_text' fallback (a fixed, public key) does not exist here; it is still refused if seen.
import { safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { Keypair } from '@solana/web3.js';
import { keypairFromInput, keypairToJson } from '../../core/wallet/keys';
import type { KeyStore } from '../host';
import { log } from '../logger';

/** Linux backends that really encrypt (kept for the shared test); macOS has no backend choice. */
export const STRONG_BACKENDS = ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'];

/** macOS: any backend except Linux's 'basic_text' (exported for tests). */
export function backendIsStrong(backend: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform === 'darwin') return backend !== 'basic_text';
  return STRONG_BACKENDS.includes(backend);
}

export function safeStorageKeyStore(dataDir: string): KeyStore {
  const file = path.join(dataDir, 'wallet.secret');
  const requireEncryption = (): void => {
    const backend = typeof safeStorage.getSelectedStorageBackend === 'function' ? safeStorage.getSelectedStorageBackend() : 'unknown';
    if (!safeStorage.isEncryptionAvailable() || !backendIsStrong(backend)) {
      log.warn('wallet: no strong key storage', { backend });
      throw new Error('This Mac could not give the app a Keychain key to protect your wallet. Sign in to your Mac user account (not only over SSH) and try again.');
    }
  };
  return {
    kind: 'safeStorage',
    exists: () => fs.existsSync(file),
    load(): Keypair | null {
      if (!fs.existsSync(file)) return null;
      requireEncryption();
      try {
        return keypairFromInput(safeStorage.decryptString(fs.readFileSync(file)));
      } catch (err) {
        log.error('wallet: stored key could not be decrypted', err);
        throw new Error('Your stored wallet could not be unlocked with this account\'s Keychain.');
      }
    },
    save(kp) {
      requireEncryption();
      fs.writeFileSync(file, safeStorage.encryptString(keypairToJson(kp)), { mode: 0o600 });
    },
    remove() {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    },
  };
}
