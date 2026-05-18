#!/usr/bin/env bash

readonly POSTGRES_READY_ATTEMPTS=30
readonly POSTGRES_READY_INTERVAL_SECONDS=1
readonly PROXY_SHUTDOWN_ATTEMPTS=5
readonly PROXY_START_ATTEMPTS=5
readonly PROXY_RETRY_INTERVAL_SECONDS=1
readonly DEFAULT_FALLBACK_PORT=8789
readonly FALLBACK_PORT_START=8790
readonly FALLBACK_PORT_END=8799

default_database_url() {
  echo "postgres://llm_debug:llm_debug@127.0.0.1:55432/llm_debug"
}

open_dashboard() {
  local url="$1"
  local enabled="${2:-1}"
  [[ "$enabled" != "1" ]] && return 0
  if command -v open >/dev/null 2>&1; then
    open "$url" 2>/dev/null || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" 2>/dev/null || true
  fi
}

ensure_postgres() {
  local repo_dir="$1"
  local database_url="${DATABASE_URL:-$(default_database_url)}"
  local attempt

  if [[ "$database_url" != postgres://llm_debug:llm_debug@127.0.0.1:55432/llm_debug ]]; then
    echo "✓ DATABASE_URL provided; using external Postgres"
    return 0
  fi

  if ! command -v docker >/dev/null 2>&1; then
    echo "✗ docker not found. LLM Debug Dive now uses Postgres; install Docker or set DATABASE_URL." >&2
    exit 1
  fi

  (cd "$repo_dir" && docker compose up -d postgres >/dev/null)

  echo -n "⏳ Postgres"
  for ((attempt = 0; attempt < POSTGRES_READY_ATTEMPTS; attempt++)); do
    if (cd "$repo_dir" && docker compose exec -T postgres pg_isready -U llm_debug -d llm_debug >/dev/null 2>&1); then
      echo " · ready"
      return 0
    fi
    echo -n "."
    sleep "$POSTGRES_READY_INTERVAL_SECONDS"
  done

  echo " · not ready"
  echo "✗ Postgres failed to become healthy. Check: cd $repo_dir && docker compose logs postgres" >&2
  exit 1
}

build_proxy() {
  local repo_dir="$1"
  local bun_bin="$2"

  echo "🔧 Building proxy…"
  (cd "$repo_dir" && "$bun_bin" run build >/dev/null)
}

port_busy() {
  lsof -ti ":$1" -sTCP:LISTEN >/dev/null 2>&1
}

port_pids() {
  lsof -ti ":$1" -sTCP:LISTEN 2>/dev/null || true
}

is_llm_debug_proxy() {
  local url="$1"
  curl -sf "$url/" 2>/dev/null | grep -q 'llm-debug-dive'
}

stop_proxy_on_port() {
  local proxy_port="$1"
  local pids
  local attempt
  pids="$(port_pids "$proxy_port")"
  [[ -z "$pids" ]] && return 0

  echo "♻ Restarting old LLM Debug Dive proxy on :${proxy_port}"
  kill $pids 2>/dev/null || true
  for ((attempt = 0; attempt < PROXY_SHUTDOWN_ATTEMPTS; attempt++)); do
    port_busy "$proxy_port" || return 0
    sleep "$PROXY_RETRY_INTERVAL_SECONDS"
  done
  kill -KILL $pids 2>/dev/null || true
}

ensure_proxy() {
  local repo_dir="$1"
  local bun_bin="$2"
  local proxy_hostname="$3"
  local proxy_port="$4"
  local open_browser="$5"
  local fallback_port="${LLM_DEBUG_FALLBACK_PORT:-$DEFAULT_FALLBACK_PORT}"
  local proxy_url="http://${proxy_hostname}:${proxy_port}"
  local candidate
  local attempt

  cd "$repo_dir"
  [[ -d node_modules ]] || "$bun_bin" install --silent
  ensure_postgres "$repo_dir"
  build_proxy "$repo_dir" "$bun_bin"

  if port_busy "$proxy_port"; then
    if is_llm_debug_proxy "$proxy_url"; then
      stop_proxy_on_port "$proxy_port"
    else
      echo "⚠ :${proxy_port} is occupied by another process; looking for a free proxy port"
      proxy_port=""
      if ! port_busy "$fallback_port"; then
        proxy_port="$fallback_port"
      fi
      if [[ -z "$proxy_port" ]]; then
        for ((candidate = FALLBACK_PORT_START; candidate <= FALLBACK_PORT_END; candidate++)); do
          if ! port_busy "$candidate"; then
            proxy_port="$candidate"
            break
          fi
        done
      fi
      [[ -n "$proxy_port" ]] || { echo "✗ no free proxy port found in ${DEFAULT_FALLBACK_PORT}-${FALLBACK_PORT_END}" >&2; exit 1; }
      proxy_url="http://${proxy_hostname}:${proxy_port}"
    fi
  fi

  if ! port_busy "$proxy_port"; then
    echo "🚀 Starting llm-debug-dive proxy on :${proxy_port}…"
    nohup env \
      PROXY_PORT="${proxy_port}" \
      PROXY_HOSTNAME="${proxy_hostname}" \
      DATABASE_URL="${DATABASE_URL:-$(default_database_url)}" \
      "$bun_bin" run dist/proxy.js > /tmp/llm-debug-proxy.log 2>&1 &
    echo "   pid=$! · log=/tmp/llm-debug-proxy.log"
    for ((attempt = 0; attempt < PROXY_START_ATTEMPTS; attempt++)); do
      curl -sfo /dev/null "${proxy_url}/" && break
      sleep "$PROXY_RETRY_INTERVAL_SECONDS"
    done
    curl -sfo /dev/null "${proxy_url}/" || { echo "✗ proxy failed to start; see /tmp/llm-debug-proxy.log" >&2; exit 1; }
  else
    echo "✓ Proxy ready on :${proxy_port}"
  fi

  echo "✓ Dashboard: ${proxy_url}/dashboard"
  open_dashboard "${proxy_url}/dashboard" "$open_browser"
  printf '%s\n' "$proxy_url" > /tmp/llm-debug-last-url
}

last_proxy_url() {
  cat /tmp/llm-debug-last-url 2>/dev/null || true
}
