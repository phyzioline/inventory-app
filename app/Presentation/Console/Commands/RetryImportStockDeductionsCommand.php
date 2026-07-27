<?php

namespace App\Presentation\Console\Commands;

use App\Application\Services\MarketplaceImportService;
use Illuminate\Console\Command;

/**
 * Batch-retry marketplace import stock deductions for shortage / undeducted lines
 * without re-uploading order sheets. Idempotent via hasPriorImportedOrderDeduction.
 */
class RetryImportStockDeductionsCommand extends Command
{
    protected $signature = 'inventory:retry-import-stock-deductions
                            {--user= : Inventory user_id (tenant)}
                            {--since= : Only orders with order_date >= this (Y-m-d or Y-m-d H:i:s)}
                            {--until= : Only orders with order_date <= this}
                            {--days= : Shortcut: since = now minus N days (order_date)}
                            {--only-shortage : Only rows with stock_deduction_status=shortage (skip legacy null)}
                            {--limit= : Max order lines to process}
                            {--dry-run : List candidates / would-deduct without changing stock}';

    protected $description = 'Retry pending import stock deductions (shortage / legacy null) without re-uploading sheets';

    public function handle(MarketplaceImportService $service): int
    {
        $userId = (int) ($this->option('user') ?: 0);
        if ($userId <= 0) {
            $this->error('Required: --user=<inventory_user_id>');

            return self::FAILURE;
        }

        $since = $this->option('since') ? (string) $this->option('since') : null;
        $until = $this->option('until') ? (string) $this->option('until') : null;
        $days = $this->option('days');
        if ($days !== null && $days !== '' && $since === null) {
            $n = max(0, (int) $days);
            $since = now()->subDays($n)->startOfDay()->toDateTimeString();
        }

        $dryRun = (bool) $this->option('dry-run');
        $onlyShortage = (bool) $this->option('only-shortage');
        $limit = $this->option('limit') !== null && $this->option('limit') !== ''
            ? (int) $this->option('limit')
            : null;

        $this->info(($dryRun ? '[dry-run] ' : '')."Retrying pending import deductions for user={$userId}"
            .($since ? " since={$since}" : '')
            .($until ? " until={$until}" : '')
            .($onlyShortage ? ' (shortage only)' : ' (shortage + legacy null)'));

        try {
            $result = $service->retryPendingStockDeductions([
                'user_id' => $userId,
                'since' => $since,
                'until' => $until,
                'dry_run' => $dryRun,
                'only_shortage' => $onlyShortage,
                'limit' => $limit,
            ]);
        } catch (\Throwable $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }

        $this->table(
            ['scanned', 'already_deducted', $dryRun ? 'would_deduct' : 'deducted', 'shortage', 'skipped'],
            [[
                $result['scanned'],
                $result['already_deducted'],
                $result['deducted'],
                $result['shortage'],
                $result['skipped'],
            ]]
        );

        $show = array_slice($result['items'], 0, 40);
        foreach ($show as $row) {
            $this->line(sprintf(
                '  #%s %s sku=%s qty=%s → %s%s',
                $row['item_id'] ?? '?',
                $row['platform_order_id'] ?? '',
                $row['sku_code'] ?? '',
                $row['qty'] ?? '',
                $row['result'] ?? '',
                isset($row['reason']) ? ' ('.$row['reason'].')' : ''
            ));
        }
        if (count($result['items']) > 40) {
            $this->warn('… and '.(count($result['items']) - 40).' more');
        }

        if ($dryRun) {
            $this->warn('Dry run only — no stock changes.');
        }

        return self::SUCCESS;
    }
}
