#!/usr/bin/env bash
# shellcheck disable=SC2034

APPLE_NETWORK_ERRORS='NSURLErrorDomain|Code=-10(01|04|05|09)|The network connection was lost|The Internet connection appears to be offline|The request timed out|Could not connect to the server|HTTPError\(statusCode: (nil|5[0-9][0-9])'
STAPLER_TRANSIENT_ERRORS="$APPLE_NETWORK_ERRORS|Error 68|CloudKit's response is inconsistent"
NOTARY_SUBMISSION_ID='"id"[[:space:]]*:[[:space:]]*"[A-Za-z0-9-]+"'
