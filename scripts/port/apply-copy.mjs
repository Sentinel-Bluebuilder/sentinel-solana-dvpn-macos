// ─── One-time Linux port: user-facing copy and small references ───
// Every pair must match exactly once, else the script stops (nothing half-applied per file).
import fs from 'node:fs';

const EDITS = {
  'src/cli/catalogue.ts': [
    ["summary: 'Point Windows apps at the session SOCKS proxy.'", "summary: 'Point desktop apps (GNOME/KDE system proxy) at the session SOCKS proxy.'"],
    ["summary: 'WireGuard, AmneziaWG, OpenVPN 2.6 + adapter: ready or missing (no admin).'", "summary: 'WireGuard, AmneziaWG, OpenVPN, nftables, DNS: ready or missing (no admin).'"],
    ['[--dns-mode netsh|none]', '[--dns-mode resolvectl|resolvconf|none]'],
  ],
  'src/cli/commands.ts': [
    ['// Only a live V2Ray/Xray session has a SOCKS endpoint. Pointing Windows at a proxy', '// Only a live V2Ray/Xray session has a SOCKS endpoint. Pointing the desktop at a proxy'],
    ["throw new UsageError('--browser must be edge or chrome')", "throw new UsageError('--browser must be chrome, chromium or edge')"],
    ["o.print(`Opened ${r.browser === 'edge' ? 'Microsoft Edge' : 'Google Chrome'} through SOCKS", 'o.print(`Opened ${BROWSER_TITLES[r.browser]} through SOCKS'],
    ["import { launchBrowser, BROWSERS, type BrowserName } from '../main/system/browser';", "import { launchBrowser, BROWSERS, BROWSER_TITLES, type BrowserName } from '../main/system/browser';"],
    ["confirm(a, o, `Route this Windows user's apps through SOCKS ${ep} until disconnect.`);", "confirm(a, o, `Route this desktop user's apps through SOCKS ${ep} until disconnect.`);"],
  ],
  'src/cli/daemon-cmd.ts': [
    ["if (!v.supported) { o.print('VPN drivers are managed by the Windows app only.', v); return; }", "if (!v.supported) { o.print('VPN drivers cannot be checked on this system.', v); return; }"],
    ["// netsh = set the VPN's DNS on Windows during a session; none = never touch system DNS.", "// resolvectl / resolvconf = set the VPN's DNS during a session; none = never touch system DNS."],
    ["'Install or repair WireGuard, AmneziaWG and OpenVPN 2.6 (one administrator prompt). Drivers already installed are left alone.'", "'Install or repair WireGuard, AmneziaWG, OpenVPN and nftables with apt (one administrator prompt). Tools already installed are left alone.'"],
  ],
  'src/cli/index.ts': [
    ["'Env: DVPN_KEYFILE (use a key file in place), DVPN_DATA_DIR, DVPN_DAEMON_PIPE, DVPN_DAEMON_HOME, DVPN_NO_BRIDGE=1'", "'Env: DVPN_KEYFILE (use a key file in place), DVPN_DATA_DIR, DVPN_DAEMON_SOCKET, DVPN_DAEMON_HOME, DVPN_DAEMON_TARGET=host:port'"],
    ['exiting mid-close trips a libuv assertion on Windows.', 'exiting mid-close can trip a libuv assertion.'],
  ],
  'src/core/quality/socks-check.ts': [
    ['// Before Windows is pointed at a SOCKS proxy, prove the proxy answers on THIS', '// Before the desktop is pointed at a SOCKS proxy, prove the proxy answers on THIS'],
  ],
  'src/main/services/connection.ts': [
    ['could not be removed (${r.detail}). Restart Windows to clear it.`', 'could not be removed (${r.detail}). Restart the computer to clear it.`'],
    ['Restart the "dvpnd" service (or restart Windows), then press Restore network again.', 'Restart it with "sudo systemctl restart dvpnd-client" (or restart the computer), then press Restore network again.'],
    ['packets first: 1-2 s). A page opened in that gap fails and Windows caches the failed DNS', 'packets first: 1-2 s). A page opened in that gap fails and the resolver caches the failed DNS'],
    ['// Every full-tunnel protocol moves the DNS server too; names fail until Windows applies it.', '// Every full-tunnel protocol moves the DNS server too; names fail until the resolver applies it.'],
  ],
  'src/main/scheduler.ts': [
    ["// A proxy session never touches Windows DNS, nor does a daemon set to dns = 'none'.", "// A proxy session never touches system DNS, nor does a daemon set to dns = 'none'."],
  ],
  'src/main/services/net-settle.ts': [
    ['until Windows applied the tunnel\'s DNS server.', 'until the system applied the tunnel\'s DNS server.'],
  ],
  'src/main/dev/ui-smoke.ts': [
    ['/** Call before app ready: Windows occlusion throttling would make capturePage return stale frames. */', '/** Call before app ready: occlusion throttling would make capturePage return stale frames. */'],
  ],
  'src/shared/types.ts': [
    ['proxyActive: boolean; // Windows system proxy currently points at our SOCKS endpoint', 'proxyActive: boolean; // desktop system proxy (GNOME/KDE) currently points at our SOCKS endpoint'],
  ],
  'src/renderer/src/screens/Cli.tsx': [
    ['Open in PowerShell', 'Open in terminal'],
  ],
  'src/renderer/src/screens/Diagnostics.tsx': [
    ["windows: 'Windows (64-bit)', 'deps.json': 'Bundled driver list',", "linux: 'Linux (64-bit)', nftables: 'nftables (kill switch)', resolvectl: 'DNS (systemd-resolved)',"],
    ["setDriverMsg('Waiting for the Windows permission prompt…');", "setDriverMsg('Waiting for the administrator permission prompt…');"],
    ["'Drivers installed. Restart Windows to finish.'", "'Drivers installed. Restart the computer to finish.'"],
  ],
  'src/renderer/src/screens/Home.tsx': [
    ['Use for Windows apps (system proxy)', 'Use for desktop apps (system proxy)'],
  ],
  'src/renderer/src/screens/Onboarding.tsx': [
    ['The key is encrypted with Windows (DPAPI) and stays on this computer.', 'The key is encrypted with your desktop keyring and stays on this computer.'],
    ['It is read here and encrypted with Windows; it is not copied anywhere.', 'It is read here and encrypted with your desktop keyring; it is not copied anywhere.'],
    ['Windows asks for administrator permission once.', 'Your system asks for your password once (administrator permission).'],
    ["'Waiting for Windows…'", "'Waiting for permission…'"],
  ],
  'src/renderer/src/screens/Settings.tsx': [
    ['On Windows the local network DNS server also sees the names you look up. Needed for split tunnelling.', 'Needed for split tunnelling.'],
    [' On Windows it works with Hysteria2, V2Ray and Xray servers only for now.', ''],
    [' On Windows: Hysteria2, V2Ray and Xray servers only for now.', ''],
    ['<Row label="Start with Windows">', '<Row label="Start when I log in">'],
    ["'Off: Windows keeps its own DNS servers during a session.", "'Off: your system keeps its own DNS servers during a session."],
  ],
  'src/renderer/src/screens/Wallet.tsx': [
    ['subtitle="Your keys stay on this computer, encrypted by Windows."', 'subtitle="Your keys stay on this computer, encrypted by your desktop keyring."'],
  ],
};

let bad = 0;
for (const [file, pairs] of Object.entries(EDITS)) {
  let s = fs.readFileSync(file, 'utf8');
  for (const [a, b] of pairs) {
    const n = s.split(a).length - 1;
    if (n !== 1) { console.error(`${file}: expected 1 match, found ${n}: ${a.slice(0, 90)}`); bad++; continue; }
    s = s.replace(a, () => b);
  }
  fs.writeFileSync(file, s);
}
console.log(bad ? `${bad} edits did not match` : 'all copy edits applied');
process.exit(bad ? 1 : 0);
