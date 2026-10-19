<?php

namespace App\Presentation\Console\Commands;

use App\Application\Services\SupplierAccountService;
use App\Application\Services\SupplierStatementReconciliationService;
use App\Domain\Models\Wms\Supplier;
use App\Presentation\Console\Commands\Concerns\RequiresTenantUser;
use Illuminate\Console\Command;

class ReconcileSupplierStatementCommand extends Command
{
    use RequiresTenantUser;

    protected $signature = 'inventory:reconcile-supplier-statement
                            {--user= : Inventory user_id (tenant) — required}
                            {--supplier= : Supplier name exactly as the suppliers table shows it}
                            {--statement-balance= : Balance on the supplier\'s own statement (what the owner agreed to owe)}
                            {--date= : Date of the reconciliation line (default today)}
                            {--note= : Why the owner accepts the statement figure}
                            {--apply : Write the reconciliation line (default is a dry run)}';

    protected $description = 'Post one audited reconciliation line so a supplier account matches the supplier\'s agreed statement balance.';

    public function handle(SupplierStatementReconciliationService $service, SupplierAccountService $accounts): int
    {
        $userId = $this->requireTenantUser();
        if ($userId <= 0) {
            return self::FAILURE;
        }

        $name = trim((string) $this->option('supplier'));
        $statementRaw = $this->option('statement-balance');
        if ($name === '' || $statementRaw === null || ! is_numeric($statementRaw) || (float) $statementRaw < 0) {
            $this->error('Required: --supplier=<name> and --statement-balance=<amount ≥ 0>.');

            return self::FAILURE;
        }

        $matches = Supplier::query()->get()->filter(fn (Supplier $s) => trim((string) $s->name) === $name)->values();
        if ($matches->count() !== 1) {
            $this->error(sprintf('Expected exactly one supplier named «%s», found %d.', $name, $matches->count()));

            return self::FAILURE;
        }
        $supplier = $matches->first();
        $vendor = $supplier->resolveLinkedVendor();
        if (! $vendor) {
            $this->error("Supplier «{$name}» has no linked vendor.");

            return self::FAILURE;
        }

        // Same figure the suppliers screen shows; an overpaid supplier is a negative balance (their credit).
        $summary = $accounts->summarize($supplier, null, null, false)['summary'];
        $system = (float) $summary['outstanding'] > 0.009
            ? round((float) $summary['outstanding'], 2)
            : round(min(0.0, (float) $summary['net_balance']), 2);
        $statement = round((float) $statementRaw, 2);
        $gap = round($system - $statement, 2);
        $date = (string) ($this->option('date') ?: now()->toDateString());

        $this->table(['Supplier', 'System balance', 'Statement balance', 'Difference', 'Line to post'], [[
            $name,
            number_format($system, 2),
            number_format($statement, 2),
            number_format($gap, 2),
            abs($gap) < 0.01 ? '—' : ($gap > 0 ? 'credit note '.number_format($gap, 2) : 'adjustment invoice '.number_format(-$gap, 2)),
        ]]);

        if (abs($gap) < 0.01) {
            $this->info('Already matches the statement.');

            return self::SUCCESS;
        }
        if (! $this->option('apply')) {
            $this->warn('Dry run — take a backup (backup_inventory_pgsql.sh), then re-run with --apply.');

            return self::SUCCESS;
        }

        $result = $service->reconcile($userId, $supplier, $vendor, $system, $statement, $date, (string) $this->option('note'));
        $afterSummary = $accounts->summarize($supplier->fresh(), null, null, false)['summary'];
        $after = (float) $afterSummary['outstanding'] > 0.009
            ? round((float) $afterSummary['outstanding'], 2)
            : round(min(0.0, (float) $afterSummary['net_balance']), 2);
        $this->info(sprintf(
            'Posted %s of %s EGP on %s (audit: %s). Balance now %s.',
            str_replace('_', ' ', $result['kind']),
            number_format($result['amount'], 2),
            $date,
            SupplierStatementReconciliationService::AUDIT_ACTION,
            number_format($after, 2)
        ));

        return abs($after - $statement) < 0.01 ? self::SUCCESS : self::FAILURE;
    }
}
