<?php

namespace App\Presentation\Console\Commands;

use App\Application\Services\SettlementService;
use App\Domain\Models\Wms\Settlement;
use App\Presentation\Console\Commands\Concerns\RequiresTenantUser;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class ImportAmazonSettlementCommand extends Command
{
    use RequiresTenantUser;

    protected $signature = 'inventory:import-amazon-settlement
                            {file : Absolute/relative path to the settlement XML/CSV/TXT file on this server}
                            {--user= : Inventory user_id (tenant) — required}
                            {--channel-id= : Channel id to attach the settlement to (fallback when merchant id is missing)}
                            {--reconcile : Run reconcile after import (recommended)}
                            {--dry-run : Parse only; do not write to DB}';

    protected $description = 'Import an Amazon settlement file from disk and optionally reconcile, without using the UI upload.';

    public function handle(SettlementService $service): int
    {
        $userId = $this->requireTenantUser();
        if ($userId <= 0) {
            return self::FAILURE;
        }

        $file = (string) $this->argument('file');
        $channelIdOpt = $this->option('channel-id');
        $channelId = ($channelIdOpt !== null && $channelIdOpt !== '' && (int) $channelIdOpt > 0) ? (int) $channelIdOpt : 0;
        $dryRun = (bool) $this->option('dry-run');
        $doReconcile = (bool) $this->option('reconcile');

        if (! is_file($file)) {
            $this->error("File not found: {$file}");

            return self::FAILURE;
        }

        if ($channelId <= 0) {
            $this->error('--channel-id is required.');

            return self::FAILURE;
        }

        if ($dryRun) {
            $this->warn('Dry-run: import is disabled (no DB writes).');
            $this->info('Tip: remove --dry-run to actually import.');

            return self::SUCCESS;
        }

        $stats = DB::transaction(function () use ($service, $channelId, $file, $doReconcile) {
            $stats = $service->importAmazonSettlement($channelId, $file);
            $settlementId = (int) ($stats['settlement_id'] ?? 0);
            if ($doReconcile && $settlementId > 0) {
                $settlement = Settlement::query()->find($settlementId);
                if ($settlement) {
                    $stats['matched_lines'] = $service->reconcile($settlement);
                }
            }

            return $stats;
        });

        $this->info('Imported settlement successfully.');
        $this->line(json_encode($stats, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        if ($doReconcile && isset($stats['matched_lines'])) {
            $this->info('Reconcile done. matched_lines='.$stats['matched_lines']);
        }

        return self::SUCCESS;
    }
}
