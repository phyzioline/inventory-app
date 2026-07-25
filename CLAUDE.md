# Project identity — READ FIRST

**This is `inventory-app`**, not `laravel-phyzio`. Two separate projects live on this
machine and are easy to confuse in a chat session:

| | This project | The other project |
|---|---|---|
| Name | `phyzioline/inventory` | `laravel/laravel` (phyzioline.com main site) |
| Purpose | Standalone warehouse, purchasing, sales and treasury management app — extracted from the Phyzioline monolith's Inventory module | Phyzioline's main e-commerce site |
| Path | `/home/phyzioline-inventory/htdocs/inventory.phyzioline.com` | `/home/phyzioline/htdocs/phyzioline.com` |
| Git remote | `github.com/phyzioline/inventory-app.git` | `github.com/phyzioline/laravel-phyzio.git` |
| APP_URL | `https://inventory.phyzioline.com` | `https://phyzioline.com` |

Before running `git commit` / `git push`, or making claims about "the Ecommerce module",
"Modules/...", or anything that sounds like the main site — confirm with `pwd` and
`git remote -v` that you're actually in this repo and not the other one. This app has
no `Modules/Ecommerce` directory; if that path comes up, you're likely looking at
`laravel-phyzio` instead.

# Structure

Standard Laravel app (no module packages) — `app/`, `routes/`, `database/`, `resources/`.
Also contains `tauri-inventory-app/` — a separate Tauri (Rust + web) desktop client in
its own `package.json`/`src-tauri`, distinct from the Laravel backend above it.
