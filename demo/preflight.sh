#!/usr/bin/env bash
# preflight.sh — run this before the demo to catch problems early
# Usage: bash preflight.sh

set -euo pipefail

RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[0;33m'
NC='\033[0m'

PASS=0
WARN=0
FAIL=0

ok()   { echo -e "  ${GRN}✓${NC}  $1"; ((PASS++)); }
warn() { echo -e "  ${YLW}⚠${NC}  $1"; ((WARN++)); }
fail() { echo -e "  ${RED}✖${NC}  $1"; ((FAIL++)); }

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  FusionAuth × Discord — Demo Preflight   ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Load .env if present ───────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  ok ".env file found and loaded"
else
  fail ".env file not found — copy .env.example to .env and fill in credentials"
fi

echo ""
echo "── Environment ────────────────────────────"

# Check Discord credentials
if [[ -n "${DISCORD_CLIENT_ID:-}" ]]; then
  ok "DISCORD_CLIENT_ID is set (${DISCORD_CLIENT_ID:0:6}...)"
else
  fail "DISCORD_CLIENT_ID is not set"
fi

if [[ -n "${DISCORD_CLIENT_SECRET:-}" ]]; then
  ok "DISCORD_CLIENT_SECRET is set"
else
  fail "DISCORD_CLIENT_SECRET is not set"
fi

echo ""
echo "── FusionAuth ─────────────────────────────"

FA_URL="http://localhost:9011"
FA_API_KEY="bf69486b-4056-4049-a0a3-discord-demo-key"

# Check FusionAuth is reachable
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$FA_URL/api/status" 2>/dev/null || echo "000")
if [[ "$HTTP_STATUS" == "200" ]]; then
  ok "FusionAuth is running at $FA_URL"
else
  fail "FusionAuth is NOT reachable at $FA_URL (HTTP $HTTP_STATUS) — run: docker compose up -d"
fi

# Check API key works
if [[ "$HTTP_STATUS" == "200" ]]; then
  KEY_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: $FA_API_KEY" \
    "$FA_URL/api/identity-provider" 2>/dev/null || echo "000")
  if [[ "$KEY_STATUS" == "200" ]]; then
    ok "API key is valid"
  else
    fail "API key not accepted (HTTP $KEY_STATUS) — check kickstart ran correctly"
  fi

  # Check if Discord IdP already exists
  IDP_RESPONSE=$(curl -s \
    -H "Authorization: $FA_API_KEY" \
    "$FA_URL/api/identity-provider" 2>/dev/null || echo "{}")
  DISCORD_COUNT=$(echo "$IDP_RESPONSE" | grep -c '"Discord"' 2>/dev/null || echo "0")
  if [[ "$DISCORD_COUNT" -gt 0 ]]; then
    ok "Discord IdP is provisioned"
  else
    warn "Discord IdP not found — run the setup script: cd ../setup && node setup.js"
  fi

  # Check demo application exists
  APP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: $FA_API_KEY" \
    "$FA_URL/api/application/e9fdb985-9173-4e01-9d73-ac2d60d1dc8e" 2>/dev/null || echo "000")
  if [[ "$APP_STATUS" == "200" ]]; then
    ok "Demo application is configured"
  else
    fail "Demo application not found — Kickstart may not have run correctly"
  fi
fi

echo ""
echo "── Dependencies ───────────────────────────"

# Node.js
if command -v node &>/dev/null; then
  NODE_VER=$(node --version)
  ok "Node.js $NODE_VER"
else
  fail "Node.js not found — install from https://nodejs.org"
fi

# npm deps for setup script
if [[ -d "$SCRIPT_DIR/../setup/node_modules" ]]; then
  ok "Setup script dependencies installed"
else
  warn "Setup script npm deps not installed — run: cd ../setup && npm install"
fi

# Docker / OrbStack
if command -v docker &>/dev/null; then
  ok "Docker CLI available"
else
  warn "Docker CLI not found (fine if OrbStack is running via its own CLI)"
fi

echo ""
echo "── Demo login URL ─────────────────────────"
LOGIN_URL="${FA_URL}/oauth2/authorize?client_id=e9fdb985-9173-4e01-9d73-ac2d60d1dc8e&response_type=code&redirect_uri=${FA_URL}/oauth2/callback&scope=openid"
echo "  ${LOGIN_URL}"
echo ""

# ── Summary ────────────────────────────────────────────────────────────────
echo "══════════════════════════════════════════"
if [[ $FAIL -gt 0 ]]; then
  echo -e "  ${RED}✖  $FAIL issue(s) must be fixed before demoing${NC}"
  echo -e "  ${GRN}✓  $PASS passed${NC}  ${YLW}⚠  $WARN warning(s)${NC}"
  echo ""
  exit 1
elif [[ $WARN -gt 0 ]]; then
  echo -e "  ${YLW}⚠  $WARN warning(s) — demo may be incomplete${NC}"
  echo -e "  ${GRN}✓  $PASS passed${NC}"
else
  echo -e "  ${GRN}✓  All checks passed — you're good to go!${NC}"
fi
echo ""
