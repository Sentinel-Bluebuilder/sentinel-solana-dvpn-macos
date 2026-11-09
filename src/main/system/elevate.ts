// ─── One administrator prompt per privileged step (D4, F1.5) — macOS ───
// Every privileged step goes through ONE bundled entry point, resources/scripts/dvpn-helper,
// which runs only our own whitelisted scripts under Apple's /bin/bash. Only file paths and
// validated tokens go on the command line, never config text (M5.3 #8). The step reports through
// a JSON result file in a folder this user created.
//   already root            → run the helper directly
//   `sudo -n` allowed        → sudo -n (SSH sessions, CI, the test rig)
//   otherwise               → osascript `do shell script … with administrator privileges`: the
//                             system password prompt, with our own message. The shell command is
//                             built here from validated arguments, each single-quoted.
// After setup the helper runs from the root-owned copy in /usr/local/lib/devnet-dvpn/scripts (the
// app bundle may be writable by the user); setup-daemon itself always runs from the bundle so a
// new app version installs its new scripts.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { log } from '../logger';

const SAFE_ARG = /^[A-Za-z0-9 _.:/,@+-]+$/;
export const HELPER_STEPS = ['setup-daemon', 'apply-daemon-config', 'remove-tunnels', 'install-deps', 'uninstall-cleanup', 'service-ctl'] as const;
export type HelperStep = typeof HELPER_STEPS[number];
/** Root-owned copy of the helper scripts, installed by setup-daemon.sh. */
export const ROOT_SCRIPTS_DIR = '/Library/devnet-dvpn/scripts';
/** The text of the system password prompt. */
export const PROMPT_TEXT = 'Devnet dVPN needs an administrator to change the VPN service or network settings.';

export interface ElevatedResult { status: 'ok' | 'error' | 'cancelled'; detail: string; [k: string]: unknown }

/** The helper's arguments: step name, then --Key value pairs (exported for tests). */
export function helperArgs(step: string, args: Record<string, string>): string[] {
  if (!(HELPER_STEPS as readonly string[]).includes(step)) throw new Error(`unknown elevated step ${step}`); // copy:internal
  const out: string[] = [step];
  for (const [k, v] of Object.entries(args)) {
    if (!/^[A-Za-z]+$/.test(k)) throw new Error(`bad parameter name ${k}`); // copy:internal
    if (!SAFE_ARG.test(v) || v.startsWith('-')) throw new Error(`refusing unsafe argument for elevated step: ${v}`); // copy:internal
    out.push(`--${k}`, v);
  }
  return out;
}

/** One argument for `do shell script`: single-quoted (SAFE_ARG has no quote, but escape anyway). */
export const shQuote = (v: string): string => `'${v.replace(/'/g, `'\\''`)}'`;

/** The shell command osascript runs as root (exported for tests). */
export function adminCommand(helper: string, argv: string[]): string {
  return ['/bin/bash', helper, ...argv].map(shQuote).join(' ');
}

/** osascript argv: the command and prompt go in as run-handler arguments, never spliced into AppleScript. */
export function osascriptArgs(command: string, prompt = PROMPT_TEXT): string[] {
  return [
    '-e', 'on run argv',
    '-e', 'do shell script (item 1 of argv) with prompt (item 2 of argv) with administrator privileges',
    '-e', 'end run',
    command, prompt,
  ];
}

export type Elevator = 'root' | 'sudo' | 'osascript';

let cached: Elevator | null = null;
/** How this process gets root for a step. Exported for tests (`setElevator`). */
export function elevator(): Promise<Elevator> {
  if (cached) return Promise.resolve(cached);
  if (typeof process.getuid === 'function' && process.getuid() === 0) return Promise.resolve((cached = 'root'));
  // Rig proof of the password prompt: the rig user has passwordless sudo, so only this makes the
  // GUI path run there. It can only pick the path that ASKS; it never skips a prompt.
  if (process.env.DVPN_ELEVATOR === 'osascript') return Promise.resolve((cached = 'osascript'));
  return new Promise((resolve) => {
    execFile('sudo', ['-n', 'true'], { timeout: 5_000 }, (err) => resolve((cached = err ? 'osascript' : 'sudo')));
  });
}
export function setElevator(e: Elevator | null): void {
  cached = e;
}

/** The step name for a script path (scripts are <step>.sh next to dvpn-helper). */
export function stepOf(script: string): string {
  return path.basename(script).replace(/\.sh$/, '');
}

/** Which helper to run: the root-owned copy when it exists, except for setup (exported for tests). */
export function helperFor(step: string, bundledScriptsDir: string, rootCopyExists = fs.existsSync(path.join(ROOT_SCRIPTS_DIR, 'dvpn-helper'))): string {
  if (step !== 'setup-daemon' && rootCopyExists) return path.join(ROOT_SCRIPTS_DIR, 'dvpn-helper');
  return path.join(bundledScriptsDir, 'dvpn-helper');
}

/** osascript says "User canceled. (-128)" when the password prompt is dismissed (exported for tests). */
export const promptCancelled = (stderr: string): boolean => /\(-128\)|user cancel/i.test(stderr);

/**
 * What to report when the step wrote no result file. A step cut off by our time limit is not a
 * declined prompt: saying so sent a user hunting for a prompt that never existed (the Windows app 54b8ca4).
 * Exported for tests.
 */
export function noResultOutcome(timedOut: boolean, timeoutMs: number, cancelled = false, stderrText = ''): ElevatedResult {
  if (timedOut) return { status: 'error', detail: `The admin step did not finish within ${Math.round(timeoutMs / 1000)} s. Try again; a first-time driver setup can be slow.` };
  if (cancelled) return { status: 'cancelled', detail: 'The administrator permission prompt was declined or closed.' };
  const last = stderrText.trim().split('\n').pop();
  return { status: 'error', detail: `The administrator step did not finish${last ? `: ${last}` : '.'}` };
}

/** Run a helper step as root with named args; resolves with its result JSON. */
/**
 * How long an admin step may take. 120 s by default; a slow test VM sets DVPN_ELEVATE_TIMEOUT_MS
 * (10 s – 15 min), as on Windows (the Windows app 57dbc608).
 */
export function elevateTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const v = Number(env.DVPN_ELEVATE_TIMEOUT_MS);
  return Number.isFinite(v) && v >= 10_000 && v <= 900_000 ? Math.round(v) : 120_000;
}

/**
 * L6: a step cut off by our time limit may still have finished its work (the helper keeps running
 * with admin rights after we kill the launcher). `verify` checks the real outcome; when it returns a
 * result, that replaces the timeout error. Exported for tests.
 */
export async function settleTimedOut(r: ElevatedResult, timedOut: boolean, verify?: () => Promise<ElevatedResult | null>): Promise<ElevatedResult> {
  if (!timedOut || r.status !== 'error' || !verify) return r;
  try {
    return (await verify()) ?? r;
  } catch (err) {
    log.warn('post-timeout verification failed', { err: String(err) });
    return r;
  }
}

export async function runElevated(script: string, args: Record<string, string>, timeoutMs = elevateTimeoutMs(), verify?: () => Promise<ElevatedResult | null>): Promise<ElevatedResult> {
  const step = stepOf(script);
  const helper = helperFor(step, path.dirname(script));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devnet-dvpn-'));
  const result = path.join(dir, 'result.json');
  const argv = helperArgs(step, { ...args, Result: result });
  const how = await elevator();
  const [cmd, cmdArgs] = how === 'root' ? ['/bin/bash', [helper, ...argv]]
    : how === 'sudo' ? ['sudo', ['-n', '/bin/bash', helper, ...argv]]
      : ['/usr/bin/osascript', osascriptArgs(adminCommand(helper, argv))];
  log.info('elevated step', { step, via: how, helper });
  let stderrText = '';
  let timedOut = false;
  await new Promise<void>((resolve) => {
    execFile(cmd, cmdArgs, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, _stdout, stderr) => {
      stderrText = String(stderr);
      if (err) {
        timedOut = Boolean((err as { killed?: boolean }).killed);
        log.warn('elevated step returned an error', { timedOut, timeoutMs, code: (err as NodeJS.ErrnoException).code, stderr: stderrText.slice(0, 400) });
      }
      resolve();
    });
  });
  try {
    if (!fs.existsSync(result)) return await settleTimedOut(noResultOutcome(timedOut, timeoutMs, how === 'osascript' && promptCancelled(stderrText), stderrText), timedOut, verify);
    return JSON.parse(fs.readFileSync(result, 'utf8')) as ElevatedResult;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
