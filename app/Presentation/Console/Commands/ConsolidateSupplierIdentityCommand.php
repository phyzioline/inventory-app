<?php

namespace App\Presentation\Console\Commands;

use Illuminate\Console\Command;
use App\Application\Services\SupplierIdentityConsolidationService;
use App\Domain\Models\Wms\Supplier;

class ConsolidateSupplierIdentityCommand extends Command
{
    protected $signature = 'inventory:consolidate-supplier-identity
                            {supplier : Canonical suppliers.id (e.g. 99 for عبد الواحد الحرمين)}
                            {--payments= : Comma-separated payment_number allowlist (e.g. PAY-331,PAY-390,PAY-056)}
                            {--dry-run : Preview without updating rows}';

    protected $description = 'Reassign legacy/orphan payments to one canonical supplier row without touching other suppliers.';

    public function handle(SupplierIdentityConsolidationService $service): int
    {
        $supplierId = (int) $this->argument('supplier');
        $dryRun = (bool) $this->option('dry-run');

        $supplier = Supplier::withoutGlobalScopes()->find($supplierId);
        if (! $supplier) {
            $this->error("Supplier {$supplierId} not found.");

            return self::FAILURE;
        }

        $explicit = [];
        $paymentsOpt = trim((string) $this->option('payments'));
        if ($paymentsOpt !== '') {
            $explicit = array_values(array_filter(array_map('trim', explode(',', $paymentsOpt))));
        }

        $vendor = $supplier->resolveLinkedVendor();
        $this->info("Canonical supplier: {$supplier->id} — {$supplier->name} (user {$supplier->user_id})");
        $this->line('Linked vendor: '.($vendor ? "{$vendor->id} — {$vendor->name}" : '(none)'));
        $this->line('Legacy payee ids (name match): '.implode(', ', $service->discoverLegacyPayeeIds($supplier, (int) ($vendor?->id ?? 0)) ?: ['—']));
        if ($explicit !== []) {
            $this->line('Explicit allowlist: '.implode(', ', $explicit));
        }
        $this->newLine();

        $result = $service->consolidatePayments($supplier, $explicit, $dryRun);

        foreach (['already' => 'Already canonical', 'moved' => $dryRun ? 'Would move' : 'Moved', 'skipped' => 'Skipped'] as $key => $label) {
            $rows = $result[$key];
            $this->info("{$label}: ".($rows === [] ? '—' : implode(', ', $rows)));
        }

        if ($dryRun) {
            $this->warn('Dry run — no rows updated. Re-run without --dry-run to apply.');
        }

        return self::SUCCESS;
    }
}
