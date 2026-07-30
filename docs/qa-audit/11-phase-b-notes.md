# Phase B notes (2026-07-30)

Implemented P1 hardening without changing default sync import UX.

| Item | Change |
|------|--------|
| B1 | `TreasurySulfaController::repay` calls `assertExpenseAllowed` before ledger/expense |
| B2 | `GeminiService` uses `x-goog-api-key` header (no API key in URL) |
| B3 | SPA `api.ts`: 401/419 → `#/login`; upload default timeout 600s |
| B4 | `TransferStockRequest`, `StorePurchaseBatchRequest` |
| B5 | `ProcessMarketplaceImportJob` + `async=1` on marketplace import → 202 + `job_key`; status GET `marketplace/import/jobs/{jobKey}` |
| B6 | Gates: cancel-inventory-order, approve-withdrawal, delete-settlement, rollback-marketplace-import |

Default import remains synchronous for SPA compatibility.
