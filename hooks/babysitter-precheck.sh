#!/bin/bash
set -e

MR_NUMBER=$(grep -oP '(?:merge_requests?|mr|!)[/\s:]?(\d+)' <<< "$SYMPHONY_ISSUE_COMMENTS" 2>/dev/null | grep -oP '\d+' | tail -1)

if [ -z "$MR_NUMBER" ]; then
  MR_NUMBER=$(echo "$SYMPHONY_ISSUE_COMMENTS" | grep -oE '![0-9]+' | grep -oE '[0-9]+' | tail -1)
fi

if [ -z "$MR_NUMBER" ]; then
  echo "ERROR: No MR found in issue comments"
  exit 1
fi

cd ~/workspace/cvchatapp || exit 1

PIPELINE_DATA=$(glab mr view "$MR_NUMBER" --output json 2>/dev/null || echo '{}')
PIPELINE_STATUS=$(echo "$PIPELINE_DATA" | jq -r '.pipeline.status // .head_pipeline.status // "unknown"' 2>/dev/null || echo "unknown")
PIPELINE_ID=$(echo "$PIPELINE_DATA" | jq -r '.pipeline.id // .head_pipeline.id // "0"' 2>/dev/null || echo "0")

echo "[babysitter-precheck] MR: $MR_NUMBER | Pipeline #$PIPELINE_ID | Status: $PIPELINE_STATUS"

echo "SYMPHONY_MR_NUMBER=$MR_NUMBER"
echo "SYMPHONY_PIPELINE_ID=$PIPELINE_ID"
echo "SYMPHONY_PIPELINE_STATUS=$PIPELINE_STATUS"

if [ "$PIPELINE_STATUS" = "success" ]; then
  echo "SYMPHONY_PIPELINE_ALREADY_PASSED=true"
  echo "[babysitter-precheck] Pipeline already passed - agent will handover immediately"
  exit 0
fi

if [ "$PIPELINE_STATUS" = "failed" ] || [ "$PIPELINE_STATUS" = "error" ]; then
  echo "SYMPHONY_PIPELINE_FAILED=true"
  echo "[babysitter-precheck] Pipeline failed - agent will analyze failure"
  exit 0
fi

if [ "$PIPELINE_STATUS" = "running" ] || [ "$PIPELINE_STATUS" = "pending" ]; then
  echo "SYMPHONY_PIPELINE_RUNNING=true"
  echo "[babysitter-precheck] Pipeline running - agent will monitor with timeout"
  exit 0
fi

echo "[babysitter-precheck] Unknown status, proceeding normally"
exit 0
