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

## Status: devnet, release candidate, unsigned

- Runs on the **Sentinel Solana devnet** only. Devnet tokens have no value; do not use a wallet that holds real funds.
- This is **release candidate 2 (RC2)**, built on the Sentinel Solana fork cut `final6.1` (`02b22fc`, based on [sentinel-official/sentinel-solana](https://github.com/sentinel-official/sentinel-solana) `26de5240`).
- Builds are **not code-signed by a publisher** (see the platform note below), so the OS will warn on first run. Verify the download against `SHA256SUMS` first.

## Verify a download

Download `SHA256SUMS` and the file(s) from the [release](https://github.com/Sentinel-Bluebuilder/sentinel-solana-dvpn-macos/releases/latest) into one folder, then:

```bash
sha256sum -c SHA256SUMS --ignore-missing
```

## Test results and known issues

Test results, the bug catalogue and open issues for every Sentinel dVPN client live in the testing-tools repository:

- Results and tools: <https://github.com/Sentinel-Bluebuilder/sentinel-solana-dvpn-testing-tools>
- Known issues for RC1/RC2: <https://github.com/Sentinel-Bluebuilder/sentinel-solana-dvpn-testing-tools/blob/main/docs/known-issues-rc1.md>

## License

[Sentinel dVPN License](LICENSE). Third-party components keep their own licenses (see `THIRD-PARTY-NOTICES`).

macOS note: the app is ad-hoc signed, **not notarized**. The first time, right-click the app and choose **Open**.

## Install

Open the `.dmg` and drag the app to Applications. Its first run sets up the device and installs the VPN service (one administrator prompt); afterwards `devnet-dvpn help` works in any terminal. To remove it: Diagnostics > Remove the VPN service (or `devnet-dvpn daemon uninstall --yes`), then drag the app to the Trash. See [installer notes](docs/INSTALLER.md).

## Build from source

On a Mac:

```bash
npm ci
npm run typecheck
npm test
npm run package:mac        # .dmg and .zip
```

Docs: [architecture](docs/ARCHITECTURE.md), [CLI](docs/CLI.md), [design](docs/DESIGN.md), [network safety](docs/NETWORK-SAFETY.md), [parity with the other platforms](docs/MAC-PARITY.md).
