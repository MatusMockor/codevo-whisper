#!/usr/bin/env bash
set -euo pipefail

: "${CSC_LINK:?CSC_LINK must hold the base64 encoded Developer ID .p12}"
: "${CSC_KEY_PASSWORD:?CSC_KEY_PASSWORD must be set}"
: "${RUNNER_TEMP:?RUNNER_TEMP must be set}"

umask 077
keychain="$RUNNER_TEMP/codevo-signing.keychain-db"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
certificate="$work/certificate.p12"
keychain_password="$(openssl rand -base64 24)"

printf '%s' "$CSC_LINK" | base64 --decode >"$certificate"
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import "$certificate" -k "$keychain" -P "$CSC_KEY_PASSWORD" -T /usr/bin/codesign -T /usr/bin/productbuild
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" >/dev/null
read -r -a existing <<<"$(security list-keychains -d user | tr -d '"' | tr '\n' ' ')"
security list-keychains -d user -s "$keychain" "${existing[@]}"
security find-identity -v -p codesigning "$keychain" | grep -q "Developer ID Application: codevo s.r.o. (U574W69TH6)" || { echo "the imported certificate is not the codevo Developer ID Application identity" >&2; exit 1; }
