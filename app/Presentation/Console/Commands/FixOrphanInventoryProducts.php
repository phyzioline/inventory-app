<?php

namespace App\Presentation\Console\Commands;

use Illuminate\Console\Command;
use App\Models\User;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\ProductAlias;
use App\Domain\Models\Wms\Sku;

class FixOrphanInventoryProducts extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'inventory:fix-orphan-products 
                            {user_id? : User ID to assign orphan products to}
                            {--email= : User email (alternative to user_id)}
                            {--dry-run : Show counts without making changes}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Assign user_id to inventory products (master_products, offers, skus, aliases) that have null user_id. Fixes "hidden" products due to User Isolation.';

    /**
     * Execute the console command.
     */
    public function handle(): int
    {
        $dryRun = $this->option('dry-run');

        // Resolve user by ID or email
        $user = null;
        if ($email = $this->option('email')) {
            $user = User::where('email', $email)->first();
            if (! $user) {
                $this->error("User with email '{$email}' not found.");
                $this->info('Run: php artisan tinker --execute="echo json_encode(\App\Models\User::select(\'id\',\'email\')->get()->toArray());" to list users');

                return 1;
            }
        } elseif ($uid = $this->argument('user_id')) {
            $userId = (int) $uid;
            $user = User::find($userId);
            if (! $user) {
                $this->error("User with ID {$userId} not found.");
                $this->info('Use --email=your@email.com or run tinker to list users.');

                return 1;
            }
        } else {
            $this->error('Provide user_id or --email=your@email.com');
            $this->info('Example: php artisan inventory:fix-orphan-products --email=phyzioline@gmail.com');

            return 1;
        }

        $userId = $user->id;

        $this->info("Target user: {$user->name} (ID: {$userId})");
        if ($dryRun) {
            $this->warn('DRY RUN - no changes will be made.');
        }

        $counts = [
            'master_products' => MasterProduct::withoutGlobalScope('user_isolation')->whereNull('user_id')->count(),
            'inventory_offers' => InventoryOffer::withoutGlobalScope('user_isolation')->whereNull('user_id')->count(),
            'skus' => Sku::withoutGlobalScope('user_isolation')->whereNull('user_id')->count(),
            'product_aliases' => ProductAlias::withoutGlobalScope('user_isolation')->whereNull('user_id')->count(),
        ];

        $this->table(
            ['Table', 'Orphan Count'],
            collect($counts)->map(fn ($c, $t) => [$t, $c])->values()->toArray()
        );

        $total = array_sum($counts);
        if ($total === 0) {
            $this->info('No orphan records found. Nothing to fix.');

            return 0;
        }

        if ($dryRun) {
            $this->info("Would assign {$total} records to user {$userId}.");

            return 0;
        }

        if ($this->input->isInteractive() && ! $this->confirm("Assign {$total} orphan records to user {$userId} ({$user->email})?")) {
            $this->warn('Aborted.');

            return 0;
        }

        $updated = 0;

        $updated += MasterProduct::withoutGlobalScope('user_isolation')->whereNull('user_id')->update(['user_id' => $userId]);
        $this->info("Updated {$updated} master_products.");

        $offers = InventoryOffer::withoutGlobalScope('user_isolation')->whereNull('user_id')->update(['user_id' => $userId]);
        $updated += $offers;
        $this->info("Updated {$offers} inventory_offers.");

        $skus = Sku::withoutGlobalScope('user_isolation')->whereNull('user_id')->update(['user_id' => $userId]);
        $updated += $skus;
        $this->info("Updated {$skus} skus.");

        $aliases = ProductAlias::withoutGlobalScope('user_isolation')->whereNull('user_id')->update(['user_id' => $userId]);
        $updated += $aliases;
        $this->info("Updated {$aliases} product_aliases.");

        $this->info("Done. Total records updated: {$updated}");
        $this->info('Products should now appear in Master Products list and Opening Stock import should find SKUs.');

        return 0;
    }
}
