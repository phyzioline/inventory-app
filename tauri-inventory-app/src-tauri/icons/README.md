# Tauri App Icons

Run the following command to auto-generate all required icon sizes from the Phyzioline logo:

```bash
cd tauri-app
npm install
npx tauri icon ../public/web/assets/images/phyzioline-logo.png
```

This generates:
- 32x32.png
- 128x128.png
- 128x128@2x.png
- icon.icns   (macOS)
- icon.ico    (Windows)
- tray.png    (16x16, system tray)

Required before running `npm run build`.
