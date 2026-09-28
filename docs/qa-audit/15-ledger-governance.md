# 15 — Ledger Governance (Bank-grade)

**Repo:** `phyzioline/inventory-app`  
**Path:** `/home/phyzioline-inventory/htdocs/inventory.phyzioline.com`  
**Date:** 2026-09-28  

Never run `php artisan inventory:*` from `phyzioline.com` (monolith). Always:

```bash
cd /home/phyzioline-inventory/htdocs/inventory.phyzioline.com
pwd && git remote -v   # inventory-app.git
```

---

## G0 — Ops path

| Item | Status |
|------|--------|
| Remap repair command on inventory-app | Done — orphans cleared |
| Documented in `CLAUDE.md` | Done |
| Wrong-project symptom | `Command … is not defined` + monolith suggests `inventory:check-low-stock` |

---

## G1 — Purchase receive ledger

### Invariant

For `status=received` batches with mapped `sku_id`:

`Σ received_quantity (by sku) == net(IN − OUT)` on `inventory_transactions` where `reference` is `PurchaseBatch` (or legacy Modules morph).

### Commands

| Command | Writes stock? | Purpose |
|---------|---------------|---------|
| `inventory:audit-purchase-receive-ledger` | No | Classify drift |
| `inventory:repair-received-purchase-sku-remap` | Orphans only | Remove excess |

### Categories

| Category | Meaning | Auto-fix? |
|----------|---------|-------------|
| `orphan_excess` | Posted > 0 but lines claim 0 (remap leftover) | Yes via remap repair |
| `over_posted` | Posted > expected on current SKU | Remap repair (negative delta) |
| `multi_sku_batch` | Orphan in multi-SKU batch | Remap repair |
| `shortfall_zero_posted` | Line qty > 0, ledger 0 | **Never** auto-fill |
| `shortfall_partial` | Line qty > posted > 0 | Manual review |
| `legacy_morph_candidate` | Shortfall + old Modules reference_type | Normalize morph first |

### Runtime gates

| Hook | Rule |
|------|------|
| `receiveBatch` | Full assert — new receives must be clean |
| `updateBatch` (received) | Orphans-only assert — blocks new remap orphans; allows legacy shortfalls |

---

## G2 — Critical stock path matrix

| Path | Entry | Guard / idempotency | Residual risk | Severity |
|------|-------|---------------------|---------------|----------|
| Marketplace import OUT | `MarketplaceImportService` | Lock + `hasPriorImportedOrderDeduction` + unique OUT index | SKU drift / merchant split | P0 monitored |
| Sales order edit | `InventoryOrderMutationService` | Old vs new qty by SKU | Picker without SKU blocked in UI | P1 |
| Purchase receive | `PurchaseImportService::receiveBatch` | Ledger assert after receive | Legacy dirty batches | P0 gated |
| Purchase received edit | `PurchaseImportController::updateBatch` | Reverse old SKU then apply; orphans assert | Legacy shortfalls remain | P0 gated |
| Customer returns | `InventoryReturnMutationService` | Status transitions + stock IN | Refund/treasury sync edge cases | P0 |
| Transfers | `InventoryTransactionController` | Location pair | Silent short if validation weak | P1 |
| Assemblies | composition pack/unpack | Component OUT / finished IN | Ratio mismatches | P1 |
| Adjustments | adjustments API | Reason + loss amount | Shown outside official P&L (by design) | P2 |

---

## G3 — Money / KPI source of truth

| UI surface | Source of truth | Label |
|------------|-----------------|-------|
| Dashboard net profit | `/reports/profit-summary` | Official (Profit Engine) |
| Period KPIs — top strip | `/reports/profit-summary` | Official net profit |
| Period KPIs — cash strip | `/reports/cash-profit-snapshot` | **Cash period result** (not official) |
| ROI + 3 ratios | `/reports/roi-metrics` → wraps `getProfitSummary` | Official; purchases ≠ COGS |
| Capital Management P&L | `/reports/roi-metrics` | Official |
| ProfitSnapshotKpis | `/reports/profit-summary` | Official |
| Reconciliation “net” | Settlement summary | **Settlement net** (fees/refunds) — not company P&L |
| Return analytics net | Client estimate | Product estimate — not official |

Canonical formula:  
`revenue (settlement net if any) − unit COGS − order refunds − period expenses`.

Purchases (`purchase_batches.grand_total`) = inventory investment only.

---

## G4 — SPA P0 feature matrix

| Feature | APIs | Known lie / note | Severity |
|---------|------|------------------|----------|
| Purchases / smart import | smart-import batches | Legacy shortfalls in audit; edits gated | P0 |
| Sales invoices | `orders` PUT | Must pick SKU | P1 |
| Sheet import | marketplace import | Worker + idempotency required | P0 |
| Settlements | settlement import/reconcile | Settlement net ≠ P&L net | P1 label |
| Returns | returns API | Stock + refund paths | P0 |
| Profit / ROI / dashboard | profit-summary / roi-metrics / cash | Unified accrual; cash renamed | P0 done |
| Warehouses / SKU track | transactions | Running balance is view; source is ledger | P1 |
| Capital / treasury | capital + roi-metrics | P&L from engine; cash tiles separate | P0 done |
| Master products | stock metrics | Linked/kit stock can confuse users | P2 |

---

## G5 — Continuous controls

| Control | Schedule |
|---------|----------|
| `inventory:ensure-queue-healthy` | Every minute |
| `inventory:audit-purchase-receive-ledger` | Daily 02:40 UTC → `storage/logs/purchase-receive-ledger-audit.log` + `…-latest.json` |

Pest: receive ledger assert + classify categories (test DB only).

---

## Policy

1. Do **not** `--also-fill-shortfalls` globally.
2. Do **not** run inventory artisan from phyzioline.com.
3. Do **not** `migrate:fresh` / production wipe.
4. Official “صافي الربح” only from Profit Engine accrual APIs.
