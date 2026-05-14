#!/bin/bash
set -e

# Combine all sources: comments, description, and title
ALL_TEXT="$SYMPHONY_ISSUE_COMMENTS $SYMPHONY_ISSUE_DESCRIPTION $SYMPHONY_ISSUE_TITLE"

# Try multiple patterns to extract MR number:
# 1. GitLab MR URLs: merge_requests/123 or -/merge_requests/123
# 2. MR shorthand: !123, MR:123, MR 123, mr:123, mr#123
# 3. Comment/description text like "merge_request 123" or "MR number: 123"

# Pattern 1: GitLab URL format (most reliable)
MR_NUMBER=$(echo "$ALL_TEXT" | grep -oE 'merge_requests/[0-9]+' | grep -oE '[0-9]+' | tail -1)

# Pattern 2: MR shorthand with bang notation (!123)
if [ -z "$MR_NUMBER" ]; then
  MR_NUMBER=$(echo "$ALL_TEXT" | grep -oE '![0-9]+' | grep -oE '[0-9]+' | tail -1)
fi

# Pattern 3: MR with various separators (MR:123, MR #123, MR-123, mr 123)
if [ -z "$MR_NUMBER" ]; then
  MR_NUMBER=$(echo "$ALL_TEXT" | grep -oiE 'mr[:#\s-]*[0-9]+' | grep -oE '[0-9]+' | tail -1)
fi

# Pattern 4: Generic number in URL path (cvchatapp/-/merge_requests/123)
if [ -z "$MR_NUMBER" ]; then
  MR_NUMBER=$(echo "$ALL_TEXT" | grep -oE 'cvchatapp[^0-9]*[0-9]+' | grep -oE '[0-9]+' | tail -1)
fi

if [ -z "$MR_NUMBER" ]; then
  echo "ERROR: No MR found in issue comments, description, or title"
  echo "SYMPHONY_MR_NOT_FOUND=true"
  echo "SYMPHONY_MR_NUMBER="
  echo "SYMPHONY_PIPELINE_ID="
  echo "SYMPHONY_PIPELINE_STATUS=unknown"
  # Don't exit with error - let the template handle the missing MR gracefully
  exit 0
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
