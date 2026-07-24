<?php

namespace App\Providers;

use App\Application\Services\FinanceAccountLedgerService;
use App\Application\Services\InventoryAdjustmentService;
use App\Application\Services\InventoryReturnImportService;
use App\Application\Services\InventoryReturnListingService;
use App\Application\Services\InventoryReturnMutationService;
use App\Application\Services\InventoryTransactionService;
use App\Application\Services\InventoryValuationService;
use App\Application\Services\MarketplaceImportService;
use App\Application\Services\MatchingEngineService;
use App\Application\Services\ProductImportService;
use App\Application\Services\ProfitEngineService;
use App\Application\Services\PurchaseImportService;
use App\Application\Services\ReceiptApplicationService;
use App\Application\Services\SettlementService;
use App\Application\Services\TreasuryLedgerService;
use App\Application\Services\TreasurySpendGuard;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\Customer;
use App\Domain\Models\Wms\Vendor;
use App\Infrastructure\Observers\CustomerObserver;
use App\Infrastructure\Observers\MasterProductIdentifierObserver;
use App\Infrastructure\Observers\SkuChannelListingObserver;
use App\Infrastructure\Observers\VendorObserver;
use App\Presentation\Console\Commands\AuditImportSkuDrift;
use App\Presentation\Console\Commands\ConsolidateSupplierIdentityCommand;
use App\Presentation\Console\Commands\FixOrphanInventoryProducts;
use App\Presentation\Console\Commands\FixOrphanSettlementsCommand;
use App\Presentation\Console\Commands\ImportAmazonSettlementCommand;
use App\Presentation\Console\Commands\RecalculateSettlementItemAmountsFromRawData;
use App\Presentation\Console\Commands\RecomputeOrderFinancialStatusesCommand;
use App\Presentation\Console\Commands\ReconcileMerchantPhantomStockCommand;
use App\Presentation\Console\Commands\ReconcileSettlementReturnsCommand;
use App\Presentation\Console\Commands\ReconcileSettlementsCommand;
use App\Presentation\Console\Commands\RepairImportSkuDrift;
use App\Presentation\Console\Commands\RollbackMarketplaceImportStockCommand;
use App\Presentation\Console\Commands\SyncSkuCostsFromMasterProductsCommand;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     *
     * Mirrors the source Modules\Inventory\app\Providers\InventoryServiceProvider::register(),
     * minus PlatformIdentifierService/ContactSync* bindings that were removed as part of the
     * standalone extraction (see App\Infrastructure\External\MonolithCrmWebhookClient and the
     * gutted Sku/MasterProductIdentifier observers).
     */
    public function register(): void
    {
        $this->app->singleton(PurchaseImportService::class);
        $this->app->singleton(InventoryTransactionService::class);
        $this->app->singleton(InventoryAdjustmentService::class);
        $this->app->singleton(InventoryValuationService::class);
        $this->app->singleton(ProfitEngineService::class);
        $this->app->singleton(SettlementService::class);
        $this->app->singleton(MarketplaceImportService::class);
        $this->app->singleton(ProductImportService::class);
        $this->app->singleton(MatchingEngineService::class);
        $this->app->singleton(ReceiptApplicationService::class);
        $this->app->singleton(TreasuryLedgerService::class);
        $this->app->singleton(TreasurySpendGuard::class);
        $this->app->singleton(FinanceAccountLedgerService::class);
        $this->app->singleton(InventoryReturnImportService::class);
        $this->app->singleton(InventoryReturnListingService::class);
        $this->app->singleton(InventoryReturnMutationService::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        Customer::observe(CustomerObserver::class);
        Vendor::observe(VendorObserver::class);
        MasterProduct::observe(MasterProductIdentifierObserver::class);
        Sku::observe(SkuChannelListingObserver::class);

        if ($this->app->runningInConsole()) {
            $this->commands([
                FixOrphanInventoryProducts::class,
                ConsolidateSupplierIdentityCommand::class,
                FixOrphanSettlementsCommand::class,
                ImportAmazonSettlementCommand::class,
                RecalculateSettlementItemAmountsFromRawData::class,
                RecomputeOrderFinancialStatusesCommand::class,
                ReconcileMerchantPhantomStockCommand::class,
                ReconcileSettlementsCommand::class,
                ReconcileSettlementReturnsCommand::class,
                RollbackMarketplaceImportStockCommand::class,
                SyncSkuCostsFromMasterProductsCommand::class,
                AuditImportSkuDrift::class,
                RepairImportSkuDrift::class,
            ]);
        }
    }
}
