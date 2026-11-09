// ─── App list for split tunnelling (pure: merge, clean, sort, search) ───
// Sources (src/main/system/apps.ts): on macOS the .app bundles in /Applications (+ Utilities,
// /System/Applications, ~/Applications) resolved to their executable, and running bundle
// executables; on Windows Start Menu shortcuts and running windowed programs. dvpnd [split] apps
// need full executable paths and match by path AND by program name, case-sensitive on the path
// (docs/SPLIT-TUNNEL-CONTRACT.md).

export interface AppEntry {
  path: string;      // full executable path (macOS: …/X.app/Contents/MacOS/X; Windows: .exe), case-sensitive
  name: string;      // display name (shortcut name, or the window's product/file name)
  running: boolean;  // a process with this path is running now
  source: 'start-menu' | 'running' | 'picked';
}

export interface RawShortcut { name: string; target: string }
export interface RawProcess { name: string; path: string; title?: string }

/** Shortcuts that are not apps a person would choose. */
const SKIP_NAME = /\b(uninstall|uninst|remove|setup|installer|update(r)?|readme|help|license|release notes|documentation|website)\b/i;
// Windows Installer "advertised" shortcuts point at an icon stub under ...\Microsoft\Installer\{GUID}\, not the app.
const SKIP_PATH = /\\(windows\\system32|windows\\syswow64|windows\\explorer\.exe|windowsapps|microsoft\\installer)\\?/i;
const SKIP_EXE = /^(unins\d*|uninstall|setup|update|updater|crashpad_handler|crashreporter|helper)(\.exe)?$/i;
// macOS: helper apps nested inside another bundle, and system agents, are not apps a person picks.
const SKIP_MAC = /\.app\/Contents\/(Frameworks|Helpers|Library|PlugIns|XPCServices|Resources)\/|\/(CoreServices|PrivateFrameworks)\//;

export const fileName = (p: string): string => p.split(/[\\/]/).pop() ?? p;
const key = (p: string): string => p.toLowerCase();

/** A macOS app's main executable: /…/Name.app/Contents/MacOS/<exe>, not one nested in another bundle. */
export function isMacBundleExe(p: string): boolean {
  return /^\/.+\.app\/Contents\/MacOS\/[^/]+$/.test(p) && !SKIP_MAC.test(p) && !/\.app\/.+\.app\//.test(p);
}

// macOS apps whose pages load in shared system WebKit processes (not children of the app), so a
// split by app cannot catch their traffic. Mullvad and Proton document the same limit.
const MAC_UNSPLITTABLE = /\/Safari( Technology Preview)?\.app\/Contents\/MacOS\/[^/]+$/;
export const SAFARI_SPLIT_COPY = 'Safari can’t be chosen: its pages load in shared system processes. Use address ranges, or a browser like Chrome or Firefox.';

/** Why this app cannot be split by app (null = it can). */
export function unsplittableReason(p: string): string | null {
  return MAC_UNSPLITTABLE.test(p) ? SAFARI_SPLIT_COPY : null;
}

/** True when `p` is something dvpnd will accept in [split] apps (Windows .exe, or a macOS bundle executable). */
export function isChoosableExe(p: string): boolean {
  if (/['"\n\r]/.test(p)) return false;
  if (/^[A-Za-z]:[\\/]|^\\\\/.test(p)) return /\.exe$/i.test(p);
  return isMacBundleExe(p);
}

/** The executable dvpnd matches for a bundle, from its Info.plist CFBundleExecutable. */
export function bundleExecutable(appPath: string, cfBundleExecutable: string): string | null {
  const exe = cfBundleExecutable.trim();
  if (!/\.app\/?$/.test(appPath) || !exe || exe.includes('/')) return null;
  return `${appPath.replace(/\/$/, '')}/Contents/MacOS/${exe}`;
}

/** Display name of a bundle executable: the bundle's folder name without .app. */
export function bundleName(exePath: string): string {
  const m = /([^/]+)\.app\/Contents\/MacOS\/[^/]+$/.exec(exePath);
  return m ? m[1] : fileName(exePath);
}

/** What a person calls the app: the bundle name on macOS, the file name without .exe on Windows. */
export const displayName = (p: string): string => (p.startsWith('/') ? bundleName(p) : fileName(p).replace(/\.exe$/i, ''));

/** Microsoft Store apps live under WindowsApps; dvpnd can't match them (Mullvad has the same limit). */
export function isStoreApp(p: string): boolean {
  return /\\WindowsApps\\/i.test(p);
}

export function mergeApps(shortcuts: RawShortcut[], procs: RawProcess[], picked: string[] = []): AppEntry[] {
  const out = new Map<string, AppEntry>();
  const running = new Set(procs.map((p) => key(p.path)));
  for (const s of shortcuts) {
    if (!isChoosableExe(s.target) || SKIP_NAME.test(s.name) || SKIP_PATH.test(s.target) || SKIP_EXE.test(fileName(s.target))) continue;
    const k = key(s.target);
    const prev = out.get(k);
    // Several shortcuts can point at one exe: keep the shortest name ("Firefox" over "Firefox Private Browsing").
    if (!prev || s.name.length < prev.name.length) out.set(k, { path: s.target, name: s.name.trim(), running: running.has(k), source: 'start-menu' });
  }
  for (const p of procs) {
    if (!isChoosableExe(p.path) || SKIP_PATH.test(p.path) || SKIP_EXE.test(fileName(p.path))) continue;
    const k = key(p.path);
    if (!out.has(k)) out.set(k, { path: p.path, name: p.name || displayName(p.path), running: true, source: 'running' });
  }
  for (const p of picked) {
    if (!isChoosableExe(p)) continue;
    const k = key(p);
    if (!out.has(k)) out.set(k, { path: p, name: displayName(p), running: running.has(k), source: 'picked' });
  }
  return [...out.values()].sort((a, b) => Number(b.running) - Number(a.running) || a.name.localeCompare(b.name));
}

/** Search by display name, file name or folder (case-insensitive). */
export function filterApps<T extends AppEntry>(apps: T[], q: string): T[] {
  const t = q.trim().toLowerCase();
  if (!t) return apps;
  return apps.filter((a) => a.name.toLowerCase().includes(t) || a.path.toLowerCase().includes(t));
}

/** Other entries whose program name equals this one's: dvpnd matches them too. */
export function sameNameApps(apps: AppEntry[], path: string): AppEntry[] {
  const n = fileName(path).toLowerCase();
  return apps.filter((a) => a.path !== path && fileName(a.path).toLowerCase() === n);
}

/** One CIDR or IP; a bare IP becomes /32 or /128. Returns null when it is neither. */
export function normalizeRoute(input: string): string | null {
  const s = input.trim();
  const v4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
  const m = s.match(/^([^/]+)(?:\/(\d{1,3}))?$/);
  if (!m) return null;
  const [, ip, bits] = m;
  if (v4.test(ip)) {
    if (bits === undefined) return `${ip}/32`;
    return Number(bits) <= 32 ? `${ip}/${Number(bits)}` : null;
  }
  if (ip.includes(':') && /^[0-9a-fA-F:]+$/.test(ip) && (ip.match(/::/g) ?? []).length <= 1) {
    if (bits === undefined) return `${ip.toLowerCase()}/128`;
    return Number(bits) <= 128 ? `${ip.toLowerCase()}/${Number(bits)}` : null;
  }
  return null;
}
