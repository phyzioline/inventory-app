# Inventory — Database Migrations

**Path:** `Modules/Inventory/database/migrations/`  
**Synced from:** `database/migrations/` (WMS, treasury, marketplace channels — not Ecommerce `products`/`orders`).

## Sync

```bash
php Modules/Inventory/app/Infrastructure/Migration/run-external-migration.php
# or
php artisan inventory:collect-migrations --force
```

## Test schema (no migrate:fresh)

```bash
php artisan migrate --path=Modules/Inventory/database/migrations --env=testing
./vendor/bin/pest Modules/Inventory/tests/
```

See workspace rule: **no `migrate:fresh`** on shared PostgreSQL.

## Tables

`channels`, `skus`, `master_products`, `inventory_orders`, `inventory_returns`, `settlements`, `treasury_*`, `purchase_batches`, …
