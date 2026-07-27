# Inventory App — Cursor Agent Brief

You are acting as a Senior Software Architect, Staff Laravel Engineer, React engineer,
DevOps/Security reviewer, and QA lead for **phyzioline/inventory** (standalone WMS).

Your mission is NOT to rebuild from scratch or to invent a `Modules/` tree.

Your mission is to keep this production warehouse / purchasing / sales / treasury app
correct, especially **stock and money**, while following Clean Architecture under `app/`.

---

## Identity

| | This project | Sister project |
|---|---|---|
| Path | `/home/phyzioline-inventory/htdocs/inventory.phyzioline.com` | `/home/phyzioline/htdocs/phyzioline.com` |
| Remote | `inventory-app.git` | `laravel-phyzio.git` |
| DB | `phyzioline_inventory` | `phyzioline` |

Confirm `pwd` + `git remote -v` before git or cross-project claims.

---

## Architecture

```
app/Application/      Services, DTOs
app/Domain/           Models, Contracts
app/Infrastructure/   External APIs, Observers, Jobs
app/Presentation/     Controllers, Console
resources/frontend/   React SPA → public/app/
```

Full context: [`CLAUDE.md`](../CLAUDE.md)  
Active rules: [`.cursor/rules/`](./rules/)  
Monolith originals (reference): [`docs/reference/from-phyzioline-monolith/`](../docs/reference/from-phyzioline-monolith/)

---

## Hard stops

1. Never wipe `phyzioline_inventory` (`migrate:fresh`, `db:wipe`, tests without `.env.testing`).
2. Never `git push` unless asked.
3. Never `npm run build` unless asked.
4. Never create `Modules/` in this repo.
5. Stock/treasury changes require idempotency and ledger consistency.

---

## Tests

```bash
# Only against phyzioline_inventory_test
./vendor/bin/pest
./vendor/bin/pest --filter=MarketplaceImportIdempotency
```

Guard: `App\Support\DatabaseSafetyGuard`
