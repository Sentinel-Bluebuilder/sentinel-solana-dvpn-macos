// ─── Runtime bootstrap shared by the desktop app and the CLI ───
import { installDnsPin, setPinFile } from '../core/net/dns-pin';
import path from 'node:path';
import os from 'node:os';
import { setHost, type Host } from './host';
import { initLogger } from './logger';
import { initStore } from './store';
import { loadSettings } from './system/settings';
import { loadNodeCache } from './services/nodes';

export const APP_DIR_NAME = 'Devnet dVPN';

/** ~/Library/Application Support/Devnet dVPN (same as Electron's userData) unless DVPN_DATA_DIR says otherwise (tests). */
export function defaultDataDir(): string {
  if (process.env.DVPN_DATA_DIR) return process.env.DVPN_DATA_DIR;
  return path.join(os.homedir(), 'Library', 'Application Support', APP_DIR_NAME);
}

export function initRuntime(host: Host): void {
  setHost(host);
  installDnsPin(); // RPC hosts answer from their last addresses while a held kill switch blocks DNS (gap #67)
  setPinFile(path.join(host.dataDir, 'rpc-pin.json')); // post-release F-C4-1: the pin outlives the process, so the CLI works under a held kill switch
  initStore(host.dataDir);
  initLogger(path.join(host.dataDir, 'logs'));
  loadSettings();
  loadNodeCache();
}
