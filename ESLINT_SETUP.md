# Admin Panel v21 — ESLint + Prettier Setup (Bug#114 Fix)

## Setup
```bash
cd Admin_v21_FIXED
npm init -y
npm install --save-dev eslint prettier eslint-config-prettier
```

## Lint
```bash
npx eslint js/**/*.js
```

## Format
```bash
npx prettier --write js/**/*.js
```

## VSCode
Install extensions: ESLint + Prettier - Code formatter
Add to .vscode/settings.json:
```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode"
}
```

## Known suppressed rules
- `no-undef` is a WARN (not error) because many globals like rtdb, auth 
  are set up dynamically via Firebase SDK.
- `no-unused-vars` is a WARN because some functions are exposed on window
  and called from HTML onclick attributes.
