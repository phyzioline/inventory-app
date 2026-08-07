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

`.github/workflows/tauri-release.yml` now runs this same command automatically on
every tagged release build, so these files do **not** need to be committed — this
step is only needed for a manual/local `npm run build`.

## One-time: updater signing key

Not yet generated (`plugins.updater.pubkey` in `../tauri.conf.json` is still empty,
so the release workflow's builds are unsigned until this is done). On a machine with
Node installed, from `tauri-inventory-app/`:

```bash
npm run tauri signer generate -- -w ~/.tauri/inventory-updater.key
```

Then:
1. Paste the printed **public key** into `../tauri.conf.json` → `plugins.updater.pubkey`.
2. Store the **private key** contents and the password you chose as the GitHub repo
   secrets `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (Settings →
   Secrets and variables → Actions). Never commit the private key file.
