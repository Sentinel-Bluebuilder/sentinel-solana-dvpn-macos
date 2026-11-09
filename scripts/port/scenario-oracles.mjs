// One-time Linux port of the UI scenario driver's oracles (src/main/dev/ui-scenario.ts).
import fs from 'node:fs';

const file = 'src/main/dev/ui-scenario.ts';
let s = fs.readFileSync(file, 'utf8');
const pairs = [
  ['//   egress=node|direct                 system traffic (curl.exe, no proxy) exits there', '//   egress=node|direct                 system traffic (curl, no proxy) exits there'],
  ['//   egress-wininet=node|direct         a WinINET app (PowerShell Invoke-WebRequest)', '//   egress-sysproxy=node|direct        a system-proxy app (headless Chrome reading the GNOME proxy)'],
  ['//   proxy=on|off                       the "Use for Windows apps" checkbox', '//   proxy=on|off                       the "Use for desktop apps" checkbox'],
  ["    execFile(file, args, { timeout: ms, windowsHide: true }, (err, stdout) => resolve(err && !stdout ? '' : String(stdout).trim()));", "    execFile(file, args, { timeout: ms, env }, (err, stdout) => resolve(err && !stdout ? '' : String(stdout).trim()));"],
  ['function run(file: string, args: string[], ms = 20_000): Promise<string> {', 'function run(file: string, args: string[], ms = 20_000, env: NodeJS.ProcessEnv = process.env): Promise<string> {'],
  ["const curl = (extra: string[] = []): Promise<string> => run('curl.exe', ['-s', '-m', '12', ...extra, 'https://api.ipify.org']);", "const curl = (extra: string[] = []): Promise<string> => run('curl', ['-s', '-m', '12', ...extra, 'https://api.ipify.org']);"],
  [
    `const wininet = (): Promise<string> => run('powershell.exe', ['-NoProfile', '-Command', "try { (Invoke-WebRequest -Uri 'https://api.ipify.org' -UseBasicParsing -TimeoutSec 12).Content } catch { 'none' }"]);`,
    `// Chrome on a GNOME session takes its proxy from gsettings (XDG_CURRENT_DESKTOP decides).
const sysproxyApp = async (): Promise<string> => {
  const dom = await run('google-chrome', ['--headless=new', '--disable-gpu', '--no-first-run', \`--user-data-dir=/tmp/ddv-oracle-\${process.pid}\`, '--dump-dom', 'https://api.ipify.org'], 40_000,
    { ...process.env, XDG_CURRENT_DESKTOP: 'GNOME' });
  return /\\b(\\d{1,3}(?:\\.\\d{1,3}){3})\\b/.exec(dom)?.[1] ?? 'none';
};`,
  ],
  [
    `const browserProcs = (): Promise<string> => run('powershell.exe', ['-NoProfile', '-Command', "(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'proxy-server=socks5://127.0.0.1' } | Measure-Object).Count"]);`,
    `const browserProcs = async (): Promise<string> => String((await run('pgrep', ['-f', 'proxy-server=socks5://127.0.0.1'])).split('\\n').filter(Boolean).length);`,
  ],
  ["        case 'egress-wininet': { const ip = await wininet(); ok = ip === want(arg); detail = `WinINET ${ip}, want ${want(arg)}`; break; }", "        case 'egress-sysproxy': case 'egress-wininet': { const ip = await sysproxyApp(); ok = ip === want(arg); detail = `system-proxy app ${ip}, want ${want(arg)}`; break; }"],
];
let bad = 0;
for (const [a, b] of pairs) {
  const n = s.split(a).length - 1;
  if (n !== 1) { console.error(`expected 1 match, found ${n}: ${a.slice(0, 80)}`); bad++; continue; }
  s = s.replace(a, () => b);
}
fs.writeFileSync(file, s);
console.log(bad ? `${bad} failed` : 'ok');
process.exit(bad ? 1 : 0);
