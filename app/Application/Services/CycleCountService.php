<?php

namespace App\Application\Services;

use App\Application\Support\TenantContext;
use App\Domain\Models\Wms\InventoryCycleCount;
use App\Domain\Models\Wms\InventoryCycleCountItem;
use App\Domain\Models\Wms\SkuInventory;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class CycleCountService
{
    public function __construct(
        private readonly InventoryAdjustmentService $adjustments,
        private readonly InventoryAbilityService $abilities,
    ) {}

    /**
     * @return list<InventoryCycleCount>
     */
    public function list(): array
    {
        $this->abilities->assertCan('stock.read');

        return InventoryCycleCount::query()
            ->with(['location:id,name', 'items.sku:id,sku,name'])
            ->orderByDesc('id')
            ->limit(50)
            ->get()
            ->all();
    }

    public function create(int $locationId, ?string $notes = null): InventoryCycleCount
    {
        $this->abilities->assertCan('adjustments.write');

        return DB::transaction(function () use ($locationId, $notes) {
            $count = InventoryCycleCount::create([
                'user_id' => TenantContext::id(),
                'location_id' => $locationId,
                'status' => 'counting',
                'notes' => $notes,
            ]);

            $rows = SkuInventory::query()
                ->where('location_id', $locationId)
                ->where('quantity', '>', 0)
                ->get(['sku_id', 'quantity']);

            foreach ($rows as $row) {
                InventoryCycleCountItem::create([
                    'cycle_count_id' => $count->id,
                    'sku_id' => $row->sku_id,
                    'system_qty' => $row->quantity,
                ]);
            }

            return $count->load(['location:id,name', 'items.sku:id,sku,name']);
        });
    }

    /**
     * @param  list<array{sku_id:int, counted_qty:float|int|string}>  $lines
     */
    public function recordCounts(int $cycleCountId, array $lines): InventoryCycleCount
    {
        $this->abilities->assertCan('adjustments.write');

        $count = InventoryCycleCount::query()->whereKey($cycleCountId)->firstOrFail();
        if (! in_array($count->status, ['draft', 'counting'], true)) {
            throw ValidationException::withMessages(['status' => ['Cycle count is not open for edits.']]);
        }

        return DB::transaction(function () use ($count, $lines) {
            foreach ($lines as $line) {
                $skuId = (int) ($line['sku_id'] ?? 0);
                $counted = (float) ($line['counted_qty'] ?? 0);
                $item = InventoryCycleCountItem::query()
                    ->where('cycle_count_id', $count->id)
                    ->where('sku_id', $skuId)
                    ->first();
                if (! $item) {
                    $system = (float) (SkuInventory::query()
                        ->where('location_id', $count->location_id)
                        ->where('sku_id', $skuId)
                        ->value('quantity') ?? 0);
                    $item = InventoryCycleCountItem::create([
                        'cycle_count_id' => $count->id,
                        'sku_id' => $skuId,
                        'system_qty' => $system,
                    ]);
                }
                $item->counted_qty = $counted;
                $item->variance_qty = $counted - (float) $item->system_qty;
                $item->save();
            }

            $count->status = 'counting';
            $count->save();

            return $count->fresh(['location:id,name', 'items.sku:id,sku,name']);
        });
    }

    public function post(int $cycleCountId): InventoryCycleCount
    {
        $this->abilities->assertCan('adjustments.write');

        $count = InventoryCycleCount::query()->with('items')->whereKey($cycleCountId)->firstOrFail();
        if ($count->status === 'posted') {
            return $count;
        }
        if ($count->status === 'cancelled') {
            throw ValidationException::withMessages(['status' => ['Cancelled counts cannot be posted.']]);
        }

        return DB::transaction(function () use ($count) {
            foreach ($count->items as $item) {
                if ($item->counted_qty === null) {
                    continue;
                }
                $variance = (float) ($item->variance_qty ?? ((float) $item->counted_qty - (float) $item->system_qty));
                if (abs($variance) < 0.0001) {
                    continue;
                }

                // CORRECTION + qty>0 = stock IN; LOST/DAMAGE = stock OUT (see InventoryAdjustmentService).
                if ($variance > 0) {
                    $this->adjustments->adjust([
                        'sku_id' => $item->sku_id,
                        'location_id' => $count->location_id,
                        'quantity' => abs($variance),
                        'type' => 'CORRECTION',
                        'notes' => 'Cycle count #'.$count->id.' overage',
                    ]);
                } else {
                    $this->adjustments->adjust([
                        'sku_id' => $item->sku_id,
                        'location_id' => $count->location_id,
                        'quantity' => abs($variance),
                        'type' => 'LOST',
                        'notes' => 'Cycle count #'.$count->id.' shortage',
                    ]);
                }
            }

            $count->status = 'posted';
            $count->posted_at = now();
            $count->save();

            return $count->fresh(['location:id,name', 'items.sku:id,sku,name']);
        });
    }
}
