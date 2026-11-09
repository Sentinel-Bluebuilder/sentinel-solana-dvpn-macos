#!/bin/bash
# ─── Start / stop / restart the VPN service (root, launchd) ───
# Args: --Action start|stop|restart [--Service] --Result   (--Service kept for the shared app code)
set -uo pipefail
source "$(cd -P "$(dirname "$0")" && pwd -P)/_lib.sh"
parse_args "$@"
A="${ARG_Action:-}"
[[ "$A" =~ ^(start|stop|restart)$ ]] || die "bad action $A"
[ -f "$PLIST" ] || die 'the VPN service is not installed'
case "$A" in
  start) svc_running || svc_start || die "launchctl could not start the service: $(svc_log_tail)" ;;
  stop) svc_stop || die 'the service did not stop' ;;
  restart) svc_stop || die 'the service did not stop'; svc_start || die "launchctl could not start the service: $(svc_log_tail)" ;;
esac
state=stopped; svc_running && state=running
write_result ok "$A done: $state"
