#!/usr/bin/env bash
# MINI eSPORTS — एक नज़र में version स्थिति (कहीं कुछ छूटा तो पकड़ लो)
cd "$(dirname "$0")/.."
echo "════════════════════════════════════════════════"
echo " MINI eSPORTS — VERSION STATUS"
echo "════════════════════════════════════════════════"
echo "commit संख्या  : $(git rev-list --count HEAD)"
echo "index.html ?v=: $(grep -o '?v=[0-9a-z]*' index.html 2>/dev/null | sort -u | tr '\n' ' ')"
echo "sw.js         : $(grep -E "var (ASSET_VER|CACHE_VER)" sw.js 2>/dev/null | tr -s ' ' | tr '\n' ' ')"
echo "manifest.json : $(grep -o '?v=[0-9a-z]*' manifest.json 2>/dev/null | sort -u | tr '\n' ' ')"
echo "------------------------------------------------"
node scripts/version-sync.mjs --check --quiet && echo "स्थिति        : ✅ सब एक जैसा" || echo "स्थिति        : ❌ MATCH नहीं"
