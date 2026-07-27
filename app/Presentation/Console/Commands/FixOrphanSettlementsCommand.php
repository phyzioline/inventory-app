<?php

namespace App\Presentation\Console\Commands;

use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\Settlement;
use App\Domain\Models\Wms\SettlementItem;
use App\Presentation\Console\Commands\Concerns\RequiresTenantUser;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class FixOrphanSettlementsCommand extends Command
{
    use RequiresTenantUser;

    protected $signature = 'inventory:fix-orphan-settlements
                            {--user= : Inventory user_id (tenant) — required; only channels owned by this user}
                            {--channel-id= : Limit to a channel id}
                            {--dry-run : Show counts only, without updating}';

    protected $description = 'Assign user_id for settlements with null user_id using their channel ownership (tenant isolation fix).';

    public function handle(): int
    {
        $userId = $this->requireTenantUser();
        if ($userId <= 0) {
            return self::FAILURE;
        }

        $dryRun = (bool) $this->option('dry-run');
        $channelIdOpt = $this->option('channel-id');
        $channelId = ($channelIdOpt !== null && $channelIdOpt !== '' && (int) $channelIdOpt > 0) ? (int) $channelIdOpt : 0;

        // Only channels owned by the requested tenant (still without global scope so orphans are visible).
        $channelsQ = Channel::withoutGlobalScopes()
            ->select(['id', 'user_id'])
            ->where('user_id', $userId);
        if ($channelId > 0) {
            $channelsQ->where('id', $channelId);
        }
        $channelToUser = $channelsQ->get()->pluck('user_id', 'id')->toArray();

        if ($channelToUser === []) {
            $this->warn('No channels found for this user / filter.');

            return self::SUCCESS;
        }

        $settlementsQ = Settlement::withoutGlobalScopes()
            ->whereNull('user_id')
            ->whereIn('channel_id', array_keys($channelToUser));

        $orphans = (int) $settlementsQ->count();
        $this->info("Orphan settlements for user={$userId} (user_id is null): {$orphans}".($dryRun ? ' (dry run)' : ''));

        if ($orphans === 0) {
            return self::SUCCESS;
        }

        if ($dryRun) {
            return self::SUCCESS;
        }

        DB::beginTransaction();
        try {
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
