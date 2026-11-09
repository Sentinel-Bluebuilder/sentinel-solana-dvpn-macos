// ─── release:mac — build the .dmg + .zip (x64 + arm64) from a clean, verified state ───
// Runs ON A MAC (codesign, hdiutil). Each architecture bundles its own dvpnd + protocol binaries,
// so the two are built one after the other with the matching deps fetched in between:
// 1. typecheck + unit tests   2. app + CLI bundles   3. per arch: fetch + verify deps
// (build/deps.lock.json), electron-builder --mac --<arch>   4. dist/SHA256SUMS.txt
// Usage: node scripts/release-mac.mjs [--skip-tests] [--offline] [--arch x64|arm64]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const run = (cmd, a) => { console.log(`\n> ${cmd} ${a.join(' ')}`); execFileSync(cmd, a, { stdio: 'inherit' }); };

if (process.platform !== 'darwin') throw new Error('release:mac runs on macOS only (codesign, hdiutil)');
const arches = flag('--arch') ? [flag('--arch')] : ['x64', 'arm64'];
for (const a of arches) if (!['x64', 'arm64'].includes(a)) throw new Error(`unknown arch ${a}`);

run('node', ['scripts/check-release-version.mjs', ...(args.includes('--allow-same-version') ? ['--allow-same-version'] : [])]); // L3
if (!args.includes('--skip-tests')) { run('npm', ['run', 'typecheck']); run('npm', ['test']); }
run('npx', ['electron-vite', 'build']);
run('node', ['scripts/build-cli.mjs']);
fs.chmodSync('build/cli/devnet-dvpn', 0o755);

for (const arch of arches) {
  fs.rmSync('resources/bin', { recursive: true, force: true });
  run('node', ['scripts/fetch-deps.mjs', '--arch', arch, ...(args.includes('--offline') ? ['--offline'] : [])]);
  for (const f of fs.readdirSync('resources/scripts')) fs.chmodSync(path.join('resources/scripts', f), 0o755);
  run('npx', ['electron-builder', '--mac', `--${arch}`, '--publish', 'never']);
  checkArch(arch);
  scanSecrets(arch);
}

// Build checklist: a shipped RPC endpoint must never carry an inline api-key. The installer writes no
// key (the default is the public devnet RPC, src/core/chain/rpc.ts DEFAULT_RPC_URLS); our test rigs
// inject their lane URL only at setup time. Fail the build if a key ever leaks into the payload — this
// catches a baked default in a bundled config OR the daemon binary (-a scans binaries as text too).
function scanSecrets(arch) {
  const app = path.join('dist', arch === 'x64' ? 'mac' : 'mac-arm64', 'Devnet dVPN.app');
  let out = '';
  try {
    out = execFileSync('grep', ['-rIaE', 'api[_-]?key[=:]', app], { encoding: 'utf8' });
  } catch (e) {
    if (e.status === 1) { console.log(`ok   ${arch} app payload carries no inline api-key`); return; }
    throw e;
  }
  const redacted = out.replace(/(api[_-]?key[=:])[^"'\s&]+/gi, '$1<REDACTED>').split('\n').slice(0, 10).join('\n');
  throw new Error(`SECRET LEAK: inline api-key in the ${arch} app payload (the installer must ship no RPC key):\n${redacted}`);
}

// Every Mach-O we ship in this arch's app must be that arch (an x64 package once carried arm64
// VPN binaries because both arches were rebuilt in each pass).
function checkArch(arch) {
  const want = arch === 'x64' ? 'x86_64' : 'arm64';
  const app = path.join('dist', arch === 'x64' ? 'mac' : 'mac-arm64', 'Devnet dVPN.app');
  const bins = [path.join(app, 'Contents', 'MacOS', 'Devnet dVPN')];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.isFile() && (fs.statSync(p).mode & 0o111)) bins.push(p); } };
  walk(path.join(app, 'Contents', 'Resources', 'resources', 'bin'));
  for (const b of bins) {
    const got = execFileSync('lipo', ['-archs', b], { encoding: 'utf8' }).trim();
    if (got !== want) throw new Error(`${b} is ${got}, the ${arch} package needs ${want}`);
  }
  console.log(`ok   ${bins.length} executables in the ${arch} app are ${want}`);
}

const pkgs = fs.readdirSync('dist').filter((f) => /\.(dmg|zip)$/.test(f));
const sums = pkgs.map((f) => `${createHash('sha256').update(fs.readFileSync(path.join('dist', f))).digest('hex')}  ${f}`);
fs.writeFileSync('dist/SHA256SUMS.txt', sums.join('\n') + '\n');
console.log(`\n${sums.join('\n')}`);
