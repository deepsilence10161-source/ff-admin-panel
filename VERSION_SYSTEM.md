# 🔢 MINI eSPORTS — AUTOMATIC VERSION SYSTEM (2026-10-06)

> **मक़सद:** रिलीज़ पर जो भी नंबर बदलना पड़ता है, वह **भूल जाने पर भी** अपने-आप,
> हर जगह, एक ही बार में बदल जाए — कोई जगह पीछे न छूटे।

---

## 1. कितने नंबर होते हैं और कौन बदलता है

| # | नंबर | कहाँ | कौन बदलता है |
|---|---|---|---|
| 1 | `?v=XXXXXXXX` × ~101 (~81 admin) | `index.html`, `manifest.json`, `js/*.js`, `screens/*.js`, `features/*.js` के अंदर | **`scripts/version-sync.mjs`** (अपने-आप) |
| 2 | `ASSET_VER` | `sw.js` (precache list का stamp) | वही स्क्रिप्ट (index.html के `?v=` के बराबर रखती है) |
| 3 | `CACHE_VER` | `sw.js` (`me-v<commit>-<stamp>`) | वही स्क्रिप्ट — न बढ़े तो पुरानी cache कभी नहीं मिटती |
| 4 | `versionCode` / `versionName` | `android/app/build.gradle` | **पहले से ऑटो** — git commit count से (`1.0.<count>`) |
| 5 | `appLatestVersion` (DB) | `app_settings.live_config` | **GitHub Actions** — APK publish होते ही (`publish-version` job) |
| 6 | `appMinSupportedVersion`, `appForceUpdateEnabled` (DB) | वही टेबल | **कभी ऑटो नहीं** — यह business decision है (force-lock), admin panel से ही |

---

## 2. स्टैम्प का रूप

`YYYYMMDD + अक्षर` → जैसे **`20261006a`**
- उसी दिन दूसरी रिलीज़ = `20261006b` (अपने-आप अगला अक्षर)
- नया दिन = नई तारीख + `a`

---

## 3. रोज़ का इस्तेमाल

```bash
# 1) एक बार: hook चालू करो (हर नई क्लोन पर एक बार)
bash scripts/install-hooks.sh          # core.hooksPath = .githooks

# 2) रोज़: बस commit करो — बाक़ी hook ख़ुद कर देगा
git add -A && git commit -m "fix: ..."  # हुक स्टैम्प बढ़ाकर stage कर देता है
git push

# 3) जाँच कभी भी
node scripts/version-sync.mjs --check   # सब एक जैसा है?
bash scripts/version-status.sh          # एक नज़र में पूरी स्थिति

# 4) हाथ से बढ़ाना हो तो
node scripts/version-sync.mjs --bump
```

---

## 4. तीन परतें (कोई भी एक पकड़ लेगी)

1. **`--check` (जाँच):** सारे stamps एक जैसे हैं? स्टैम्प commit की तारीख से पुराना नहीं?
2. **pre-commit hook:** हर commit पर अपने-आप बढ़ा देता है (भूलने का सवाल ही नहीं)।
3. **CI gate:**
   - User Panel → `build-apk.yml` का step **Version Sync Gate** — नंबर गड़बड़ हो तो
     **बिल्ड वहीं रुक जाती है** (अधूरी/stale release publish नहीं होगी)।
   - Admin Panel → `.github/workflows/version-guard.yml` — हर push पर sync check + smoke tests।

> ⚠️ अगर CI ने gate पर रोक दिया हो, तो बस यह चलाओ और फिर से push करो:
> ```bash
> node scripts/version-sync.mjs --bump
> git add -A && git commit -m "chore(version): stamp bump" && git push
> ```

---

## 5. क्या यह स्क्रिप्ट कभी गलत चीज़ नहीं छूती?

- **कमेंट के अंदर लिखा इतिहास** (जैसे `sw.js` में “पहले `?v=20260828a` stale था”)
  **नहीं बदलता** — इसके लिए सही tokenizer/mask लगा है (JS/HTML/JSON तीनों के लिए)।
- `tests/` और `docs/` फ़ोल्डर **छोड़ दिए जाते हैं** (टेस्ट की अपेक्षाएँ न बिगड़ें)।
- बाहरी (external CDN) URL में `?v=` कहीं नहीं है — फिर भी स्क्रिप्ट सिर्फ़ अपने फ़ाइलों के
  patterns बदलती है।
- `sw.js` में `LOCAL_FILES` (precache सूची) की पूर्णता भी जाँच लो — index.html में जो लोकल
  JS/CSS हो, वह सूची में भी हो, वरना offline में 404।

---

## 6. सत्यापन लॉग (2026-10-06)

- `--check` पहले **FAIL** दिया (5 अलग stamps: `20261003a/d/e/g` + `me-v63-10-03f`) → साबित
  हुआ कि gate असली गड़बड़ पकड़ता है।
- `--bump` के बाद user panel में 12 फ़ाइलें, admin में 5 — सब `20261006a` पर; diff में
  **सिर्फ़ नंबर** बदले (127 बदले/127 लगे), इतिहास वाले कमेंट सुरक्षित।
- `--check` अब **PASS**, `node --check` सभी JS पर ✅, `manifest.json` valid ✅,
  YAML valid ✅, smoke tests: user **51/0**, admin **33/0**।
- `appLatestVersion` लाइव DB में `1.0.109` → `1.0.111` कर दिया (APK v1.0.111 के मुताबिक़)।
- Admin के guard का **असली ब्राउज़र E2E**: form पुराना होने पर भी डेटाबेस की बड़ी value
  (`1.0.111`) ही सेव हुई, शून्य JS error।
