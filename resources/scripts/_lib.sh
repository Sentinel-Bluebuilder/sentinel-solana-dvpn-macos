# ─── shared by the dvpn-helper steps (sourced, root, macOS /bin/bash 3.2) ───
# Bash 3.2: no associative arrays, no ${x,,}, and "${a[@]}" of an empty array trips `set -u`
# (use ${a[@]+"${a[@]}"}). Named args: --Key value → $ARG_Key. Results: one JSON line in
# --Result (a file inside a folder the calling user created: /…/devnet-dvpn-XXXXXX/result.json).
# cb33 (26de5240): the client is instance c0; the daemon is sentinel-dvpnd and the home is the real
# instance dir /Library/Application Support/sentinel-dvpn/c0 (a SPACE in the path). We write our OWN
# LaunchDaemon (label below), so we still choose its args, PATH and log path. LABEL/DAEMON_ROOT are
# overridable so a caller can pass --Label; the svc_* helpers read $LABEL at call time.
LABEL="${LABEL:-co.sentinel.sentinel-dvpnd.c0}"
PLIST="/Library/LaunchDaemons/$LABEL.plist"
# Tools install root. MUST be a fully root-owned chain: the daemon runs only binaries no non-root
# account can replace (sentinel-go-sdk service/trust.go trustedChain walks every ancestor). Homebrew-
# Intel chowns /usr/local/lib to uid 501, so the old /usr/local/lib/devnet-dvpn failed that check on
# connect (DIR 11-08). /Library is root:wheel 0755 (every parent root-owned) AND has no space:
# "Application Support" was tried first but its space breaks Homebrew's wg-quick/awg-quick, which
# re-parse the tool path internally and can't take it unquoted (QA 11-08). /Library/devnet-dvpn dodges
# that entirely while keeping the root-only chain (QA's armed fallback).
LIB=/Library/devnet-dvpn
LOG_DIR=/Library/Logs/DevnetDVPN
# The cb33 state root (our product folder under Application Support); the home is $DAEMON_ROOT/c0.
DAEMON_ROOT="${DAEMON_ROOT:-/Library/Application Support/sentinel-dvpn}"

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --[A-Za-z]*)
        [ $# -ge 2 ] || { echo "missing value for $1" >&2; exit 64; }
        local k="${1#--}"
        [[ "$k" =~ ^[A-Za-z]+$ ]] || { echo "bad parameter name $1" >&2; exit 64; }
        printf -v "ARG_$k" '%s' "$2"; shift 2 ;;
      *) echo "unexpected argument: $1" >&2; exit 64 ;;
    esac
  done
}
json_str() {
  local s="$1"
  s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; s="${s//$'\n'/\\n}"; s="${s//$'\r'/}"; s="${s//$'\t'/ }"
  printf '"%s"' "$s"
}
write_result() { # status detail [extra-json-fields]
  local r="${ARG_Result:-}"
  [ -n "$r" ] || return 0
  if ! [[ "$r" =~ /devnet-dvpn-[A-Za-z0-9]+/result\.json$ ]] || [ -L "$r" ] || [ -L "$(dirname "$r")" ]; then
    echo "refusing result path $r" >&2; return 0
  fi
  printf '{"status":%s,"detail":%s,"at":"%s"%s}\n' "$(json_str "$1")" "$(json_str "$2")" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${3:+,$3}" > "$r"
  chmod 644 "$r"
}
die() { write_result error "$1"; echo "$1" >&2; exit 1; }
# canonical path without requiring it to exist (macOS has no `realpath -m`; /var → /private/var)
canon() {
  local p="$1" tail=""
  case "$p" in /*) ;; *) p="$PWD/$p" ;; esac
  case "/$p/" in */../*|*/./*) echo "//invalid"; return ;; esac
  while [ ! -d "$p" ]; do tail="/$(basename "$p")$tail"; p="$(dirname "$p")"; done
  printf '%s%s\n' "$(cd -P "$p" && pwd -P)" "$tail"
}
under() { # path prefix → true when path is inside prefix (after resolving)
  local p q; p="$(canon "$1")"; q="$(canon "$2")"
  [[ "$p" == "$q"/* || "$p" == "$q" ]]
}
here_dir() { cd -P "$(dirname "$1")" && pwd -P; }
svc_loaded() { launchctl print "system/$LABEL" >/dev/null 2>&1; }
svc_running() { launchctl print "system/$LABEL" 2>/dev/null | grep -q 'state = running'; }
svc_log_tail() { tail -n "${1:-3}" "$LOG_DIR/dvpnd.log" 2>/dev/null | tr '\n' ' '; }
svc_start() {
  [ -f "$PLIST" ] || return 1
  if svc_loaded; then launchctl kickstart "system/$LABEL"; else launchctl bootstrap system "$PLIST"; fi
}
svc_stop() { svc_loaded || return 0; launchctl bootout "system/$LABEL" 2>/dev/null; local i; for i in $(seq 1 60); do svc_loaded || return 0; sleep 0.5; done; return 1; }
wait_socket() { local i; for i in $(seq 1 150); do [ -S "$1" ] && return 0; sleep 0.2; done; return 1; }
