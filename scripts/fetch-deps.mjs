// ─── fetch-deps — every third-party program the macOS packages ship, pinned, per arch ───
// Reads build/deps.lock.json. For each dependency: download into build/.deps-cache
// (or reuse a cached copy), refuse on any SHA-256 mismatch, then:
//   exe → its `dest`, made executable     (protocol binaries the service finds on its PATH)
//   zip → only the listed `files` into `dest` (`exec` ones made executable)
// Only the entries for ONE architecture are used (resources/bin holds one arch at a time; the
// release script packages x64 and arm64 in two passes). Local binaries (dvpnd) are copied from
// DVPND_DIR/<src> (a local build directory holding the darwin dvpnd builds,
// same commit as the Windows app's dvpnd.exe) and must match their pinned SHA-256. Also writes
// THIRD-PARTY-NOTICES.txt and the package license text.
// Usage: node scripts/fetch-deps.mjs [--arch x64|arm64] [--offline]   (default arch = this machine)
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const LOCK = JSON.parse(fs.readFileSync(path.join(ROOT, 'build', 'deps.lock.json'), 'utf8'));
const CACHE = path.join(ROOT, 'build', '.deps-cache');
const offline = process.argv.includes('--offline');
const DVPND_DIR = process.env.DVPND_DIR || path.join(os.homedir(), 'Desktop', 'devnet-dvpn-dvpnd-devnet', 'build');
const archArg = process.argv.indexOf('--arch');
const ARCH = archArg > 0 ? process.argv[archArg + 1] : process.arch;
if (!['x64', 'arm64'].includes(ARCH)) throw new Error(`--arch must be x64 or arm64 (got ${ARCH})`);
const DEPS = LOCK.deps.filter((d) => d.arch === ARCH);
const LOCAL = LOCK.local.filter((l) => l.arch === ARCH);

const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
/** Copy unless the destination already has the same bytes (a running tunnel locks its exe). */
function copyIfChanged(src, dst) {
  if (fs.existsSync(dst) && sha256(dst) === sha256(src)) return;
  fs.copyFileSync(src, dst);
}

async function download(url, to) {
  if (offline) throw new Error(`offline and not cached: ${url}`);
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'devnet-dvpn-build' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  fs.writeFileSync(`${to}.part`, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(`${to}.part`, to);
}

async function cached(dep) {
  const file = path.join(CACHE, path.basename(new URL(dep.url).pathname));
  if (!fs.existsSync(file) || sha256(file) !== dep.sha256) await download(dep.url, file);
  const got = sha256(file);
  if (got !== dep.sha256) {
    fs.rmSync(file, { force: true });
    throw new Error(`${dep.name}: SHA-256 mismatch (want ${dep.sha256}, got ${got})`);
  }
  return file;
}

function extractZip(zip, dest, files, exec = []) {
  const tmp = fs.mkdtempSync(path.join(CACHE, 'unzip-'));
  try {
    // bsdtar reads zip (Linux: libarchive-tools; Windows 10+: System32\tar.exe).
    const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : (fs.existsSync('/usr/bin/bsdtar') ? 'bsdtar' : 'unzip');
    if (tar === 'unzip') execFileSync('unzip', ['-q', '-o', zip, '-d', tmp], { stdio: 'inherit' });
    else execFileSync(tar, ['-xf', zip, '-C', tmp], { stdio: 'inherit' });
    fs.mkdirSync(dest, { recursive: true });
    for (const f of files) {
      const src = path.join(tmp, f);
      if (!fs.existsSync(src)) throw new Error(`${path.basename(zip)} has no ${f}`);
      copyIfChanged(src, path.join(dest, f));
      fs.chmodSync(path.join(dest, f), exec.includes(f) ? 0o755 : 0o644);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

fs.mkdirSync(CACHE, { recursive: true });
console.log(`arch ${ARCH}`);
for (const dep of DEPS) {
  const file = await cached(dep);
  if (dep.kind === 'exe') {
    const out = path.join(ROOT, dep.dest);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    copyIfChanged(file, out);
    fs.chmodSync(out, 0o755);
  } else if (dep.kind === 'zip') {
    extractZip(file, path.join(ROOT, dep.dest), dep.files, dep.exec ?? []);
  } else {
    throw new Error(`${dep.name}: unknown kind ${dep.kind}`);
  }
  console.log(`ok   ${dep.name} ${dep.version} (${ARCH})`);
}

for (const l of LOCAL) {
  const out = path.join(ROOT, l.path);
  const src = path.join(DVPND_DIR, l.src);
  if (fs.existsSync(src) && (!fs.existsSync(out) || sha256(out) !== l.sha256)) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(src, out);
  }
  if (!fs.existsSync(out)) throw new Error(`missing local binary ${l.path} (${l.note})`);
  // A dvpnd built from a CRLF checkout (this laptop: core.autocrlf=true) embeds CRLF OpenVPN/WireGuard templates.
  if (l.name === 'dvpnd' && fs.readFileSync(out).includes(Buffer.from('persist-tun\r\n'))) {
    throw new Error('dvpnd embeds CRLF config templates: rebuild with scripts/e2e/mac/build-dvpnd.sh (LF archive)');
  }
  const got = sha256(out);
  if (l.sha256 && got !== l.sha256) throw new Error(`${l.name}: SHA-256 mismatch (want ${l.sha256}, got ${got})`);
  fs.chmodSync(out, 0o755);
  console.log(`ok   ${l.name} (local, ${got.slice(0, 12)}…)`);
}

// Xray (MPL-2.0) ships with one added source file for macOS process lookup; the patch itself is
// included below so the modified source is available with the program.
const XRAY_PATCH = path.join(ROOT, 'docs', 'patches', 'xray-0001-darwin-find-process.patch');
const patchedXray = LOCAL.find((l) => l.name === 'xray');
const notices = [
  'Devnet dVPN bundles the following third-party software, unmodified except where noted.',
  'Each is distributed under its own license; source code is available at the links below.',
  '',
  ...(patchedXray ? [
    `Xray 26.3.27 (macOS ${ARCH}) - MODIFIED: adds macOS process lookup (common/net/find_process_darwin.go)`,
    '  License: MPL-2.0 (https://github.com/XTLS/Xray-core/blob/main/LICENSE)',
    '  Source:  https://github.com/XTLS/Xray-core/tree/v26.3.27 plus the patch at the end of this file',
    `  SHA-256: ${patchedXray.sha256}`,
    '',
  ] : []),
  ...DEPS.flatMap((d) => [
    `${d.title} ${d.version} (macOS ${ARCH})${d.name === 'xray' && patchedXray ? ' release archive: geoip.dat and geosite.dat only' : ''}`,
    `  License: ${d.license} (${d.licenseUrl})`,
    `  Source:  ${d.sourceUrl}`,
    `  SHA-256: ${d.sha256}`,
    '',
  ]),
  ...(patchedXray ? ['-'.repeat(72), 'Xray patch (MPL-2.0 modified source):', '', fs.readFileSync(XRAY_PATCH, 'utf8').replace(/\r\n/g, '\n')] : []),
];
fs.writeFileSync(path.join(ROOT, 'build', 'THIRD-PARTY-NOTICES.txt'), notices.join('\n'));
console.log('ok   build/THIRD-PARTY-NOTICES.txt');
const own = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8').replace(/\r\n/g, '\n');
fs.writeFileSync(path.join(ROOT, 'build', 'license.txt'), ['Devnet dVPN', '', own, '', '-'.repeat(72), '', ...notices].join('\n'));
console.log('ok   build/license.txt');
