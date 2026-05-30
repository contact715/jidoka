#!/bin/bash
# this project Daily Security Audit
# Run: ./run-security-audit.sh
# Schedule: crontab -e → 0 9 * * * ~/the-app/run-security-audit.sh

PROJECT_DIR="~/the-app"
DATE=$(date +%Y-%m-%d)

# Main report — lives in project root, Claude reads it every session
REPORT_FILE="${PROJECT_DIR}/AUDIT_REPORT.md"

# Archive — keep history for trend comparison
ARCHIVE_DIR="${PROJECT_DIR}/.claude/audit-reports"
mkdir -p "$ARCHIVE_DIR"

# Archive the previous report before overwriting
if [ -f "$REPORT_FILE" ]; then
    PREV_DATE=$(head -5 "$REPORT_FILE" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1)
    if [ -n "$PREV_DATE" ]; then
        cp "$REPORT_FILE" "${ARCHIVE_DIR}/audit-${PREV_DATE}.md"
    else
        cp "$REPORT_FILE" "${ARCHIVE_DIR}/audit-prev.md"
    fi
fi

# Load previous report for trend comparison
PREV_CONTEXT=""
if [ -f "$REPORT_FILE" ]; then
    PREV_CONTEXT="

PREVIOUS REPORT (for trend comparison):
$(cat "$REPORT_FILE")
"
fi

# Run Claude Code with the audit prompt
claude "$(cat ${PROJECT_DIR}/security-audit-prompt.md)

Today's date: ${DATE}
${PREV_CONTEXT}

Write the full report to: ${REPORT_FILE}
The report MUST start with '# AUDIT_REPORT' on the first line." \
    --project-dir "$PROJECT_DIR" \
    --allowedTools 'Read,Glob,Grep,Write' \
    --output-format text

echo "Audit complete: ${REPORT_FILE}"
echo "Archive: ${ARCHIVE_DIR}/"
