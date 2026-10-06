#!/usr/bin/env bash
# MINI eSPORTS — pre-commit hook एक बार में enable करो
set -e
cd "$(dirname "$0")/.."
chmod +x .githooks/pre-commit scripts/version-sync.mjs 2>/dev/null || true
git config core.hooksPath .githooks
echo "✅ Hooks चालू (core.hooksPath = .githooks)"
echo "   अब हर commit पर version-sync अपने-आप चलेगा।"
echo "   जाँच: bash scripts/version-status.sh"
