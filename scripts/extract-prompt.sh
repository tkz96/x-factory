#!/bin/bash
# Extract the prompt for ticket NNN from work-prompts.md -> /tmp/prompt-NNN.txt
# Usage: ./extract-prompt.sh NNN
set -euo pipefail
n="${1:?usage: extract-prompt.sh NNN}"
repo="/Users/talhazuberi/x-factory"
out="/tmp/prompt-${n}.txt"
awk -v ticket="$n" '
  $0 == "<<<PROMPT-" ticket { inside=1; next }
  $0 == "PROMPT-" ticket ">>>" { inside=0; next }
  inside { print }
' "$repo/work-prompts.md" > "$out"
bytes=$(wc -c < "$out" | tr -d ' ')
if [ "$bytes" -lt 100 ]; then
  echo "ERROR: extracted prompt is only ${bytes} bytes — markers not found for #${n}" >&2
  exit 1
fi
echo "extracted ${bytes} bytes -> ${out}"
