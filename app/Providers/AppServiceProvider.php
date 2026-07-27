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
use App\Presentation\Console\Commands\GrantSuperAdmin;
use App\Presentation\Console\Commands\SyncSkuCostsFromMasterProductsCommand;
use Illuminate\Support\Facades\Gate;
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

        // Single super-admin bypass — see database/migrations/*_add_is_super_admin_to_users_table.php.
        // Never mass-assignable (not in User::$fillable); only set via the admin:grant-super command.
        Gate::before(fn ($user, string $ability) => $user->is_super_admin ? true : null);

        if ($this->app->runningInConsole()) {
            $this->commands([
                GrantSuperAdmin::class,
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
                \App\Presentation\Console\Commands\RetryImportStockDeductionsCommand::class,
                SyncSkuCostsFromMasterProductsCommand::class,
                AuditImportSkuDrift::class,
                RepairImportSkuDrift::class,
                \App\Presentation\Console\Commands\FixSwappedMarketplaceOrderDatesCommand::class,
            ]);
        }
    }
}
