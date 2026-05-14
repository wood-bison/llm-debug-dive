#!/usr/bin/env bash
# Smoke-test for the LLM Debug Dive proxy. Covers:
#   1. Health endpoint
#   2. OpenAI route       /v1/chat/completions → api.openai.com
#   3. Anthropic route    /v1/messages         → api.anthropic.com
#   4. 404 for unknown paths
#   5. SSE streaming pass-through
#   6. Postgres persistence
#   7. Dashboard page renders
#   8. Trace grouping via x-llm-debug-trace header
#   9. /api/skills endpoint
#  10. /api/tools endpoint
#
# Usage:
#   bun run dev      # in one terminal
#   bun run verify   # in another
#
# Env vars (all optional):
#   OPENAI_API_KEY      — without it test #2 yields 401, still counts as pass
#   ANTHROPIC_API_KEY   — same for test #3 / #5
#   PROXY_URL           — defaults to http://localhost:8787

set -uo pipefail

PROXY_URL="${PROXY_URL:-http://localhost:8787}"
DATABASE_URL="${DATABASE_URL:-postgres://llm_debug:llm_debug@127.0.0.1:55432/llm_debug}"
PASS=0
FAIL=0

c_green() { printf '\033[0;32m%s\033[0m' "$1"; }
c_red()   { printf '\033[0;31m%s\033[0m' "$1"; }
c_dim()   { printf '\033[0;90m%s\033[0m' "$1"; }

check() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "$(c_green '✓') $name $(c_dim "($actual)")"
    PASS=$((PASS+1))
  else
    echo "$(c_red '✗') $name $(c_dim "expected=$expected got=$actual")"
    FAIL=$((FAIL+1))
  fi
}

echo
echo "── proxy smoke-test ── $PROXY_URL"
echo

# ── Test 1: health check ────────────────────────────────────────────────
echo "[1/10] health check  GET $PROXY_URL/"
body=$(curl -sS -o /dev/null -w "%{http_code}" "$PROXY_URL/" || echo "000")
check "health" "200" "$body"

# ── Test 2: OpenAI route ────────────────────────────────────────────────
echo
echo "[2/10] OpenAI route  POST /v1/chat/completions"
if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "$(c_dim '   ⚠ OPENAI_API_KEY not set — expecting 401 from OpenAI')"
  expected="401"
else
  expected="200"
fi
status=$(curl -sS -o /tmp/llm-debug-openai.json -w "%{http_code}" \
  -X POST "$PROXY_URL/v1/chat/completions" \
  -H "Authorization: Bearer ${OPENAI_API_KEY:-fake-key}" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}],"stream":false,"max_tokens":5}' \
  || echo "000")
check "openai forward" "$expected" "$status"
if [[ "$status" == "200" ]]; then
  echo "$(c_dim '   reply:') $(jq -r '.choices[0].message.content // "<no content>"' /tmp/llm-debug-openai.json 2>/dev/null || cat /tmp/llm-debug-openai.json | head -c 120)"
fi

# ── Test 3: Anthropic route ─────────────────────────────────────────────
echo
echo "[3/10] Anthropic route  POST /v1/messages"
if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "$(c_dim '   ⚠ ANTHROPIC_API_KEY not set — expecting 401 from Anthropic')"
  expected="401"
else
  expected="200"
fi
status=$(curl -sS -o /tmp/llm-debug-anthropic.json -w "%{http_code}" \
  -X POST "$PROXY_URL/v1/messages" \
  -H "x-api-key: ${ANTHROPIC_API_KEY:-fake-key}" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":20,"messages":[{"role":"user","content":"hi"}]}' \
  || echo "000")
check "anthropic forward" "$expected" "$status"
if [[ "$status" == "200" ]]; then
  echo "$(c_dim '   reply:') $(jq -r '.content[0].text // "<no content>"' /tmp/llm-debug-anthropic.json 2>/dev/null || cat /tmp/llm-debug-anthropic.json | head -c 120)"
fi

# ── Test 4: bad path ────────────────────────────────────────────────────
echo
echo "[4/10] bad path  GET /v2/ghost"
body=$(curl -sS -o /dev/null -w "%{http_code}" "$PROXY_URL/v2/ghost" || echo "000")
check "404 on unknown path" "404" "$body"

# ── Test 5: SSE streaming ───────────────────────────────────────────────
echo
echo "[5/10] SSE streaming  POST /v1/messages (stream=true)"
if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "$(c_dim '   ⚠ skip — no ANTHROPIC_API_KEY')"
else
  events=$(curl -sS -N -X POST "$PROXY_URL/v1/messages" \
    -H "x-api-key: $ANTHROPIC_API_KEY" \
    -H "anthropic-version: 2023-06-01" \
    -H "Content-Type: application/json" \
    -d '{"model":"claude-haiku-4-5-20251001","max_tokens":20,"stream":true,"messages":[{"role":"user","content":"count 1 2 3"}]}' \
    2>/dev/null | grep -c '^event:' || true)
  if [[ "$events" -ge "3" ]]; then
    check "stream events ≥3" "ok" "ok"
  else
    check "stream events ≥3" "ok" "got=$events"
  fi
fi

# ── Test 6: Postgres persistence ────────────────────────────────────────
echo
echo "[6/10] Postgres persistence"
if command -v psql >/dev/null 2>&1; then
  rows=$(psql "$DATABASE_URL" -Atc "SELECT count(*) FROM spans WHERE started_at > (extract(epoch from now())::bigint - 60) * 1000" 2>/dev/null || echo "0")
elif command -v docker >/dev/null 2>&1; then
  rows=$(docker exec llm-debug-dive-postgres psql -U llm_debug -d llm_debug -Atc "SELECT count(*) FROM spans WHERE started_at > (extract(epoch from now())::bigint - 60) * 1000" 2>/dev/null || echo "0")
else
  rows="0"
  echo "$(c_dim '   ⚠ no psql/docker available for DB check')"
fi
if [[ "$rows" -ge "1" ]]; then
  check "spans written in last 60s ≥1" "ok" "ok"
else
  check "spans written in last 60s ≥1" "ok" "got=$rows"
fi

# ── Test 7: dashboard ───────────────────────────────────────────────────
echo
echo "[7/10] dashboard  GET /dashboard"
body=$(curl -sS -o /tmp/llm-debug-dashboard.html -w "%{http_code}" "$PROXY_URL/dashboard" || echo "000")
check "dashboard html" "200" "$body"
if [[ "$body" == "200" ]]; then
  has_htmx=$(grep -c 'htmx.org' /tmp/llm-debug-dashboard.html 2>/dev/null || echo "0")
  if [[ "$has_htmx" -ge "1" ]]; then
    echo "$(c_dim '   ✓ htmx loaded')"
  fi
fi

# ── Test 8: trace grouping via x-llm-debug-trace ────────────────────────
echo
echo "[8/10] trace grouping (custom header)"
TRACE_ID="verify-$(date +%s)"
for i in 1 2; do
  curl -sS -o /dev/null "$PROXY_URL/v1/messages" \
    -H "x-api-key: fake-key" \
    -H "anthropic-version: 2023-06-01" \
    -H "Content-Type: application/json" \
    -H "x-llm-debug-trace: $TRACE_ID" \
    -d '{"model":"claude-haiku-4-5-20251001","max_tokens":5,"messages":[{"role":"user","content":"hi"}]}' || true
done
if command -v psql >/dev/null 2>&1; then
  group=$(psql "$DATABASE_URL" -Atc "SELECT span_count FROM traces WHERE external_id = 'manual:$TRACE_ID' ORDER BY id DESC LIMIT 1" 2>/dev/null || echo "0")
elif command -v docker >/dev/null 2>&1; then
  group=$(docker exec llm-debug-dive-postgres psql -U llm_debug -d llm_debug -Atc "SELECT span_count FROM traces WHERE external_id = 'manual:$TRACE_ID' ORDER BY id DESC LIMIT 1" 2>/dev/null || echo "0")
else
  group="0"
fi
if [[ "$group" == "2" ]]; then
  check "two requests → one trace (span_count=2)" "ok" "ok"
else
  check "two requests → one trace" "ok" "got span_count=$group"
fi

# ── Test 9: /api/skills ─────────────────────────────────────────────────
echo
echo "[9/10] /api/skills endpoint"
body=$(curl -sS -o /tmp/llm-debug-skills.html -w "%{http_code}" "$PROXY_URL/api/skills?range=24h" || echo "000")
check "skills endpoint" "200" "$body"

# ── Test 10: /api/tools ─────────────────────────────────────────────────
echo
echo "[10/10] /api/tools endpoint"
body=$(curl -sS -o /tmp/llm-debug-tools.html -w "%{http_code}" "$PROXY_URL/api/tools?range=24h" || echo "000")
check "tools endpoint" "200" "$body"

# ── Summary ─────────────────────────────────────────────────────────────
echo
echo "── result ── $(c_green "passed=$PASS")  $(c_red "failed=$FAIL")"
echo
[[ "$FAIL" == "0" ]] && exit 0 || exit 1
