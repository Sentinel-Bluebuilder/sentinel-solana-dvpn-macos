# macOS parity — Devnet dVPN (the macOS app) vs Windows (the Windows app) and Linux (the Linux app)

Every CLI command, feature, screen and protocol, with the Windows and Linux proof next to the Mac
proof. Mac evidence lives in `docs/evidence/mac/` (raw logs; a cell's evidence names the file).
Rig: macOS Sonoma 14 x86_64 guest (OSX-KVM) on GCP host `test-host`, against the Windows app's six nodes
on `test-host`. dvpnd = cf4c372-rc<N> (the Windows app/the Linux app parity tree + the macOS app macOS patches 0007–0026 in
`docs/patches/`; pin in `build/deps.lock.json`), darwin build (`scripts/e2e/mac/build-dvpnd.sh`, on the GCP host).
Three rigs (`test-host`, `test-host`, `test-host`) run `scripts/e2e/mac/matrix.sh`; every run's per-case results are
pulled to `docs/evidence/mac/<run>/` and summed by `matrix-json.mjs` (case × protocol, four oracles per cell).

**Rule (the Windows app):** nothing is done until a live run on the final build shows 0 FAIL.

**Status:** ✅ proven live on macOS · 🧪 unit-tested only · ◐ partly · ✗ fails (gap named) ·
⏸ blocked (reason given) · ☐ not run yet · — not applicable

## Headline

| | Windows (the Windows app) | Linux (the Linux app) | macOS (the macOS app) |
|---|---|---|---|
| CLI commands (catalogue: the Windows app's 71 + Mac `daemon uninstall`) | e2e + VM sweep | ✅ every command live (`cover`: 0 missing) | ☐ |
| Unit tests | Windows suite | ✅ 320/320 on the VM | 🧪 laptop (Windows) green; ☐ guest run |
| Protocols per GB | see LINUX-PARITY | ✅ all six | ☐ |
| Kill switch ON, all six | see LINUX-PARITY | ✅ path lost: no leak · ✗ gap #41 | ☐ |
| System proxy + browser window | ✅ WinINET | ✅ GNOME + KDE | ☐ networksetup |
| UI, every screen, dark + light | ✅ | ✅ | ☐ |
| Installer / clean install / upgrade / uninstall | ✅ | ✅ 22/22 | ☐ dmg + first-run setup |
| Apple silicon (arm64) | — | — | ⏸ built, not run (rig is Intel-only) |

## S12-lite live proof (QA, 2026-11-08) — fork-cb33-2 x64 dmg

A manual S-suite pass proving the install/upgrade/KS/uninstall path + money + per-protocol
reachability on the fork-cb33-2 x64 dmg (sha `64bacb7b…`), behind the root deadman. Full log:
`docs/evidence/mac/s12-lite-QA-2026-11-08.md`. Summary: install + hardened plist (root-owned PATH) +
socket `root:sentinel-dvpn` + money ✅; 5/6 protocols (wg/v2ray/xray/openvpn/hysteria2) end-to-end ✅
(AWG unsupported on macOS, UPSTREAM-FIXES #16); upgrade-over → doctor permissions ok + GUI settings
readable ✅; S2 kill switch fail-closed (abnormal tunnel kill → egress blocked) ✅; S10 uninstall clean
(no service/plist/socket/lib/anchors; device key kept) ✅. The full matrix below is QA's sweep on the RC.

## Release candidates (built from main `7935a158`: a717bf9f + 4bb86e04 + 7935a158; gated typecheck + 883/883)

| artifact | sha256 | status |
|---|---|---|
| Devnet-dVPN-0.1.3-x64.dmg | _pending RC build on the guest_ | live-provable (Intel guest) |
| Devnet-dVPN-0.1.3-arm64.dmg | _pending RC build on the guest_ | built only (rig is Intel) |

## Matrix — function × protocol (the Windows app's request)

Columns: WG = WireGuard · AWG = AmneziaWG · OVPN = OpenVPN · Hy2 = Hysteria2 · V2 = V2Ray · Xr = Xray.
Each cell names the sweep check that proves it (`~/sweep/<tier>.tsv` in the guest, copied to
`docs/evidence/mac/sweep/`).

| function / setting | WG | AWG | OVPN | Hy2 | V2 | Xr | proof (tier: check) |
|---|---|---|---|---|---|---|---|
| connect per GB, egress = node | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | spend: `<p>: egress IP = node` |
| disconnect leaves nothing (pf, utun, processes), egress direct | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | spend: `<p>: no leftovers` |
| per hour (stream channel) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | spend: `per hour: egress = node`; ledger: `per_hour <p>: egress = node` |
| switch without a gap | ☐ | — | — | — | ☐ | — | spend: `connect --switch v2ray → wireguard` |
| follow mode | — | — | — | — | — | ☐ | spend: `connect --follow` |
| top up (channels fund) | ☐ | — | — | — | — | — | ledger: `topup: channels fund <live channel> during the session` (billing is protocol-independent) |
| settle + withdraw | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | spend: `settle run`, `settle withdraw` |
| plans: subscribe → connect on subscription → close | ⏸ | ⏸ | ⏸ | ⏸ | ⏸ | ⏸ | spend with `PLAN_ADDR` (needs a plan the Windows app allows; not 6zKPsC/8CRB4PKg) |
| kill switch OFF: DNS = VPN DNS on every service | ☐ | ☐ | ☐ | ☐ | — | — | ledger: `dns-off <p>: VPN DNS 1.1.1.1 on every service` |
| kill switch ON: pf anchor loaded, names resolve | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ksdns: `pf anchor dvpnd is loaded`, `names resolve` |
| kill switch ON: pf passes the utun that exists (#29 shape) | ☐ | ☐ | ☐ | ☐ | — | — | ksdns: `pf passes the utun that exists` |
| kill switch ON: direct request blocked (SOCKS protocols) | — | — | — | — | ☐ | ☐ | ksdns: `a direct (non-proxied) request is blocked` |
| kill switch ON: path to server lost → no leak | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ksdns: `path to the server lost` (test pf anchor before dvpnd's) |
| kill switch ON: tunnel died (utun down / process killed) → no leak, also 25 s later | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ksdns: `tunnel broken`, `25 s later` (gap #41 fixed in rc) |
| kill switch ON: dvpnd itself dies → no leak | ☐ | — | — | ☐ | — | — | ledger: `kill-on <p>: dvpnd SIGKILLed` (launchd restarts it; same two protocols as the Linux app) |
| kill switch persist: service restart + dvpnd SIGKILL never leak | ☐ | — | ☐ | — | — | — | ledger: `persist <p>: …` (same two protocols as the Linux app) |
| restore network: pf / DNS / proxy exactly as before | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ksdns: `after restore`, `final: pf main ruleset as before` |
| DNS leak, kill switch off: no lookup on the physical interface | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ledger: `dns-off <p>: no lookup leaves on <if>` (tcpdump; V2/Xr: SOCKS-resolved names), positive control first |
| IPv6 leak | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ksdns: `IPv6 never leaves directly` (the GCP guest has no IPv6 route, so this proves little: recorded) |
| per-app split: system proxy (networksetup) | — | — | — | — | ☐ | ☐ | spend: `proxy on: every enabled service`, Chrome oracle |
| per-app split: browser window through SOCKS | — | — | — | — | ☐ | ☐ | spend: `proxy browser` |
| per-app split: everything else stays direct | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | coverage label on Connect (device / proxy-apps); UI scenario `coverage=` |
| per-destination split (#1) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | matrix: `split-route` (dvpnd split routes; pf permits with the kill switch on: `split-ks`) |
| V2Ray/Xray whole device (utun) | — | — | — | — | ☐ | ☐ | matrix: `whole` (the macOS app patches: darwin TUN via the Xray helper, IPv6 reject routes) |
| adopt an existing device key | ☐ | | | | | | daemon: `device register reads device.pub`; installer: reinstall keeps the device |
| uninstall leaves nothing (but the device key) | ☐ | | | | | | installer: `uninstall: …` (7 checks) |
| update over a running service | ☐ | | | | | | installer: `update: …` (stale copy flagged, refreshed) |
| node test run | ☐ | — | — | — | ☐ | — | spend: `test run (wireguard + v2ray)` |

## Platform pieces (Mac-specific)

| piece | proof |
|---|---|
| LaunchDaemon: KeepAlive restarts a crashed dvpnd | ☐ installer: `launchd restarts the service after a crash` |
| socket `root:dvpn 0660` + inherited user ACL | ☐ daemon: `socket root:dvpn 0660 with an ACL` |
| key folder root-only; `device.pub` readable | ☐ daemon: `device key folder is root-only` |
| service PATH = root-owned copies only | ☐ daemon: `service runs root-owned copies only` |
| root steps: `sudo -n` (rig) | ☐ daemon tier settings round trips |
| root steps: osascript admin prompt (GUI) | ☐ one prompt answered through QMP keystrokes (installer, GUI) |
| CLI wallet in the login Keychain; locked Keychain → action | ☐ local: `wallet secret is in the Keychain`, `Keychain locked says what to do` |
| app wallet: safeStorage (Keychain) | ☐ ui-smoke with a created wallet |
| drivers: Homebrew as the user + AmneziaWG from pinned source | ☐ daemon: `daemon repair-drivers`, `daemon drivers` all ready |
| login item (LaunchAgent) on/off | ☐ ui-smoke Settings toggle + `launchctl print gui/<uid>/…` |
| Terminal `.command` for the CLI screen | ☐ ui-smoke "Open in Terminal" |
| `.dmg` ad-hoc signature verifies | ☐ installer: `dmg: verifies and holds a signed app` |

## Every CLI command

Filled from `cli-sweep.sh cover` (0 MISSING = done); evidence `docs/evidence/mac/sweep/cover.txt`.
