<?php

namespace App\Presentation\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\Settlement;
use App\Domain\Models\Wms\SettlementItem;

class FixOrphanSettlementsCommand extends Command
{
    protected $signature = 'inventory:fix-orphan-settlements
                            {--channel-id= : Limit to a channel id}
                            {--dry-run : Show counts only, without updating}';

    protected $description = 'Assign user_id for settlements with null user_id using their channel ownership (tenant isolation fix).';

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $channelIdOpt = $this->option('channel-id');
        $channelId = ($channelIdOpt !== null && $channelIdOpt !== '' && (int) $channelIdOpt > 0) ? (int) $channelIdOpt : 0;

        // Build a mapping of channel_id => user_id (without tenant scope).
        $channelsQ = Channel::withoutGlobalScopes()->select(['id', 'user_id'])->whereNotNull('user_id');
        if ($channelId > 0) {
            $channelsQ->where('id', $channelId);
        }
        $channelToUser = $channelsQ->get()->pluck('user_id', 'id')->toArray();

        if ($channelToUser === []) {
            $this->warn('No channels with user_id found for the given filter.');

            return self::SUCCESS;
        }

        $settlementsQ = Settlement::withoutGlobalScopes()
            ->whereNull('user_id')
            ->whereIn('channel_id', array_keys($channelToUser));

        $orphans = (int) $settlementsQ->count();
        $this->info("Orphan settlements (user_id is null): {$orphans}".($dryRun ? ' (dry run)' : ''));

        if ($orphans === 0) {
            return self::SUCCESS;
        }

        if ($dryRun) {
            return self::SUCCESS;
        }

        DB::beginTransaction();
        try {
            // Update settlements.user_id from channel owner.
            $updatedSettlements = 0;
            foreach ($channelToUser as $cid => $uid) {
                if ((int) $uid <= 0) {
                    continue;
                }
                $updatedSettlements += Settlement::withoutGlobalScopes()
                    ->whereNull('user_id')
                    ->where('channel_id', (int) $cid)
                    ->update(['user_id' => (int) $uid]);
            }

            // Also backfill settlement_items.user_id (if column exists) from settlement owner for consistency.
            // Safe even if some rows already have user_id.
            $updatedItems = 0;
            $settlementIds = Settlement::withoutGlobalScopes()
                ->whereIn('channel_id', array_keys($channelToUser))
                ->whereNotNull('user_id')
                ->pluck('id')
                ->values()
                ->all();

            if ($settlementIds !== []) {
                $updatedItems = SettlementItem::query()
                    ->whereIn('settlement_id', $settlementIds)
                    ->whereNull('user_id')
                    ->update([
                        // Use a subquery so each row gets its settlement's user_id.
                        'user_id' => DB::raw('(SELECT s.user_id FROM settlements s WHERE s.id = settlement_items.settlement_id LIMIT 1)'),
                    ]);
            }

            DB::commit();

            $this->info("Updated settlements: {$updatedSettlements}");
            $this->info("Updated settlement items: {$updatedItems}");

            return self::SUCCESS;
        } catch (\Throwable $e) {
            DB::rollBack();
            $this->error('Failed: '.$e->getMessage());

            return self::FAILURE;
        }
    }
}
