#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# test-endpoints.sh
# Tests: POST /api/users/login  →  GET /api/users  →  GET /api/users/me
# ─────────────────────────────────────────────────────────────────────────────

BASE="http://localhost:8082"
USERNAME="testadmin"
PASSWORD="password"

sep() { echo; echo "══════════════════════════════════════════════════"; }

# ── 1. Login ─────────────────────────────────────────────────────────────────
sep
echo "STEP 1 — POST /api/users/login"
sep

LOGIN_RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE/api/users/login" \
  -X POST \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}")

HTTP_STATUS=$(echo "$LOGIN_RESPONSE" | tail -n1)
BODY=$(echo "$LOGIN_RESPONSE" | sed '$d')

echo "HTTP Status : $HTTP_STATUS"
echo "Response Body (token redacted):"
echo "$BODY" | sed 's/"accessToken":"[^"]*"/"accessToken":"<REDACTED>"/' | \
  python3 -m json.tool 2>/dev/null || echo "$BODY"

if [ "$HTTP_STATUS" != "200" ]; then
  echo "Login failed — aborting."
  exit 1
fi

TOKEN=$(echo "$BODY" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

# ── 2. GET /api/users ─────────────────────────────────────────────────────────
sep
echo "STEP 2 — GET /api/users"
sep

USERS_RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE/api/users" \
  -H "Authorization: Bearer $TOKEN")

HTTP_STATUS=$(echo "$USERS_RESPONSE" | tail -n1)
BODY=$(echo "$USERS_RESPONSE" | sed '$d')

echo "HTTP Status : $HTTP_STATUS"
echo "Response Body:"
echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"

# ── 3. GET /api/users/me ──────────────────────────────────────────────────────
sep
echo "STEP 3 — GET /api/users/me"
sep

ME_RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE/api/users/me" \
  -H "Authorization: Bearer $TOKEN")

HTTP_STATUS=$(echo "$ME_RESPONSE" | tail -n1)
BODY=$(echo "$ME_RESPONSE" | sed '$d')

echo "HTTP Status : $HTTP_STATUS"
echo "Response Body:"
echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"

sep
echo "Done."
