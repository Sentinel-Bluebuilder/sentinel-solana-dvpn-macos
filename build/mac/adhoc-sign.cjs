// ─── afterPack: ad-hoc sign the .app (no Apple identity, no notarization; owner decision) ───
// electron-builder signs nothing with `identity: null`. Apple Silicon refuses to run a Mach-O
// with no signature at all, and editing the bundle (Info.plist, resources) breaks Electron's own
// linker signature, so the whole bundle is re-signed ad hoc here, inside-out: every loose Mach-O
// in Resources (dvpnd, v2ray, xray, hysteria2), then the frameworks and helpers (--deep), then
// the app. Only runs on macOS (codesign); verifies the result.
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const MACHO = new Set(['feedfacf', 'cffaedfe', 'feedface', 'cefaedfe', 'cafebabe', 'bebafeca']);

function isMachO(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const b = Buffer.alloc(4);
    return fs.readSync(fd, b, 0, 4, 0) === 4 && MACHO.has(b.toString('hex'));
  } finally {
    fs.closeSync(fd);
  }
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && isMachO(p)) out.push(p);
  }
  return out;
}

const sign = (target, deep) => execFileSync('/usr/bin/codesign', ['--force', ...(deep ? ['--deep'] : []), '--sign', '-', '--timestamp=none', target], { stdio: 'inherit' });

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.platform !== 'darwin') throw new Error('the macOS app must be packaged on a Mac (codesign)');
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const loose = walk(path.join(app, 'Contents', 'Resources', 'resources'));
  for (const f of loose) sign(f, false);
  sign(app, true);
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log(`  • ad-hoc signed ${path.basename(app)} (${loose.length} bundled binaries)`);
};
