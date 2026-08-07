<?php

use Illuminate\Support\Facades\Route;
use App\Presentation\Http\Controllers\Api\Admin\AdminDashboardController;
use App\Presentation\Http\Controllers\Api\Admin\AdminErrorLogController;
use App\Presentation\Http\Controllers\Api\Admin\AdminSubscriptionController;
use App\Presentation\Http\Controllers\Api\ASINController;
use App\Presentation\Http\Controllers\Api\AsnTransferController;
use App\Presentation\Http\Controllers\Api\BarcodeReturnController;
use App\Presentation\Http\Controllers\Api\CapitalSourceController;
use App\Presentation\Http\Controllers\Api\CashFlowSummaryController;
use App\Presentation\Http\Controllers\Api\ChannelController;
use App\Presentation\Http\Controllers\Api\ChannelSkuImportController;
use App\Presentation\Http\Controllers\Api\CustomerController;
use App\Presentation\Http\Controllers\Api\DashboardMetricsController;
use App\Presentation\Http\Controllers\Api\DraftProductReviewController;
use App\Presentation\Http\Controllers\Api\EmployeeController;
use App\Presentation\Http\Controllers\Api\ExpenseController;
use App\Presentation\Http\Controllers\Api\FbaShipmentTransferController;
use App\Presentation\Http\Controllers\Api\FinanceAccountController;
use App\Presentation\Http\Controllers\Api\ImageProxyController;
use App\Presentation\Http\Controllers\Api\InventoryAdjustmentController;
use App\Presentation\Http\Controllers\Api\InventoryAdjustmentImportController;
use App\Presentation\Http\Controllers\Api\InventoryAuthController;
use App\Presentation\Http\Controllers\Api\InventoryController;
use App\Presentation\Http\Controllers\Api\InventoryLocationController;
use App\Presentation\Http\Controllers\Api\InventoryOfferController;
use App\Presentation\Http\Controllers\Api\InventoryOrderController;
use App\Presentation\Http\Controllers\Api\InventoryReportController;
use App\Presentation\Http\Controllers\Api\InventoryTransactionController;
use App\Presentation\Http\Controllers\Api\InvoiceEditController;
use App\Presentation\Http\Controllers\Api\MarketplaceOrderController;
use App\Presentation\Http\Controllers\Api\MasterProductController;
use App\Presentation\Http\Controllers\Api\PaymentController;
use App\Presentation\Http\Controllers\Api\ProductImportController;
use App\Presentation\Http\Controllers\Api\ProfitDistributionController;
use App\Presentation\Http\Controllers\Api\ProfitReportController;
use App\Presentation\Http\Controllers\Api\PurchaseImportController;
use App\Presentation\Http\Controllers\Api\PurchaseReturnController;
use App\Presentation\Http\Controllers\Api\QuotationController;
use App\Presentation\Http\Controllers\Api\ReceiptController;
use App\Presentation\Http\Controllers\Api\RemovalController;
use App\Presentation\Http\Controllers\Api\ReturnController;
use App\Presentation\Http\Controllers\Api\SettlementController;
use App\Presentation\Http\Controllers\Api\SkuController;
use App\Presentation\Http\Controllers\Api\SubscriptionController;
use App\Presentation\Http\Controllers\Api\SupplierController;
use App\Presentation\Http\Controllers\Api\TransferController;
use App\Presentation\Http\Controllers\Api\TreasuryPanelController;
use App\Presentation\Http\Controllers\Api\TreasurySulfaController;
use App\Presentation\Http\Controllers\Api\CycleCountController;
use App\Presentation\Http\Controllers\Api\LowStockAlertController;
use App\Presentation\Http\Controllers\Api\StaffMembershipController;
use App\Presentation\Http\Controllers\Api\VendorController;
use App\Presentation\Http\Controllers\Api\WithdrawalController;

Route::prefix('api/inventory')->middleware(['web'])->group(function (): void {

    // ─── Public Auth Routes ─────────────────────────────────────────────
    Route::post('auth/login', [InventoryAuthController::class, 'login']);
    Route::post('auth/logout', [InventoryAuthController::class, 'logout']);
    Route::post('auth/register', [InventoryAuthController::class, 'register']);
    Route::post('auth/forgot-password', [InventoryAuthController::class, 'forgotPassword']);
    Route::post('auth/reset-password', [InventoryAuthController::class, 'resetPassword']);

    // Public image proxy — kept outside auth so <img src="..."> can load without a session.
    Route::get('image-proxy', ImageProxyController::class);

    // ─── Protected Routes (Auth Required) ──────────────────────────────
    Route::middleware(['auth'])->group(function (): void {

        Route::get('auth/me', [InventoryAuthController::class, 'me']);
        Route::put('auth/profile', [InventoryAuthController::class, 'updateProfile']);
        Route::post('auth/change-password', [InventoryAuthController::class, 'changePassword']);

        Route::get('staff', [StaffMembershipController::class, 'index']);
        Route::post('staff', [StaffMembershipController::class, 'store']);
        Route::put('staff/{id}', [StaffMembershipController::class, 'update']);
        Route::delete('staff/{id}', [StaffMembershipController::class, 'destroy']);

        Route::get('cycle-counts', [CycleCountController::class, 'index']);
        Route::post('cycle-counts', [CycleCountController::class, 'store']);
        Route::post('cycle-counts/{id}/counts', [CycleCountController::class, 'recordCounts']);
        Route::post('cycle-counts/{id}/post', [CycleCountController::class, 'post']);

        Route::get('alerts/low-stock', [LowStockAlertController::class, 'index']);

        // ── Inventory Core ──────────────────────────────────────────
        Route::apiResource('master-products', MasterProductController::class);
        Route::post('master-products/bulk-link', [MasterProductController::class, 'bulkLink']);
        Route::post('master-products/bulk-delete', [MasterProductController::class, 'bulkDelete']);
        Route::get('master-products/{id}/inventory', [MasterProductController::class, 'inventory']);
        Route::get('master-products/{id}/stock', [MasterProductController::class, 'stock']);
        Route::post('master-products/{id}/ensure-channel-listing', [MasterProductController::class, 'ensureChannelListing']);

        Route::apiResource('inventory-offers', InventoryOfferController::class);
        Route::get('skus/channel-summary', [SkuController::class, 'channelSummary']);
        Route::apiResource('skus', SkuController::class);
        Route::get('channels/metrics', [ChannelController::class, 'metrics']);
        Route::get('channels/slug/{slug}', [ChannelController::class, 'getBySlug']);
        Route::post('channels/sync-locations', [ChannelController::class, 'syncLocations']);
        Route::post('channels', [ChannelController::class, 'store'])->middleware('check.subscription.limit:channels');
        Route::apiResource('channels', ChannelController::class)->except(['store']);

        // ── Channel SKU Import ────────────────────────────────────────
        Route::prefix('channels/{channelId}/import')->group(function () {
            Route::post('upload', [ChannelSkuImportController::class, 'upload']);
            Route::post('confirm', [ChannelSkuImportController::class, 'confirm']);
            Route::get('template', [ChannelSkuImportController::class, 'template']);
        });

        Route::post('adjustments/import', [InventoryAdjustmentImportController::class, 'import']);
        Route::get('adjustments/template', [InventoryAdjustmentImportController::class, 'template']);
        Route::apiResource('adjustments', InventoryAdjustmentController::class);

        Route::get('warehouses/all-inventory', [InventoryLocationController::class, 'allInventory']);
        Route::get('warehouses/summary', [InventoryLocationController::class, 'summary']);
        Route::get('warehouses/{id}/inventory', [InventoryLocationController::class, 'inventory']);
        Route::post('warehouses', [InventoryLocationController::class, 'store'])->middleware('check.subscription.limit:warehouses');
        Route::apiResource('warehouses', InventoryLocationController::class)->except(['store']);

        Route::get('transactions/sku-tracker', [InventoryTransactionController::class, 'skuTracker']);
        Route::post('transactions/transfer', [InventoryTransactionController::class, 'transfer']);
        Route::post('transactions/transfer-batch', [InventoryTransactionController::class, 'transferBatch']);
        Route::patch('transactions/{id}/transfer', [InventoryTransactionController::class, 'updateTransfer']);
        Route::apiResource('transactions', InventoryTransactionController::class);

        // ── Sales & Orders ──────────────────────────────────────────
        Route::post('orders/import', [InventoryOrderController::class, 'import']);
        Route::get('orders/{id}/profitability', [InventoryOrderController::class, 'profitability']);
        Route::post('orders/{id}/cancel', [InventoryOrderController::class, 'cancel']);
        Route::put('orders/{id}/financial-edit', [InvoiceEditController::class, 'edit']);
        Route::get('orders/{id}/edit-history', [InvoiceEditController::class, 'history']);
        Route::apiResource('orders', InventoryOrderController::class);
        Route::post('marketplace/import/preview', [MarketplaceOrderController::class, 'preview']);
        Route::post('marketplace/import', [MarketplaceOrderController::class, 'import']);
        Route::get('marketplace/import/jobs/{jobKey}', [MarketplaceOrderController::class, 'importJobStatus']);
        Route::get('marketplace/import/last-batch', [MarketplaceOrderController::class, 'lastBatch']);
        Route::post('marketplace/import/rollback-last', [MarketplaceOrderController::class, 'rollbackLast']);
        Route::post('marketplace/import/retry-stock-deductions', [MarketplaceOrderController::class, 'retryStockDeductions']);

        // ── Contacts & CRM ───────────────────────────────────────────
        Route::post('vendors/{id}/balance', [VendorController::class, 'adjustBalance']);
        Route::get('vendors/{id}/purchase-history', [VendorController::class, 'purchaseHistory']);
        Route::post('vendors/{id}/sync-crm', [VendorController::class, 'syncCrm']);
        Route::apiResource('vendors', VendorController::class);
        Route::post('suppliers/{id}/pay', [SupplierController::class, 'pay']);
        Route::get('suppliers/{id}/account-summary', [SupplierController::class, 'accountSummary']);
        Route::post('suppliers/bulk-upload', [SupplierController::class, 'bulkUpload']);
        Route::get('suppliers/template/download', [SupplierController::class, 'downloadTemplate']);
        Route::apiResource('suppliers', SupplierController::class);
        Route::get('customers/paginated-with-summary', [CustomerController::class, 'paginatedWithSummary']);
        Route::get('customers/{customer}/account-summary', [CustomerController::class, 'accountSummary']);
        Route::post('customers/{customer}/receive', [CustomerController::class, 'receive']);
        Route::post('customers/{customer}/sync-crm', [CustomerController::class, 'syncCrm']);
        Route::apiResource('customers', CustomerController::class);
        Route::post('quotations/{quotation}/convert', [QuotationController::class, 'convertToOrder']);
        Route::apiResource('quotations', QuotationController::class);

        // ── Financials ───────────────────────────────────────────────
        Route::get('finance/cash-flow-overview', [CashFlowSummaryController::class, 'overview']);
        Route::get('finance/cash-flow-stats', [CashFlowSummaryController::class, 'stats']);
        Route::get('finance/treasury-panels', [TreasuryPanelController::class, 'panels']);
        Route::get('finance/sulfas/summary', [TreasurySulfaController::class, 'summary']);
        Route::get('finance/sulfas', [TreasurySulfaController::class, 'index']);
        Route::post('finance/sulfas', [TreasurySulfaController::class, 'store']);
        Route::post('finance/sulfas/{id}/repay', [TreasurySulfaController::class, 'repay']);
        Route::get('finance/accounts', [FinanceAccountController::class, 'index']);
        Route::post('finance/accounts', [FinanceAccountController::class, 'store']);
        Route::patch('finance/accounts/{id}', [FinanceAccountController::class, 'update']);
        Route::post('employees/import-from-expenses', [EmployeeController::class, 'importFromExpenses']);
        Route::apiResource('employees', EmployeeController::class);
        Route::apiResource('expenses', ExpenseController::class);
        Route::apiResource('receipts', ReceiptController::class);
        Route::apiResource('payments', PaymentController::class);
        Route::apiResource('capital-sources', CapitalSourceController::class);
        Route::post('profit-distributions/{id}/mark-paid', [ProfitDistributionController::class, 'markPaid']);
        Route::apiResource('profit-distributions', ProfitDistributionController::class);
        Route::post('withdrawals/{id}/approve', [WithdrawalController::class, 'approve']);
        Route::post('withdrawals/{id}/complete', [WithdrawalController::class, 'complete']);
        Route::apiResource('withdrawals', WithdrawalController::class);

        // ── Channel Tools ────────────────────────────────────────────
        Route::post('asins/bulk-upload', [ASINController::class, 'bulkUpload']);
        Route::get('asins/template/download', [ASINController::class, 'downloadTemplate']);
        Route::get('asins/{id}/price-history', [ASINController::class, 'priceHistory']);
        Route::apiResource('asins', ASINController::class);

        Route::get('settlements/summary', [SettlementController::class, 'summary']);
        Route::get('settlements/order-net-totals', [SettlementController::class, 'orderNetTotals']);
        Route::get('settlements/order-sku-net-totals', [SettlementController::class, 'orderSkuNetTotals']);
        Route::get('settlements/order-transactions', [SettlementController::class, 'orderTransactions']);
        Route::post('settlements/import', [SettlementController::class, 'import']);
        Route::post('settlements/{id}/reconcile', [SettlementController::class, 'reconcile']);
        Route::apiResource('settlements', SettlementController::class);
        Route::post('returns/import', [ReturnController::class, 'import']);
        Route::post('returns/import-inventory-ledger', [ReturnController::class, 'importInventoryLedger']);
        Route::post('returns/{id}/process', [ReturnController::class, 'process']);
        Route::post('returns/{id}/receive', [ReturnController::class, 'receive']);
        Route::apiResource('returns', ReturnController::class);

        // ── Amazon Removal Orders ─────────────────────────────────────
        Route::get('removals', [RemovalController::class, 'index']);
        Route::post('removals/import', [RemovalController::class, 'import']);
        Route::post('removals/items/{id}/receive', [RemovalController::class, 'receive']);

        // ── Bulk Transfers ───────────────────────────────────────────
        Route::post('transfers/bulk-upload', [TransferController::class, 'bulkUpload']);
        Route::post('transfers/execute', [TransferController::class, 'executeBulkTransfer']);
        Route::get('transfers/template/download', [TransferController::class, 'downloadTemplate']);
        Route::get('transfers', [TransferController::class, 'index']);
        Route::post('transfers/asn/upload', [AsnTransferController::class, 'upload']);
        Route::post('transfers/asn/execute', [AsnTransferController::class, 'execute']);
        Route::post('transfers/asn/print-barcodes', [AsnTransferController::class, 'printBarcodes']);
        Route::post('transfers/fba-shipment/upload', [FbaShipmentTransferController::class, 'upload']);

        // ── Barcode Returns ──────────────────────────────────────────
        Route::post('barcode/scan', [BarcodeReturnController::class, 'scanBarcode']);
        Route::post('barcode/scan-image', [BarcodeReturnController::class, 'scanImage']);
        Route::post('barcode/process-return', [BarcodeReturnController::class, 'processReturn']);

        // ── Dashboard & Shared ───────────────────────────────────────
        Route::get('dashboard', [InventoryController::class, 'dashboard']);
        Route::get('stock/{sku}', [InventoryController::class, 'checkStock']);

        // ── Reports ──────────────────────────────────────────────────
        Route::get('reports/dashboard-metrics', [DashboardMetricsController::class, 'index']);
        Route::get('reports/profit-summary', [ProfitReportController::class, 'summary']);
        Route::get('reports/cash-profit-snapshot', [ProfitReportController::class, 'cashProfitSnapshot']);
        Route::get('reports/profit-by-sku', [ProfitReportController::class, 'bySku']);
        Route::get('reports/roi-metrics', [ProfitReportController::class, 'roiMetrics']);
        Route::get('reports/profit-fee-dimensions', [ProfitReportController::class, 'feeDimensions']);
        Route::post('reports/platform-fees/import', [ProfitReportController::class, 'importPlatformFees']);
        Route::get('reports/dead-stock', [InventoryReportController::class, 'deadStock']);
        Route::get('reports/margin-alerts', [InventoryReportController::class, 'marginAlerts']);
        Route::get('reports/return-rates', [InventoryReportController::class, 'returnRates']);

        // ── Imports ──────────────────────────────────────────────────
        Route::prefix('import/products')->group(function () {
            Route::post('upload', [ProductImportController::class, 'upload']);
            Route::post('confirm', [ProductImportController::class, 'confirm']);
            Route::get('template', [ProductImportController::class, 'template']);
            Route::get('drafts', [DraftProductReviewController::class, 'index']);
            Route::get('drafts/{id}', [DraftProductReviewController::class, 'show']);
            Route::post('drafts/batch', [DraftProductReviewController::class, 'batchProcess']);
            Route::post('drafts/{id}/process', [DraftProductReviewController::class, 'process']);
        });

        Route::prefix('purchases/smart-import')->group(function () {
            Route::post('upload', [PurchaseImportController::class, 'upload']);
            Route::post('upload-only', [PurchaseImportController::class, 'uploadOnly']);
            Route::post('{uploadId}/process', [PurchaseImportController::class, 'process']);
            Route::get('uploads', [PurchaseImportController::class, 'listUploads']);
            Route::get('summary/by-location', [PurchaseImportController::class, 'summaryByLocation']);
            Route::get('batches', [PurchaseImportController::class, 'listBatches']);
            Route::post('batches', [PurchaseImportController::class, 'store']);
            Route::get('batches/{id}', [PurchaseImportController::class, 'showBatch']);
            Route::put('batches/{id}', [PurchaseImportController::class, 'updateBatch']);
            Route::post('batches/{id}/add-item', [PurchaseImportController::class, 'addItem']);
            Route::delete('batches/{batchId}/items/{itemId}', [PurchaseImportController::class, 'removeItem']);
            Route::post('batches/{id}/approve', [PurchaseImportController::class, 'approve']);
            Route::post('batches/{id}/receive', [PurchaseImportController::class, 'receive']);
            Route::post('batches/{id}/payment-meta', [PurchaseImportController::class, 'updatePaymentMeta']);
            Route::post('batches/{id}/cancel', [PurchaseImportController::class, 'cancel']);
        });

        Route::apiResource('purchase-returns', PurchaseReturnController::class)
            ->only(['index', 'show', 'store', 'update']);

        // ── Super-admin: cross-tenant oversight (see App\Http\Middleware\EnsureSuperAdmin) ──
        Route::prefix('admin')->middleware(['super.admin'])->group(function (): void {
            Route::get('overview', [AdminDashboardController::class, 'overview']);
            Route::get('subscriptions', [AdminSubscriptionController::class, 'index']);
            Route::get('error-log', [AdminErrorLogController::class, 'index']);
            // Must stay super.admin — previously accepted arbitrary user_id (IDOR).
            Route::post('regenerate-master-products', [MasterProductController::class, 'regenerateFromOrphans']);
        });

        // ── Subscription (tenant self-service) ──────────────────────────
        Route::prefix('subscription')->group(function (): void {
            Route::get('plans', [SubscriptionController::class, 'plans']);
            Route::get('current', [SubscriptionController::class, 'current']);
            Route::post('upgrade', [SubscriptionController::class, 'upgrade']);
            Route::post('cancel', [SubscriptionController::class, 'cancel']);
        });
    });
});

// Tauri desktop auto-updater — public, no auth (see App\Application\Services\TauriDesktopUpdateService).
// Path kept identical to the monolith (/api/v1/inventory/desktop/...) so the
// already-built Tauri desktop shell needs no change beyond pointing at the new host.
Route::prefix('api/v1/inventory/desktop')->group(function (): void {
    Route::get('version', [\App\Presentation\Http\Controllers\Api\InventoryDesktopUpdateController::class, 'latest']);
    Route::get('update/{target}/{arch}/{current}', [\App\Presentation\Http\Controllers\Api\InventoryDesktopUpdateController::class, 'check']);
});

// Tauri offline sync — Sanctum bearer-token auth (see InventoryAuthController::login,
// which mints a token for X-Client: tauri logins), not the session cookie the web
// SPA uses. See App\Application\Services\DesktopSyncService for the offline v1 scope
// (read-only catalog/stock snapshot + queued stock adjustments).
Route::prefix('api/v1/inventory/desktop/sync')->middleware(['auth:sanctum'])->group(function (): void {
    Route::get('bootstrap', [\App\Presentation\Http\Controllers\Api\InventoryDesktopSyncController::class, 'bootstrap']);
    Route::get('delta', [\App\Presentation\Http\Controllers\Api\InventoryDesktopSyncController::class, 'delta']);
    Route::post('push', [\App\Presentation\Http\Controllers\Api\InventoryDesktopSyncController::class, 'push']);
});
