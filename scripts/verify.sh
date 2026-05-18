#!/usr/bin/env bash

set -uo pipefail

PROXY_URL="${PROXY_URL:-http://127.0.0.1:8787}"
readonly CURL_CONNECT_TIMEOUT_SECONDS=2
readonly CURL_MAX_TIMEOUT_SECONDS=8
readonly HTTP_OK=200
readonly HTTP_BAD_REQUEST=400
PASS=0
FAIL=0

check() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    printf '✓ %s (%s)\n' "$name" "$actual"
    PASS=$((PASS + 1))
  else
    printf '✗ %s (expected %s, got %s)\n' "$name" "$expected" "$actual"
    FAIL=$((FAIL + 1))
  fi
}

status() {
  curl --silent --show-error --connect-timeout "$CURL_CONNECT_TIMEOUT_SECONDS" --max-time "$CURL_MAX_TIMEOUT_SECONDS" --output "$2" --write-out '%{http_code}' "$1" 2>/dev/null || true
}

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

printf 'Local smoke checks: %s\n' "$PROXY_URL"

code="$(status "$PROXY_URL/" "$TMP_DIR/root")"
check 'health route' "$HTTP_OK" "$code"

code="$(status "$PROXY_URL/api/v1/meta" "$TMP_DIR/meta.json")"
check 'versioned API metadata' "$HTTP_OK" "$code"
if [[ "$code" == "$HTTP_OK" ]] && grep -q '"providers"' "$TMP_DIR/meta.json" && grep -q '"defaultRange"' "$TMP_DIR/meta.json"; then
  check 'metadata fields' 'valid' 'valid'
else
  check 'metadata fields' 'valid' 'invalid'
fi

code="$(status "$PROXY_URL/dashboard" "$TMP_DIR/dashboard.html")"
check 'dashboard route' "$HTTP_OK" "$code"
if [[ "$code" == "$HTTP_OK" ]] && grep -q '<div id="root"></div>' "$TMP_DIR/dashboard.html"; then
  check 'dashboard application shell' 'present' 'present'
else
  check 'dashboard application shell' 'present' 'missing'
fi

code="$(status "$PROXY_URL/api/v1/overview?range=1h" "$TMP_DIR/overview.json")"
check 'dashboard data route' "$HTTP_OK" "$code"
if [[ "$code" == "$HTTP_OK" ]] && grep -q '"stats"' "$TMP_DIR/overview.json" && grep -q '"turns"' "$TMP_DIR/overview.json"; then
  check 'dashboard data fields' 'valid' 'valid'
else
  check 'dashboard data fields' 'valid' 'invalid'
fi

asset="$(grep -oE 'src="[^"]+\.js"' "$TMP_DIR/dashboard.html" | head -n 1 | sed -E 's/^src="([^"]+)"$/\1/')"
if [[ -n "$asset" ]]; then
  code="$(status "$PROXY_URL$asset" "$TMP_DIR/dashboard.js")"
  check 'dashboard JavaScript bundle' "$HTTP_OK" "$code"
else
  check 'dashboard JavaScript bundle reference' 'present' 'missing'
fi

code="$(status "$PROXY_URL/api/v1/traces/invalid" "$TMP_DIR/invalid-trace.json")"
check 'trace input validation' "$HTTP_BAD_REQUEST" "$code"

printf 'Result: passed=%s failed=%s\n' "$PASS" "$FAIL"
[[ "$FAIL" == '0' ]]
