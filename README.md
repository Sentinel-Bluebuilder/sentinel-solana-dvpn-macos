# Sentinel dVPN for macOS (Solana devnet)

Devnet dVPN is a pure peer-to-peer dVPN app on the Sentinel Solana devnet protocol. Pick any server and pay it directly, or subscribe to any plan. No accounts, no servers in the middle. This is the macOS build: unix socket, launchd LaunchDaemon, administrator prompt, pf kill switch, networksetup DNS and system proxy, Keychain. Every app function is also a command (`devnet-dvpn ...`). Built on [Sentinel](https://sentinel.co).

## Download

Latest release: <https://github.com/Sentinel-Bluebuilder/sentinel-solana-dvpn-macos/releases/latest>

| Platform | File |
|---|---|
| macOS, Apple silicon (arm64) | `Devnet-dVPN-0.1.3-arm64.dmg` (or `-arm64-mac.zip`) |
| macOS, Intel (x64) | `Devnet-dVPN-0.1.3-x64.dmg` (or `-x64-mac.zip`) |
| Checksums | `SHA256SUMS` |

All files: <https://github.com/Sentinel-Bluebuilder/sentinel-solana-dvpn-macos/releases/latest>

Newer pre-release: [`v0.3.0-rc2`](https://github.com/Sentinel-Bluebuilder/sentinel-solana-dvpn-macos/releases/tag/v0.3.0-rc2), files `Devnet-dVPN-0.3.0-rc.2-{arm64,x64}.dmg` (or `-mac.zip`) and `SHA256SUMS`.

## Status: devnet, not notarized

- Runs on the **Sentinel Solana devnet** only. Devnet tokens have no value; do not use a wallet that holds real funds.
- The latest release, **0.1.3**, carries the Sentinel Solana fork cut `final6.5` (based on [sentinel-official/sentinel-solana](https://github.com/sentinel-official/sentinel-solana)). The pre-release **0.3.0-rc2** carries the cut `final6.16`.
- Builds are **not code-signed by a publisher** (see the platform note below), so the OS will warn on first run. Verify the download against `SHA256SUMS` first.

## Requirements

- **macOS 12 or newer.** The Intel (x64) build is tested. The Apple silicon (arm64) build is built and signed but has never been run.
- **An administrator account.** Installing the VPN service asks for the administrator password once (from a script, with passwordless `sudo`, nothing asks). Changing service settings (kill switch, DNS, split tunnelling) and repairing drivers ask again.
- **Protocols:** V2Ray, Xray and Hysteria2 come inside the app. WireGuard, AmneziaWG and OpenVPN need [Homebrew](https://brew.sh): Diagnostics > Repair drivers (or `devnet-dvpn daemon repair-drivers --yes`) installs them as your user. On Intel, Homebrew builds them from source, which takes a while. `devnet-dvpn daemon drivers` shows what is ready.

## Verify a download

Download `SHA256SUMS` and the file(s) from the [release](https://github.com/Sentinel-Bluebuilder/sentinel-solana-dvpn-macos/releases/latest) into one folder, then check each file you downloaded (macOS ships `shasum`):

```bash
grep ' Devnet-dVPN-0.1.3-x64.dmg$' SHA256SUMS | shasum -a 256 -c -
```

## Test results and known issues

Test results, the bug catalogue and open issues for every Sentinel dVPN client live in the testing-tools repository:

- Results and tools: <https://github.com/Sentinel-Bluebuilder/sentinel-solana-dvpn-testing-tools>
- Known issues for RC1/RC2: <https://github.com/Sentinel-Bluebuilder/sentinel-solana-dvpn-testing-tools/blob/main/docs/known-issues-rc1.md>

Known issues in 0.3.0-rc2 on macOS:

1. After each update, the first time the app needs your wallet, macOS asks for your login password ("Devnet dVPN Safe Storage"). Choose **Always Allow**. A publisher (Apple Developer ID) signature would remove this. The command line with a key file (`--keyfile`) never asks.
2. The app ignores a plain `SIGTERM`. Quit, log-out and shut-down close it normally.
3. After the VPN service is killed, "The VPN service is restarting" shows for about 10 s.
4. `daemon doctor` run as your user warns that it cannot inspect the kernel (`pfctl`) while the kill switch holds a block.
5. With the kill switch holding a block at log-in, the blocked view can take up to about 100 s to appear. Nothing leaks meanwhile.
6. Apple silicon (arm64): never run.

## License

[Sentinel dVPN License](LICENSE). Third-party components keep their own licenses (see `THIRD-PARTY-NOTICES`).

macOS note: 0.1.3 is ad-hoc signed and 0.3.0-rc2 is signed with one stable self-signed identity; neither is **notarized**. The first time you open the app, right-click it and choose **Open**.

## Install

Open the `.dmg` and drag the app to Applications. Its first run sets up the device and installs the VPN service (one administrator prompt); afterwards `devnet-dvpn help` works in any terminal. To remove it: Diagnostics > Remove the VPN service (or `devnet-dvpn daemon uninstall --yes`), then drag the app to the Trash. Removing the service restores your network settings. It keeps the device key in `/var/db/dvpnd/client` (it holds an on-chain permission and SOL, and a reinstall picks it up), the `dvpn` group and your Homebrew packages. See [installer notes](docs/INSTALLER.md).

From a terminal, with no clicks (for scripts and AI agents; needs an administrator account, and with passwordless `sudo` nothing asks at all):

```bash
M=$(hdiutil attach -nobrowse -readonly Devnet-dVPN-<version>-x64.dmg | tail -1 | cut -f3-)
sudo -n ditto "$M/Devnet dVPN.app" "/Applications/Devnet dVPN.app"; hdiutil detach -quiet "$M"
CLI="/Applications/Devnet dVPN.app/Contents/Resources/bin/devnet-dvpn"   # until the service is installed
"$CLI" wallet create --keyfile ~/dvpn-key.json --yes; export DVPN_KEYFILE=~/dvpn-key.json
# fund the address from "$CLI" wallet show with devnet SOL + tDVPN, then:
"$CLI" daemon init && "$CLI" device setup --yes && "$CLI" daemon install --yes
devnet-dvpn status                                                      # on PATH from here on
```

## Build from source

On a Mac:

```bash
npm ci
npm run typecheck
npm test
npm run package:mac        # .dmg and .zip
```

Docs: [architecture](docs/ARCHITECTURE.md), [CLI](docs/CLI.md), [design](docs/DESIGN.md), [network safety](docs/NETWORK-SAFETY.md), [parity with the other platforms](docs/MAC-PARITY.md).
