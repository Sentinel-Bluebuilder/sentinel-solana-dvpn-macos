# macOS packages — Devnet dVPN

One build (`npm run release:mac`, on a Mac) makes a **.dmg** (drag to Applications) and a
**.zip** (scripted installs), each for **x64** and **arm64**. Ad-hoc signed, not notarized
(owner decision). The Windows installer is the Windows app's `docs/INSTALLER.md`; Linux is the Linux app's.

## What the user gets

| | |
|---|---|
| App | `/Applications/Devnet dVPN.app` |
| CLI | `/usr/local/bin/devnet-dvpn` → `Devnet dVPN.app/Contents/Resources/bin/devnet-dvpn` (made by the service setup; the app's CLI screen → "Open in Terminal" works before that) |
| Root helper | ONE entry point `resources/scripts/dvpn-helper` (whitelist `HELPER_STEPS`), run through `osascript … with administrator privileges`; after setup the root-owned copy in `/usr/local/lib/devnet-dvpn/scripts` is used |
| VPN drivers | Diagnostics → Repair drivers (or `daemon repair-drivers --yes`): Homebrew, **as the Mac user**, installs `wireguard-tools wireguard-go openvpn bash go`; AmneziaWG is built from pinned source (`amneziawg-tools` / `amneziawg-go` v3.1.20260812, same generation as the nodes). Root then copies them into `/usr/local/lib/devnet-dvpn/tools` |
| Service | first run: device setup, then ONE admin prompt writes `/Library/LaunchDaemons/network.sentinel.devnet-dvpn.dvpnd.plist` |

The VPN service (`dvpnd`, client role, root) is installed by the app's first run, not by the
package: dvpnd will not start until its device key holds an on-chain permission, which needs
the user's wallet. A .dmg has no install hooks, so everything root needs happens in that one
prompt (`setup-daemon.sh`):

1. group `dvpn` (`dseditgroup`), the user added to it;
2. the staged home copied to `/var/db/dvpnd/client`, key folders `root:wheel 0700`, `device.pub`
   world-readable, an inherited ACL for the user so the socket dvpnd re-creates stays reachable;
3. root-owned copies of dvpnd, V2Ray, Xray, Hysteria2, the Homebrew tools and the helper scripts
   in `/usr/local/lib/devnet-dvpn` (quarantine removed). **Root never executes anything from the
   app bundle or the user-writable Homebrew prefix**; `wg-quick`/`awg-quick` run under the
   copied bash 5 (`#!/usr/local/lib/devnet-dvpn/tools/bash`);
4. the LaunchDaemon (KeepAlive, `ThrottleInterval` 60 s so a device without its grant does not
   burn RPC calls), PATH = only those root-owned folders;
5. the `/usr/local/bin/devnet-dvpn` link.

## Update

Drag the new app over the old one. The running service keeps its root-owned copies, so the app
compares them with what it ships (`serviceStaleFiles()`: dvpnd, protocol binaries, helper
scripts). When they differ, Diagnostics → Service check shows **Service version !** with
**Update the VPN service** (one prompt; re-runs setup over the kept home, which also renames old
dvpnd config keys with `migrate-daemon-config.sh`). CLI: `devnet-dvpn daemon doctor` shows the
same row; `devnet-dvpn daemon install --yes` updates.

## Uninstall

Diagnostics → **Remove the VPN service** or `devnet-dvpn daemon uninstall --yes`
(`uninstall-cleanup.sh`, one prompt), then drag the app to the Trash:

- the SOCKS system proxy put back on every network service, only where ours is still set;
- the service stopped (a clean stop ends the session and releases the pf kill switch and DNS),
  the LaunchDaemon removed;
- `remove-tunnels.sh` for anything a dead session left: our protocol processes, wg-quick utun
  links, the `dvpnd` pf anchor + its enable token, DNS from dvpnd's networksetup backup.
  **Never** `pfctl -F all` or `pfctl -d`: the user's own pf rules stay;
- `/usr/local/lib/devnet-dvpn` and the CLI link removed.

Kept on purpose: `/var/db/dvpnd/client` (the device key holds an on-chain permission and SOL;
a reinstall picks it up) and the `dvpn` group (the kept home is owned by it). Homebrew packages
stay (they are the user's).

## Dependencies are pinned and verified

`build/deps.lock.json` pins Hysteria2, V2Ray and Xray (darwin amd64 + arm64) by version, URL and
SHA-256, checked against each publisher's own digest file. `scripts/fetch-deps.mjs --arch
x64|arm64` refuses a mismatch, extracts only the listed files and copies `dvpnd` from the darwin
build (`cf4c372-rc`, sha pinned per arch). `resources/bin` holds one arch at a time;
`release-mac.mjs` fetches and packages each arch in turn.

## Signing

`identity: null` (electron-builder signs nothing), then `build/mac/adhoc-sign.cjs` (afterPack)
signs every loose Mach-O in `Contents/Resources/resources` and the bundle ad hoc and verifies
it: Apple Silicon refuses code with no signature. Gatekeeper still warns on first open
(right-click → Open). Notarization needs an Apple Developer ID: owner decision.

## CLI shim

`Contents/Resources/bin/devnet-dvpn` (bash) follows its own symlink chain without
`readlink -f` (missing before macOS 13) and runs the bundled CLI on the app's own runtime
(`ELECTRON_RUN_AS_NODE=1 "Contents/MacOS/Devnet dVPN" Contents/Resources/app.asar/out/cli/devnet-dvpn.cjs`),
the pattern of VS Code's `code`. If the app was moved it says so (exit 127).

## Packaging rule: main and CLI are self-contained bundles

Same as the Windows app: the main process and the CLI bundle every runtime dependency (electron-builder 25
re-nests deduplicated npm packages and drops some).

## Build

```bash
npm run release:mac                    # typecheck → tests → build → CLI → per arch: fetch-deps + electron-builder → SHA256SUMS
node scripts/release-mac.mjs --skip-tests --arch x64
```

Output: `dist/Devnet-dVPN-<version>-{x64,arm64}.dmg`, `dist/Devnet-dVPN-<version>-{x64,arm64}-mac.zip`,
`dist/SHA256SUMS.txt`. Build on a Mac (the guest: `bash scripts/e2e/mac/sync.sh`).

## Proof — `test-host` (macOS Sonoma x86_64 in QEMU on GCP)

Pending: `scripts/e2e/mac/installer-test.sh` (install + first run → update over a running
service → uninstall → reinstall keeps the device). Results land in `docs/evidence/mac/`.
The arm64 packages are built but not run (no Apple Silicon rig): `MAC-PARITY.md` marks them open.
