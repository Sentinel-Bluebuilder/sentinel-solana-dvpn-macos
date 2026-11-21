# Third-party notices

Devnet dVPN for macOS (Sentinel dVPN License, see `LICENSE`) is a client for the open-source **Sentinel** protocol.
The application and its `.dmg`/`.zip` packages bundle the third-party software listed below, each
under its own license. Source for every component is available at the link given. The packages
carry no GPL program: the VPN tunnel tools below are installed from Homebrew, not bundled.

A machine-generated, per-release copy of the notices for the bundled protocol binaries (with the
exact versions, SHA-256 sums and the Xray modification patch) is written to
`build/THIRD-PARTY-NOTICES.txt` at package time and shipped inside the app
(`…/Contents/Resources/`). The full license text of every npm dependency is generated there too.

## Sentinel protocol

| Component | Role | License | Source |
|-----------|------|---------|--------|
| `sentinel-dvpnd` | the VPN daemon this app drives over gRPC | Sentinel dVPN License (Capybara Publishing LTD) | https://github.com/sentinel-official/sentinel-solana/blob/main/LICENSE |
| `daemon.proto` | the gRPC service definition the app speaks | Sentinel dVPN License (Capybara Publishing LTD) | https://github.com/sentinel-official/sentinel-solana/blob/main/LICENSE |
| `dvpn.devnet.json` | the devnet protocol/chain descriptor | Sentinel dVPN License (Capybara Publishing LTD) | https://github.com/sentinel-official/sentinel-solana/blob/main/LICENSE |

The complete dependency notice for every Go module compiled into `sentinel-dvpnd` (full license texts and NOTICE files, including `github.com/ncruces/go-sqlite3-wasm`, MIT-0) ships in the package as `dvpnd-THIRD-PARTY-NOTICES.txt`.

## Transport engines (bundled binaries)

| Component | Version | License | Source |
|-----------|---------|---------|--------|
| Xray-core | 26.3.27 | MPL-2.0 — **MODIFIED** (adds a macOS process-lookup source file; the patch ships in `build/THIRD-PARTY-NOTICES.txt` and `docs/patches/xray-0001-darwin-find-process.patch`) | https://github.com/XTLS/Xray-core/tree/v26.3.27 |
| Hysteria | 2.13.0 | MIT | https://github.com/apernet/hysteria/tree/app/v2.13.0 |
| V2Ray-core | 5.53.0 | MIT | https://github.com/v2fly/v2ray-core/tree/v5.53.0 |
| `geoip.dat`, `geosite.dat` | shipped with Xray | MIT (data files, v2fly/Loyalsoldier) | https://github.com/Loyalsoldier/v2ray-rules-dat |

## VPN tunnel tools (installed from Homebrew, not bundled)

The `.dmg`/`.zip` packages do not contain these programs. **Repair drivers** installs them on your Mac
from Homebrew (AmneziaWG is built from the pinned source tags below), and setup copies them root-owned
into the service's tool folder; see `resources/scripts/install-deps.sh`. Each stays under its own license.

| Component | License | Source |
|-----------|---------|--------|
| wireguard-go | MIT | https://git.zx2c4.com/wireguard-go |
| wireguard-tools (`wg`, `wg-quick`) | **GPL-2.0-only** | https://git.zx2c4.com/wireguard-tools |
| OpenVPN | **GPL-2.0-only** (with the OpenSSL linking exception) | https://github.com/OpenVPN/openvpn |
| GNU Bash (`wg-quick`/`awg-quick` need bash ≥ 4) | **GPL-3.0-or-later** | https://git.savannah.gnu.org/cgit/bash.git |
| AmneziaWG userspace (`amneziawg-go`) | MIT | https://github.com/amnezia-vpn/amneziawg-go (tag v3.1.20260812) |
| AmneziaWG tools (`awg`, `awg-quick`) | **GPL-2.0-only** | https://github.com/amnezia-vpn/amneziawg-tools (tag v3.1.20260812) |

## Fonts (bundled via @fontsource)

| Font | License | Source |
|------|---------|--------|
| Outfit | OFL-1.1 | https://github.com/Outfitio/Outfit-Fonts |
| JetBrains Mono | OFL-1.1 | https://github.com/JetBrains/JetBrainsMono |
| Tomorrow | OFL-1.1 | https://github.com/dvmazur/tomorrow-fonts |

## Notable npm runtime dependencies

| Package | License | Notes |
|---------|---------|-------|
| rpc-websockets | **LGPL-3.0** | Solana web3 websocket transport. Used unmodified as an npm dependency; replaceable per LGPL §6 by rebuilding `node_modules`. |

The complete list of every npm dependency and its license is generated into
`build/THIRD-PARTY-NOTICES.txt` at package time.

## GPL programs

None is bundled. If a later package bundles one, `scripts/fetch-deps.mjs` adds the written offer
for its source to the shipped `THIRD-PARTY-NOTICES.txt`.
