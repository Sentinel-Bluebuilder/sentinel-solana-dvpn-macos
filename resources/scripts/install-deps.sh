#!/bin/bash
# ─── VPN tools (F1, F17) — check, install, or copy for the service (macOS) ───
# What dvpnd needs on macOS (sentinel-solana docs 25 §7): wg + wg-quick + wireguard-go (WireGuard),
# awg + awg-quick + amneziawg-go (AmneziaWG), openvpn, and bash 4+ (wg-quick needs it; macOS ships
# 3.2). pf (kill switch) and networksetup (DNS) are part of macOS. V2Ray / Xray / Hysteria2 ship
# inside the app.
# The service runs only ROOT-OWNED copies in /usr/local/lib/devnet-dvpn/tools: Homebrew's prefix is
# writable by the user, so root never executes a tool from there. wg-quick / awg-quick get their
# interpreter line pointed at our copied bash.
#   --CheckOnly 1  : no root, installs nothing, writes the report (exit 2 = something missing)
#   --UserPhase 1  : AS THE MAC USER (never root, no time limit): Homebrew installs what is missing
#                    and AmneziaWG is built from pinned source into the user's cache. On an Intel
#                    Mac Homebrew builds openvpn/bash/go from source: this can take over an hour,
#                    which is why it is not inside the administrator step. Lines "PROGRESS ..." =
#                    stages for the app / CLI.
#   --CopyOnly 1   : root; copy what Homebrew has into the service folder (setup-daemon.sh)
#   --Built 1      : root, with --User; the user phase already ran: copy Homebrew's tools and the
#                    user's AmneziaWG build into the service folder, write the report (the app's
#                    short administrator step)
#   otherwise      : root, with --User; runs the user phase as that user, then the same copy
# Args: [--CheckOnly 1] [--UserPhase 1] [--CopyOnly 1] [--Built 1] [--User name] [--OutDir dir] [--Result]
set -uo pipefail
source "$(cd -P "$(dirname "$0")" && pwd -P)/_lib.sh"
parse_args "$@"
CHECK="${ARG_CheckOnly:-0}"; COPY_ONLY="${ARG_CopyOnly:-0}"; USER_NAME="${ARG_User:-}"
USER_PHASE="${ARG_UserPhase:-0}"; BUILT="${ARG_Built:-0}"
OUT="${ARG_OutDir:-$LIB}"
TOOLS="$LIB/tools"
# Tools bundled in the app package (fetch-deps stages them into resources/bin/tools). copy_tools
# installs these root-owned at setup, so a user with no Homebrew gets a working service; the
# Homebrew / source-build path below is only the fallback when a bundled tool is missing (an arch
# we don't yet ship, or a repair on an old package).
BUNDLE_TOOLS="$(cd -P "$(dirname "$0")/../bin/tools" 2>/dev/null && pwd -P || true)"
bundle_tool() { [ -n "$BUNDLE_TOOLS" ] && [ -f "$BUNDLE_TOOLS/$1" ] && echo "$BUNDLE_TOOLS/$1" || echo ""; }
bundle_complete() { local t; for t in wg wireguard-go bash openvpn awg amneziawg-go wg-quick awg-quick; do [ -n "$(bundle_tool "$t")" ] || return 1; done; return 0; }
# AmneziaWG: same generation as the nodes and the Linux rig (amneziawg-tools v3.1.20260812, ee0f0a9)
AWG_TOOLS_TAG=v3.1.20260812; AWG_TOOLS_COMMIT=ee0f0a9aa34ff0a0da4b3433b9512781cfe02843
AWG_GO_TAG=v3.1.20260812; AWG_GO_COMMIT=1f50ad736ecca22a9bfc7b4606805ec9ca49fe48

BREW=""
for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && { BREW="$b"; break; }; done
PREFIX=""; [ -n "$BREW" ] && PREFIX="$(dirname "$(dirname "$BREW")")"
# Homebrew 7 dropped Intel Macs to tier 3: its install.sh refuses x86_64, but brew still runs there.
brew_hint() {
  if [ "$(uname -m)" = arm64 ]; then echo 'Homebrew is needed to install the WireGuard and OpenVPN tools: https://brew.sh'
  else echo "Homebrew is needed to install the WireGuard and OpenVPN tools. On an Intel Mac the brew.sh installer refuses to run; install it by hand: https://docs.brew.sh/Installation#untar-anywhere-unsupported (into /usr/local)."; fi
}
brew_tool() { # name → path in the Homebrew prefix, or ""
  local p
  for p in "$PREFIX/bin/$1" "$PREFIX/sbin/$1" "$PREFIX/opt/openvpn/sbin/$1"; do [ -n "$PREFIX" ] && [ -x "$p" ] && { echo "$p"; return; }; done
  echo ""
}
svc_tool() { [ -x "$TOOLS/$1" ] && echo "$TOOLS/$1" || echo ""; }
# where a tool is: the service copy first; before the service exists, Homebrew's (setup copies it)
have_tool() { local s; s="$(svc_tool "$1")"; [ -n "$s" ] && { echo "$s"; return; }; [ -d "$LIB" ] || brew_tool "$1"; }

row() { printf '{"name":%s,"wanted":%s,"found":%s,"status":%s,"detail":%s}' "$(json_str "$1")" "$(json_str "$2")" "$(json_str "$3")" "$(json_str "$4")" "$(json_str "$5")"; }
ver() { "$@" 2>&1 | head -1 | grep -oE '[0-9]+(\.[0-9]+)+' | head -1; }
missing_list() { local t m=""; for t in "$@"; do [ -n "$(have_tool "$t")" ] || m="$m $t"; done; echo "${m# }"; }
probe() { # name → "found|status|detail"
  local m
  case "$1" in
    macos)
      local v; v="$(sw_vers -productVersion 2>/dev/null)"
      if [ "${v%%.*}" -ge 12 ] 2>/dev/null; then echo "$v ($(uname -m))|present|"; else echo "$v|incompatible|macOS 12 or newer is needed"; fi ;;
    homebrew)
      if [ -n "$BREW" ]; then echo "$PREFIX|present|"; else echo "|missing|$(brew_hint)"; fi ;;
    wireguard)
      m="$(missing_list wg wg-quick wireguard-go bash)"
      if [ -z "$m" ]; then echo "$(ver "$(have_tool wg)" --version)|present|"; else echo "|missing|not found for the service: $m (Homebrew: wireguard-tools wireguard-go bash)"; fi ;;
    amneziawg)
      m="$(missing_list awg awg-quick amneziawg-go)"
      if [ -z "$m" ] && ! awg_quick_ok "$(have_tool awg-quick)"; then echo "$(ver "$(have_tool awg)" --version)|incompatible|awg-quick is the unfixed upstream script (it cannot start a tunnel on macOS); Repair drivers replaces it";
      elif [ -z "$m" ]; then echo "$(ver "$(have_tool awg)" --version)|present|"; else echo "|missing|not found for the service: $m (built from amneziawg-tools $AWG_TOOLS_TAG + amneziawg-go $AWG_GO_TAG)${AWG_WHY:+; build failed: $AWG_WHY}"; fi ;;
    openvpn)
      m="$(have_tool openvpn)"
      if [ -n "$m" ]; then echo "$("$m" --version 2>/dev/null | head -1 | awk '{print $2}')|present|"; else echo "|missing|openvpn not found for the service (Homebrew: openvpn)"; fi ;;
    pf)
      if [ -x /sbin/pfctl ]; then echo "pfctl|present|"; else echo "|missing|pfctl not found (kill switch)"; fi ;;
    dns)
      if [ -x /usr/sbin/networksetup ]; then echo "networksetup|present|"; else echo "|missing|networksetup not found: the VPN's DNS cannot be applied"; fi ;;
  esac
}

# Copy Homebrew's tools into the root-owned service folder (root).
copy_tools() {
  install -d -m 755 "$LIB" "$TOOLS" || return 1
  local t src
  # Binaries: the bundled copy first (no Homebrew needed), else Homebrew's.
  for t in wg wireguard-go bash openvpn amneziawg-go awg; do
    src="$(bundle_tool "$t")"; [ -n "$src" ] || src="$(brew_tool "$t")"; [ -n "$src" ] || continue
    # install(1) copies what a Homebrew symlink points at, so the copy is a real file
    install -m 755 "$src" "$TOOLS/$t.new" && mv -f "$TOOLS/$t.new" "$TOOLS/$t"
  done
  # wg-quick is a bash script; re-point its shebang at our bundled bash. Bundle first, else Homebrew.
  src="$(bundle_tool wg-quick)"; [ -n "$src" ] || src="$(brew_tool wg-quick)"
  if [ -n "$src" ]; then
    { echo "#!$TOOLS/bash"; tail -n +2 "$src"; } > "$TOOLS/wg-quick.new" && chmod 755 "$TOOLS/wg-quick.new" && mv -f "$TOOLS/wg-quick.new" "$TOOLS/wg-quick"
  fi
  # awg-quick: the bundled upstream script fixed here (one source of truth for the fix); else a
  # user-built copy already in place just gets its shebang re-pointed.
  src="$(bundle_tool awg-quick)"
  if [ -n "$src" ]; then
    { echo "#!$TOOLS/bash"; tail -n +2 "$src" | fix_awg_quick; } > "$TOOLS/awg-quick.new" && chmod 755 "$TOOLS/awg-quick.new" && mv -f "$TOOLS/awg-quick.new" "$TOOLS/awg-quick"
  elif [ -f "$TOOLS/awg-quick" ]; then
    sed -i '' "1s|.*|#!$TOOLS/bash|" "$TOOLS/awg-quick"
  fi
  # Bundled shared libraries: the @loader_path deps of openvpn/bash (openssl, lzo, lz4,
  # pkcs11-helper, readline, ncurses, gettext). On a no-Homebrew Mac these are the ONLY copies,
  # so a complete bundle ships them next to the binaries that load them. Nothing to do if none
  # shipped (system-linked build). They inherit the root:wheel / go-w hardening below.
  if [ -n "$BUNDLE_TOOLS" ]; then
    for src in "$BUNDLE_TOOLS"/*.dylib; do
      [ -f "$src" ] || continue
      bn="$(basename "$src")"
      install -m 755 "$src" "$TOOLS/$bn.new" && mv -f "$TOOLS/$bn.new" "$TOOLS/$bn"
    done
  fi
  chown -R root:wheel "$LIB"; chmod -R go-w "$LIB"
  xattr -dr com.apple.quarantine "$TOOLS" 2>/dev/null
  return 0
}

# Where the user phase builds AmneziaWG (per pin, so a pin bump rebuilds): <home>/Library/Caches/...
awg_cache() { echo "$1/Library/Caches/devnet-dvpn/awg-$AWG_TOOLS_TAG-$AWG_GO_TAG"; }
user_home() { dscl . -read "/Users/$1" NFSHomeDirectory 2>/dev/null | sed -n 's/^NFSHomeDirectory: //p'; }

# Build AmneziaWG from pinned source into <dir> (user phase: runs as the Mac user, never root).
build_awg() {
  local dir="$1" work go
  go="$(brew_tool go)"; [ -n "$go" ] || { echo "go missing" >&2; return 1; }
  xcode-select -p >/dev/null 2>&1 || { echo "Xcode command line tools missing (xcode-select --install)" >&2; return 1; }
  work="$(mktemp -d /tmp/devnet-dvpn-awg.XXXXXX)" || return 1
  (
    set -euo pipefail; cd "$work"; export PATH="$PREFIX/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    git clone -q --depth 1 --branch "$AWG_TOOLS_TAG" https://github.com/amnezia-vpn/amneziawg-tools.git tools
    [ "$(git -C tools rev-parse HEAD)" = "$AWG_TOOLS_COMMIT" ] || { echo "amneziawg-tools $AWG_TOOLS_TAG is not commit $AWG_TOOLS_COMMIT" >&2; exit 1; }
    git clone -q --depth 1 --branch "$AWG_GO_TAG" https://github.com/amnezia-vpn/amneziawg-go.git go
    [ "$(git -C go rev-parse HEAD)" = "$AWG_GO_COMMIT" ] || { echo "amneziawg-go $AWG_GO_TAG is not commit $AWG_GO_COMMIT" >&2; exit 1; }
    make -s -C tools/src >/dev/null
    (cd go && GOFLAGS=-mod=readonly go build -trimpath -o amneziawg-go .)
    mkdir -p "$dir"
    cp tools/src/wg "$dir/awg.new" && mv -f "$dir/awg.new" "$dir/awg"
    cp tools/src/wg-quick/darwin.bash "$dir/awg-quick.new" && mv -f "$dir/awg-quick.new" "$dir/awg-quick"
    cp go/amneziawg-go "$dir/amneziawg-go.new" && mv -f "$dir/amneziawg-go.new" "$dir/amneziawg-go"
  ) || { rm -rf "$work"; return 1; }
  rm -rf "$work"
}

# Root: install the user's AmneziaWG build into the service folder. Only plain files (no links)
# owned by that user; root-owned copies are what the service runs.
install_awg_from() {
  local dir="$1" u="$2" t
  for t in awg awg-quick amneziawg-go; do
    [ -f "$dir/$t" ] && [ ! -L "$dir/$t" ] && [ "$(stat -f %Su "$dir/$t")" = "$u" ] || return 1
  done
  install -d -m 755 "$TOOLS" || return 1
  install -m 755 "$dir/awg" "$TOOLS/awg" && install -m 755 "$dir/amneziawg-go" "$TOOLS/amneziawg-go" || return 1
  { echo "#!$TOOLS/bash"; tail -n +2 "$dir/awg-quick" | fix_awg_quick; } > "$TOOLS/awg-quick" && chmod 755 "$TOOLS/awg-quick" || return 1
  awg_quick_ok "$TOOLS/awg-quick" || { echo "awg-quick still calls wg or /var/run/wireguard after the fix" >&2; return 1; }
}

# amneziawg-tools' darwin awg-quick (v3.1.20260812) is half-renamed: it starts amneziawg-go with
# its name file in /var/run/amneziawg, then checks the file's age in /var/run/wireguard and lists
# interfaces with `wg` (WireGuard's tool, which only sees /var/run/wireguard). The check always
# fails, so every AmneziaWG session failed to start (the macOS app matrix 2026-10-22). Rename both.
fix_awg_quick() {
  sed -E -e 's|/var/run/wireguard/|/var/run/amneziawg/|g' \
    -e 's/(^|[[:space:](])wg (show|showconf|setconf|syncconf|addconf|set)( |$)/\1awg \2\3/g'
}
awg_quick_ok() {
  ! grep -qE '/var/run/wireguard/|(^|[[:space:](])wg (show|showconf|setconf|syncconf|addconf|set)( |$)' "$1"
}

NAMES=(macos homebrew wireguard amneziawg openvpn pf dns)
installed=()
AWG_WHY=''
# Full install keeps every Homebrew / build line here (root-owned, next to the report).
LOG="$OUT/install-deps.log"
# ─── User phase: Homebrew + AmneziaWG build as the Mac user, no time limit ───
if [ "$USER_PHASE" = 1 ]; then
  [ "$(id -u)" != 0 ] || die 'the user phase runs as the Mac user (Homebrew refuses root)'
  [ -n "$BREW" ] || die "Homebrew is not installed. $(brew_hint)"
  pkgs=()
  for f in wireguard-tools wireguard-go openvpn bash go; do
    "$BREW" list --formula "$f" >/dev/null 2>&1 || pkgs+=("$f")
  done
  if [ ${#pkgs[@]} -gt 0 ]; then
    echo "PROGRESS Homebrew: installing ${pkgs[*]}"
    [ "$(uname -m)" = arm64 ] || echo 'PROGRESS This Intel Mac has no ready-made Homebrew packages for some of them: building from source can take over an hour'
    env HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 "$BREW" install "${pkgs[@]}" || die "Homebrew could not install: ${pkgs[*]}"
  fi
  dir="$(awg_cache "$HOME")"
  if [ ! -f "$dir/awg" ] || [ ! -f "$dir/awg-quick" ] || [ ! -f "$dir/amneziawg-go" ]; then
    echo "PROGRESS AmneziaWG: building $AWG_TOOLS_TAG from pinned source"
    build_awg "$dir" || { echo 'PROGRESS AmneziaWG could not be built from source (details in the log)'; exit 3; }
  fi
  echo 'PROGRESS Tools ready for the service'
  exit 0
fi

if [ "$CHECK" != 1 ]; then
  [ "$(id -u)" = 0 ] || die 'installing the VPN tools needs root'
  if [ "$COPY_ONLY" = 1 ]; then
    copy_tools
    # A reinstall (daemon uninstall, then install) starts from an empty service folder: put the
    # user's AmneziaWG build back too, or AmneziaWG stays missing until a repair (the macOS app rig 3).
    if [ -n "$USER_NAME" ] && [ "$(probe amneziawg | cut -d'|' -f2)" != present ]; then
      home_u="$(user_home "$USER_NAME")"
      [ -n "$home_u" ] && install_awg_from "$(awg_cache "$home_u")" "$USER_NAME" || echo 'AmneziaWG build not found for the user: repair the drivers to build it' >&2
    fi
    exit 0
  fi
  mkdir -p "$OUT" && : > "$LOG"
  before_wg="$(probe wireguard | cut -d'|' -f2)"; before_ovpn="$(probe openvpn | cut -d'|' -f2)"; before_awg="$(probe amneziawg | cut -d'|' -f2)"
  if bundle_complete; then
    # Everything is in the package: a repair just re-installs the bundled tools root-owned. No
    # Homebrew, no source build — so a user with no Homebrew (any arch we ship) can still repair.
    echo '== bundled tools present: installing root-owned, no Homebrew needed' >> "$LOG"
    copy_tools
  else
    [ -n "$BREW" ] || die "Homebrew is not installed. $(brew_hint) Then press Repair again."
    [ -n "$USER_NAME" ] && id -u "$USER_NAME" >/dev/null 2>&1 || die 'installing needs the name of the Mac user who owns Homebrew'
    [ "$(stat -f %Su "$PREFIX/bin")" = "$USER_NAME" ] || [ "$(stat -f %Su "$BREW")" = "$USER_NAME" ] || die "Homebrew in $PREFIX belongs to another user; run Repair as that user"
    if [ "$BUILT" != 1 ]; then
      # used as root directly (no app): run the user phase as that user, logged here
      echo "== user phase as $USER_NAME" >> "$LOG"
      sudo -u "$USER_NAME" -H /bin/bash "$0" --UserPhase 1 >> "$LOG" 2>&1 || echo '== user phase failed' >> "$LOG"
    fi
    copy_tools
    if [ "$before_awg" != present ]; then
      home_u="$(user_home "$USER_NAME")"
      if [ -n "$home_u" ] && install_awg_from "$(awg_cache "$home_u")" "$USER_NAME"; then copy_tools
      else AWG_WHY='not built by the user phase (see the install log)'; fi
    fi
  fi
  [ "$before_wg" != present ] && [ "$(probe wireguard | cut -d'|' -f2)" = present ] && installed+=(wireguard)
  [ "$before_ovpn" != present ] && [ "$(probe openvpn | cut -d'|' -f2)" = present ] && installed+=(openvpn)
  [ "$before_awg" != present ] && [ "$(probe amneziawg | cut -d'|' -f2)" = present ] && installed+=(amneziawg)
fi
rows=(); ok=true; missing=()
for n in "${NAMES[@]}"; do
  IFS='|' read -r found status detail <<< "$(probe "$n")"
  [ "$status" = present ] && [[ " ${installed[*]:-} " == *" $n "* ]] && status=installed
  if [ "$status" != present ] && [ "$status" != installed ]; then ok=false; missing+=("$n"); fi
  rows+=("$(row "$n" any "$found" "$status" "$detail")")
done
report="{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"ok\":$ok,\"rebootRequired\":false,\"deps\":[$(IFS=,; echo "${rows[*]}")]}"
if [ "$CHECK" = 1 ] || [ -d "$OUT" ] || mkdir -p "$OUT" 2>/dev/null; then printf '%s\n' "$report" > "$OUT/install-deps.json" 2>/dev/null; fi
if [ "$CHECK" = 1 ]; then [ "$ok" = true ] && exit 0 || exit 2; fi
if [ "$ok" = true ]; then write_result ok "${installed[*]:-nothing to install}"; else die "still missing after install: ${missing[*]}${AWG_WHY:+ (AmneziaWG: $AWG_WHY)}. Details: $LOG"; fi
