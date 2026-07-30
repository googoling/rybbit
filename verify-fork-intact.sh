#!/usr/bin/env bash
# Prove no customization was lost in an upstream merge.
#
#   ./verify-fork-intact.sh <old-upstream-tag> <pre-merge-ref>
#   ./verify-fork-intact.sh v2.7.0 my-main
#
# Computes every line our fork ADDED on top of the previous upstream release, then checks each
# one still exists in the working tree. Files reported CHECK are not necessarily broken — an
# intentional relocation (moving code to a new module) shows up here too — but every CHECK must
# be explained before shipping. Nothing silently disappears.
set -uo pipefail

OLD_TAG="${1:-}"
PRE_MERGE="${2:-my-main}"

if [ -z "$OLD_TAG" ]; then
  echo "usage: $0 <old-upstream-tag> [pre-merge-ref]" >&2
  exit 2
fi

cd "$(dirname "$0")"

# Generated/derived files: verified separately (rebuild + key-count), not line-by-line.
SKIP_RE='client/messages/|server/public/script|package-lock.json'

echo "Fork-integrity sweep: customizations in ${OLD_TAG}..${PRE_MERGE} vs working tree"
echo

echo "== 1. Files we ADDED =="
missing_added=0
while read -r f; do
  [ -z "$f" ] && continue
  if [ ! -e "$f" ]; then
    echo "  MISSING: $f"
    missing_added=$((missing_added + 1))
  fi
done < <(git diff --name-only --diff-filter=A "$OLD_TAG" "$PRE_MERGE" | grep -Ev "$SKIP_RE")
echo "  missing: $missing_added  (a renamed file counts here — confirm the new name exists)"
echo

echo "== 2. Files we MODIFIED (line-level) =="
check_files=0
while read -r f; do
  [ -z "$f" ] && continue
  added=$(git diff "$OLD_TAG" "$PRE_MERGE" -- "$f" \
    | grep -E '^\+[^+]' \
    | sed 's/^+//; s/^[[:space:]]*//; s/[[:space:]]*$//' \
    | grep -E '.{16,}' | sort -u)
  [ -z "$added" ] && continue

  total=0; found=0; miss=""
  while IFS= read -r line; do
    total=$((total + 1))
    # `--` is REQUIRED: added lines often start with "-", which grep would read as a flag.
    if grep -qF -- "$line" "$f" 2>/dev/null; then
      found=$((found + 1))
    else
      miss="${miss}
      > ${line}"
    fi
  done <<< "$added"

  if [ "$found" -eq "$total" ]; then
    printf "  OK    %-54s %d/%d\n" "$f" "$found" "$total"
  else
    printf "  CHECK %-54s %d/%d%s\n" "$f" "$found" "$total" "$miss"
    check_files=$((check_files + 1))
  fi
done < <(git diff --name-only --diff-filter=M "$OLD_TAG" "$PRE_MERGE" | grep -Ev "$SKIP_RE")

echo
echo "== Summary =="
echo "  added files missing : $missing_added"
echo "  modified files to explain: $check_files"
echo
echo "For each CHECK, locate the code in its new home and diff it, e.g.:"
echo "  grep -rn '<distinctive string>' server/src client/src"
echo "Only sign off when every CHECK is a known relocation with equivalent logic."
