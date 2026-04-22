#!/usr/bin/env bash
# DOZZZE end-to-end demo — starts the coordinator, submits a job via curl,
# and polls for the stored result. Requires a built repo (`npm run build`).
#
# Ollama does NOT need to be running for this demo — we submit directly to the
# coordinator and simulate a node by POSTing a hand-crafted result. To see a
# real node doing the inference, start Ollama + `dozzze start` in another
# terminal and the submitted job will be routed to it instead.

set -euo pipefail

COORD_PORT="${COORD_PORT:-8787}"
COORD_URL="http://127.0.0.1:${COORD_PORT}"

cleanup() {
  if [[ -n "${COORD_PID:-}" ]] && kill -0 "$COORD_PID" 2>/dev/null; then
    kill "$COORD_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Boot coordinator in the background.
echo "▸ starting coordinator on :$COORD_PORT"
node packages/coordinator/dist/cli.js --port "$COORD_PORT" --host 127.0.0.1 >/tmp/dozzze-coord.log 2>&1 &
COORD_PID=$!
sleep 1

if ! kill -0 "$COORD_PID" 2>/dev/null; then
  echo "× coordinator failed to start — see /tmp/dozzze-coord.log"
  exit 1
fi

echo "● coordinator pid $COORD_PID"
echo
echo "▸ GET /health"
curl -s "$COORD_URL/health" | jq .
echo
echo "▸ POST /submit"
SUBMIT=$(curl -s -X POST "$COORD_URL/submit" \
  -H "content-type: application/json" \
  -d '{"protocolVersion":1,"kind":"completion","model":"llama3.2","prompt":"Summarize DOZZZE in one sentence.","payout":0.01}')
echo "$SUBMIT" | jq .
JOB_ID=$(echo "$SUBMIT" | jq -r .job.id)
echo "● job id: $JOB_ID"
echo
echo "▸ GET /poll/DEMO-NODE"
curl -s "$COORD_URL/poll/DEMO-NODE" | jq .
echo
echo "▸ POST /report (simulating a node completing the job)"
curl -s -X POST "$COORD_URL/report" \
  -H "content-type: application/json" \
  -d "$(cat <<EOF
{
  "result": {
    "jobId": "$JOB_ID",
    "protocolVersion": 1,
    "nodeId": "DEMO-NODE",
    "output": "DOZZZE routes idle AI compute to Solana memecoin traders.",
    "tokensIn": 8,
    "tokensOut": 11,
    "durationMs": 140,
    "payout": 0.019,
    "completedAt": $(date +%s%3N)
  }
}
EOF
)" | jq .
echo
echo "▸ GET /result/$JOB_ID"
curl -s "$COORD_URL/result/$JOB_ID" | jq .
echo
echo "▸ GET /health"
curl -s "$COORD_URL/health" | jq .
echo
echo "● demo finished — coordinator will shut down on exit"
