# Mars Dice (火星骰子)

A lightweight Chrome extension that lets you roll a 3D dice on any webpage, customize the six faces with your own images, and dock the widget half-hidden at screen edges.

## Features
- Roll a smooth 3D dice with fair randomness
- Right-click menu to open customization modal
- Upload up to 6 images (auto center-crop to 512×512 PNG)
- Edge peeking: half-hide left or right; click to reveal and roll
- Persistent settings via `chrome.storage.local`

## Installation (Developer Mode)
1. Build not required. Open Chrome and navigate to `chrome://extensions/`.
2. Enable "Developer mode" (top-right toggle).
3. Click "Load unpacked" and select this folder.

## Permissions
- `storage`: Save customized faces and widget position locally
- Content script matches: `https://*/*`, `http://*/*`

## Files
- `manifest.json` — MV3 manifest
- `contentScript.js` — main logic for dice, UI, uploads, and interactions
- `styles.css` — UI styles for dice/menu/modal
- `assets/` — default faces and logo
- `PRIVACY_POLICY.md` — privacy policy (EN + 中文)

## Privacy
No data collection or transmission. All settings and images are stored locally. See `PRIVACY_POLICY.md`.

## License
MIT
