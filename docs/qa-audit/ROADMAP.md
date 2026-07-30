# QA & Audit Roadmap

## Done — all 10 agents + Phases A/B/C implementation (2026-07-30)

### Audit reports
- [x] 01–10 under `docs/qa-audit/`
- [x] 11-phase-b-notes.md
- [x] 12-staff-rbac-design.md

### Phase A (P0)
- [x] ProfitDistribution + IsIsolatedByUser
- [x] regenerate-master-products behind super.admin (no client user_id)
- [x] Supplier pay → TreasurySpendGuard + Payment
- [x] Morph map `App\Models\Inventory\InventoryOrder`
- [x] MarketplaceImportIdempotencyTest green + ChannelStockResolver::clearCache
- [x] PhaseASecurityAndTreasuryTest

### Phase B (P1)
- [x] Sulfa repay SpendGuard
- [x] Gemini API key via header
- [x] SPA 401→login + upload timeout 600s
- [x] TransferStockRequest + StorePurchaseBatchRequest
- [x] ProcessMarketplaceImportJob + async import + job status
- [x] Destructive Gates (cancel/approve/delete/rollback)

### Phase C
- [x] balance_after column + write on import OUT / transfer
- [x] SoftDeletes on MasterProduct, Sku, Customer, Supplier
- [x] Soft-delete-aware SKU unique index
- [x] inventory_audit_logs + InventoryAuditLogService (cancel/rollback)
- [x] Reports loading/error UI; ProfitEngine loading for by-period
- [x] Staff RBAC design doc only

## Pest baseline

`./vendor/bin/pest` → **57 passed** on `phyzioline_inventory_test` after Phase C.

## Shipped

- [x] Frontend production build (`resources/frontend` → `public/app/`) — 2026-07-30 evening

## Later (pick next)

1. Staff RBAC implementation (see 12-staff-rbac-design.md)
2. Full SPA adoption of async marketplace import (polling UI)
3. More Form Requests / fat-controller splits
4. Feature gaps: cycle count, lot/serial, FBA/FBM pages
5. git commit (when you ask)

## Operating rules

```bash
pwd && git remote -v
grep DB_DATABASE .env.testing phpunit.xml
# Never: migrate:fresh on phyzioline_inventory
```
