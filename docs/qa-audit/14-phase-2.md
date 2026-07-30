# 14 — Phase 2 (scaffolding)

**Status:** Foundation shipped 2026-07-30 — **no auto-PR without human review**.

## What Phase 2 means here

| Capability | Status |
|------------|--------|
| Propose remaining patches from scorecard | `php artisan inventory:qa-propose-patches` |
| Optional Pest stubs | `--write-stubs` → `tests/Feature/Proposed/*` (incomplete until filled) |
| Auto-merge / auto-push PRs | **Out of scope** — human review required |
| Clear P0 patches already implemented | Paymob HMAC Pest, LowStock service/API/UI, broader audit logs |

## Commands

```bash
php artisan inventory:qa-propose-patches
php artisan inventory:qa-propose-patches --write-stubs
# Then implement stubs, move out of Proposed/, run:
grep DB_DATABASE .env.testing phpunit.xml
./vendor/bin/pest
```

## Shipped in this Phase 2 kickoff

1. `PaymobHmacVerifier` + `PaymobWebhookHmacTest`
2. `LowStockAlertService` + `GET /api/inventory/alerts/low-stock` + SPA `/inventory/low-stock`
3. Audit logs on supplier pay, settlement delete, transfer / transfer-batch, cycle-count post
4. This doc + artisan proposer

## Still open (see scorecard)

- Invoice financial-edit audit
- Write-path IDOR sampling
- Valuation UX / lot-serial full flows
