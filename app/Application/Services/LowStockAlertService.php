<?php

namespace App\Application\Services;

use App\Application\Support\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Low-stock / reorder alerts for the current tenant.
 * Uses master_products.min_stock column, falling back to specifications.min_stock / reorder_point.
 */
class LowStockAlertService
{
    /**
     * @return list<array{
     *   id: int,
     *   product: string,
     *   sku: string,
     *   current: float,
     *   minimum: float,
     *   reorder_point: float,
     *   suggested_reorder_qty: float,
     *   warehouse: string,
     *   status: string,
     *   last_movement_at: ?string,
     *   vendors: ?string
     * }>
     */
    public function alerts(int $limit = 50, ?int $channelId = null, ?int $vendorId = null): array
    {
        if (! Schema::hasTable('sku_inventory') || ! Schema::hasTable('master_products')) {
            return [];
        }

        $tenantId = (int) (TenantContext::id() ?? 0);
        if ($tenantId <= 0) {
            return [];
        }

        $hasMinStockCol = Schema::hasColumn('master_products', 'min_stock');

        $minExpr = $hasMinStockCol
            ? "GREATEST(
                COALESCE(MAX(mp.min_stock), 0),
                COALESCE((MAX(mp.specifications::text)::jsonb->>'min_stock')::numeric, 0),
                COALESCE((MAX(mp.specifications::text)::jsonb->>'reorder_point')::numeric, 0)
              )"
            : "GREATEST(
                COALESCE((MAX(mp.specifications::text)::jsonb->>'min_stock')::numeric, 0),
                COALESCE((MAX(mp.specifications::text)::jsonb->>'reorder_point')::numeric, 0)
              )";

        $hasTransactions = Schema::hasTable('inventory_transactions');
        // Real purchase history (what a vendor has actually supplied), not supplier_product_aliases —
        // that table has no write path anywhere in the app and stays empty, which made vendor filtering
        // return zero results for every vendor. This mirrors VendorController::purchaseHistory().
        $hasPurchaseHistory = Schema::hasTable('purchase_batch_items') && Schema::hasTable('purchase_batches')
            && Schema::hasTable('vendors');

        $lastMovementExpr = $hasTransactions
            ? "(SELECT MAX(it.created_at)
                  FROM inventory_transactions it
                  JOIN skus s2 ON s2.id = it.sku_id
                  JOIN inventory_offers o2 ON o2.id = s2.offer_id
                 WHERE o2.master_product_id = mp.id) as last_movement_at"
            : "NULL::timestamp as last_movement_at";

        // purchase_batch_items sometimes only has sku_id set (master_product_id resolved later at
        // receive time) — fall back through skus -> inventory_offers, same as how
        // VendorController::purchaseHistory() displays it via the sku.masterProduct relation.
        $vendorNamesExpr = $hasPurchaseHistory
            ? "(SELECT string_agg(DISTINCT v.name, ', ')
                  FROM purchase_batch_items pbi
                  JOIN purchase_batches pb ON pb.id = pbi.purchase_batch_id
                  JOIN vendors v ON v.id = pb.vendor_id
                  LEFT JOIN skus pbi_sk ON pbi_sk.id = pbi.sku_id
                  LEFT JOIN inventory_offers pbi_io ON pbi_io.id = pbi_sk.offer_id
                 WHERE COALESCE(pbi.master_product_id, pbi_io.master_product_id) = mp.id
                   AND pb.status = 'received') as vendor_names"
            : "NULL::text as vendor_names";

        $rows = DB::table('master_products as mp')
            ->leftJoin('inventory_offers as o', 'o.master_product_id', '=', 'mp.id')
            ->leftJoin('skus as s', 's.offer_id', '=', 'o.id')
            ->leftJoin('sku_inventory as si', 'si.sku_id', '=', 's.id')
            ->where('mp.user_id', $tenantId)
            ->when(Schema::hasColumn('master_products', 'deleted_at'), fn ($q) => $q->whereNull('mp.deleted_at'))
            ->when($channelId, fn ($q) => $q->where('s.channel_id', $channelId))
            ->when($vendorId && $hasPurchaseHistory, fn ($q) => $q->whereIn('mp.id', function ($sub) use ($vendorId) {
                $sub->selectRaw('COALESCE(pbi.master_product_id, pbi_io.master_product_id)')
                    ->from('purchase_batch_items as pbi')
                    ->join('purchase_batches as pb', 'pb.id', '=', 'pbi.purchase_batch_id')
                    ->leftJoin('skus as pbi_sk', 'pbi_sk.id', '=', 'pbi.sku_id')
                    ->leftJoin('inventory_offers as pbi_io', 'pbi_io.id', '=', 'pbi_sk.offer_id')
                    ->where('pb.vendor_id', $vendorId)
                    ->where('pb.status', 'received')
                    ->whereRaw('COALESCE(pbi.master_product_id, pbi_io.master_product_id) IS NOT NULL');
            }))
            ->groupBy('mp.id')
            ->selectRaw(
                "mp.id, ".
                "MAX(mp.internal_name) as internal_name, ".
                "(MAX(mp.specifications::text))::jsonb as specifications, ".
                ($hasMinStockCol ? "MAX(mp.min_stock) as min_stock_col, " : "NULL::numeric as min_stock_col, ").
                "COALESCE(SUM(si.quantity), 0) as total_qty, ".
                "MIN(s.sku) as sku, ".
                "{$minExpr} as threshold, ".
                "{$lastMovementExpr}, ".
                "{$vendorNamesExpr}"
            )
            ->havingRaw("{$minExpr} > 0")
            ->havingRaw("COALESCE(SUM(si.quantity), 0) < {$minExpr}")
            ->orderBy('total_qty')
            ->limit($limit)
            ->get();

        return $rows->map(function ($row) {
            $specs = is_string($row->specifications)
                ? (json_decode($row->specifications, true) ?: [])
                : (array) json_decode(json_encode($row->specifications), true);
            $minCol = (float) ($row->min_stock_col ?? 0);
            $minSpec = (float) ($specs['min_stock'] ?? 0);
            $reorder = (float) ($specs['reorder_point'] ?? 0);
            $minimum = max($minCol, $minSpec, $reorder);
            $current = round((float) $row->total_qty, 2);
            $suggested = max(0, round($minimum - $current, 2));

            return [
                'id' => (int) $row->id,
                'product' => (string) ($row->internal_name ?? '—'),
                'sku' => (string) ($row->sku ?? '—'),
                'current' => $current,
                'minimum' => $minimum,
                'reorder_point' => $reorder > 0 ? $reorder : $minimum,
                'suggested_reorder_qty' => $suggested,
                'warehouse' => 'All locations',
                'status' => $current <= 0 ? 'out_of_stock' : 'low_stock',
                'last_movement_at' => $row->last_movement_at ?? null,
                'vendors' => $row->vendor_names ?? null,
            ];
        })->values()->all();
    }
}
