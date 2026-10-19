<?php

declare(strict_types=1);

namespace App\Application\Services;

use App\Domain\Models\Wms\InventoryReturn;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\SkuInventory;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Reverses stock that returns put back beyond what the order sold. Apr–Jun 2026 payment sheets created
 * one return per refund line (principal, shipping, COD, fees) and each restocked a unit: ~1,300 phantom
 * units, mostly in Main Cairo Warehouse and Amazon FBA.
 *
 * Ledger rules: the original IN rows stay; each excess unit gets a compensating OUT
 * (reference_type InventoryReturn::EXCESS_RESTOCK_REVERSAL, reference_id = return id). Earliest
 * returns keep their units. A reversal never takes a balance below zero; units already consumed are
 * reported, not forced. Re-running is safe: earlier reversals are netted out first.
 */
class ReturnExcessRestockCorrectionService
{
    /**
     * @return Collection<int, array{order_id: int, return_id: int, sku_id: int, location_id: int, excess: int, on_hand: float, reversible: int}>
     */
    public function findExcess(int $userId): Collection
    {
        $rows = DB::select('
            WITH sold AS (
                SELECT o.id, COALESCE(SUM(i.quantity), 0) AS qty
                FROM inventory_orders o
                LEFT JOIN inventory_order_items i ON i.inventory_order_id = o.id
                WHERE o.user_id = ?
                GROUP BY o.id
            ),
            restock AS (
                SELECT r.inventory_order_id AS order_id, r.id AS return_id, t.sku_id, t.location_id, t.created_at, t.id AS tx_id,
                       t.quantity - COALESCE((
                           SELECT SUM(x.quantity) FROM inventory_transactions x
                           WHERE x.reference_type = ? AND x.type = \'OUT\' AND x.reference_id = t.reference_id
                             AND x.sku_id = t.sku_id AND x.location_id = t.location_id
                       ), 0) AS net_qty
                FROM inventory_transactions t
                JOIN inventory_returns r ON t.reference_id = CAST(r.id AS VARCHAR)
                WHERE t.reference_type = \'Return\' AND t.type = \'IN\' AND t.user_id = ?
            ),
            running AS (
                SELECT restock.*, SUM(net_qty) OVER (PARTITION BY order_id ORDER BY created_at, tx_id) AS cum
                FROM restock WHERE net_qty > 0
            )
            SELECT running.order_id, running.return_id, running.sku_id, running.location_id,
                   LEAST(running.net_qty, running.cum - sold.qty) AS excess,
                   COALESCE(si.quantity, 0) AS on_hand
            FROM running
            JOIN sold ON sold.id = running.order_id
            LEFT JOIN sku_inventory si ON si.sku_id = running.sku_id AND si.location_id = running.location_id
            WHERE running.cum > sold.qty
            ORDER BY running.sku_id, running.location_id, running.created_at
        ', [$userId, InventoryReturn::EXCESS_RESTOCK_REVERSAL, $userId]);

        // Several excess rows can hit the same balance: allocate on-hand across them in order.
        $left = [];

        return collect($rows)->map(function ($r) use (&$left) {
            $key = $r->sku_id.':'.$r->location_id;
            $left[$key] ??= max(0.0, (float) $r->on_hand);
            $reversible = (int) min((int) $r->excess, floor($left[$key]));
            $left[$key] -= $reversible;

            return [
                'order_id' => (int) $r->order_id,
                'return_id' => (int) $r->return_id,
                'sku_id' => (int) $r->sku_id,
                'location_id' => (int) $r->location_id,
                'excess' => (int) $r->excess,
                'on_hand' => (float) $r->on_hand,
                'reversible' => $reversible,
            ];
        });
    }

    /**
     * @param  Collection<int, array{order_id: int, return_id: int, sku_id: int, location_id: int, excess: int, reversible: int}>  $rows
     * @return array{reversed_units: int, voided_returns: int, unreversible_units: int}
     */
    public function apply(int $userId, Collection $rows): array
    {
        $result = ['reversed_units' => 0, 'voided_returns' => 0, 'unreversible_units' => 0];

        DB::transaction(function () use ($userId, $rows, &$result) {
            foreach ($rows as $row) {
                $inventory = SkuInventory::query()
                    ->where('sku_id', $row['sku_id'])
                    ->where('location_id', $row['location_id'])
                    ->lockForUpdate()
                    ->first();
                $qty = (int) min($row['excess'], max(0, floor((float) ($inventory?->quantity ?? 0))));
                $result['unreversible_units'] += $row['excess'] - $qty;
                if ($qty <= 0) {
                    continue;
                }

                $inventory->decrement('quantity', $qty);
                InventoryTransaction::forceCreate([
                    'user_id' => $userId,
                    'sku_id' => $row['sku_id'],
                    'location_id' => $row['location_id'],
                    'type' => 'OUT',
                    'quantity' => $qty,
                    'reference_type' => InventoryReturn::EXCESS_RESTOCK_REVERSAL,
                    'reference_id' => (string) $row['return_id'],
                    'notes' => "Reverse return restock beyond sold quantity (order #{$row['order_id']})",
                ]);
                $result['reversed_units'] += $qty;
            }

            // Returns whose whole restock is now reversed never really came back: void them with the reason.
            foreach ($rows->pluck('return_id')->unique() as $returnId) {
                $return = InventoryReturn::query()->find($returnId);
                if (! $return || $return->status === 'void') {
                    continue;
                }
                $in = (int) InventoryTransaction::query()->where('reference_type', 'Return')->where('type', 'IN')
                    ->where('reference_id', (string) $returnId)->sum('quantity');
                $out = (int) InventoryTransaction::query()->where('reference_type', InventoryReturn::EXCESS_RESTOCK_REVERSAL)
                    ->where('type', 'OUT')->where('reference_id', (string) $returnId)->sum('quantity');
                if ($in > 0 && $out >= $in) {
                    $return->update([
                        'status' => 'void',
                        'metadata' => array_merge((array) ($return->metadata ?? []), [
                            'void_reason' => 'exceeds_sold_quantity',
                            'voided_at' => now()->toIso8601String(),
                        ]),
                    ]);
                    $result['voided_returns']++;
                }
            }

            app(InventoryAuditLogService::class)->record(
                'returns.excess_restock_reversed',
                null,
                null,
                $result + ['rows' => $rows->values()->all()]
            );
        });

        return $result;
    }
}
