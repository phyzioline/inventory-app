<?php

namespace App\Application\Services;

use App\Application\Support\TenantContext;
use App\Domain\Models\Wms\DesktopSyncOperation;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Offline v1 scope: read-only catalog/stock snapshot (bootstrap/delta) plus
 * queued stock adjustments (IN/OUT) applied through the existing
 * InventoryAdjustmentService — the same FIFO-costing code path the online
 * "/inventory/adjustments" screen already uses. Transfers, sales, and
 * purchases stay online-only; see docs/reference plan for the staged scope.
 */
class DesktopSyncService
{
    public function __construct(private readonly InventoryAdjustmentService $adjustmentService) {}

    /**
     * @return array{cursor: string, skus: array, locations: array, stock: array}
     */
    public function bootstrap(): array
    {
        return $this->snapshot(null);
    }

    /**
     * @return array{cursor: string, skus: array, locations: array, stock: array}
     */
    public function delta(Carbon $since): array
    {
        return $this->snapshot($since);
    }

    private function snapshot(?Carbon $since): array
    {
        $cursor = now()->toIso8601String();
        $hasBarcode = Schema::hasColumn('skus', 'barcode');

        $skuColumns = array_filter([
            'id', 'sku', 'name', $hasBarcode ? 'barcode' : null,
            'cost_price', 'selling_price', 'is_active', 'updated_at',
        ]);

        $skuQuery = Sku::query()->select($skuColumns);
        $locationQuery = InventoryLocation::query()->select(['id', 'name', 'type', 'is_active', 'updated_at']);
        $stockQuery = SkuInventory::query()->select(['sku_id', 'location_id', 'quantity', 'updated_at']);

        if ($since) {
            $skuQuery->where('updated_at', '>', $since);
            $locationQuery->where('updated_at', '>', $since);
            $stockQuery->where('updated_at', '>', $since);
        }

        return [
            'cursor' => $cursor,
            'skus' => $skuQuery->get()->toArray(),
            'locations' => $locationQuery->get()->toArray(),
            'stock' => $stockQuery->get()->toArray(),
        ];
    }

    /**
     * Apply a batch of queued offline stock adjustments. Each operation is
     * idempotent on client_op_id — replaying an already-applied op (e.g.
     * after a dropped connection) returns the original result instead of
     * double-applying the stock movement.
     *
     * @param  array<int, array{client_op_id: string, sku_id: int, location_id: int, type: string, quantity: float, notes?: string}>  $operations
     * @return array<int, array{client_op_id: string, status: string, message?: string}>
     */
    public function push(string $deviceId, array $operations): array
    {
        $results = [];

        foreach ($operations as $operation) {
            $results[] = $this->applyOne($deviceId, $operation);
        }

        return $results;
    }

    /**
     * @param  array{client_op_id: string, sku_id: int, location_id: int, type: string, quantity: float, notes?: string}  $operation
     * @return array{client_op_id: string, status: string, message?: string}
     */
    private function applyOne(string $deviceId, array $operation): array
    {
        $clientOpId = $operation['client_op_id'];

        $existing = DesktopSyncOperation::query()
            ->where('user_id', TenantContext::id())
            ->where('client_op_id', $clientOpId)
            ->first();

        if ($existing) {
            return [
                'client_op_id' => $clientOpId,
                'status' => $existing->status,
                'message' => $existing->error_message,
            ];
        }

        try {
            DB::transaction(function () use ($deviceId, $operation, $clientOpId) {
                $this->adjustmentService->adjust([
                    'sku_id' => $operation['sku_id'],
                    'location_id' => $operation['location_id'],
                    'type' => $operation['type'],
                    'quantity' => $operation['quantity'],
                    'notes' => $operation['notes'] ?? 'Offline desktop adjustment',
                ]);

                DesktopSyncOperation::create([
                    'device_id' => $deviceId,
                    'client_op_id' => $clientOpId,
                    'operation_type' => 'stock_adjustment',
                    'status' => 'applied',
                    'applied_at' => now(),
                ]);
            });

            return ['client_op_id' => $clientOpId, 'status' => 'applied'];
        } catch (\Throwable $e) {
            DesktopSyncOperation::create([
                'device_id' => $deviceId,
                'client_op_id' => $clientOpId,
                'operation_type' => 'stock_adjustment',
                'status' => 'failed',
                'error_message' => $e->getMessage(),
            ]);

            return ['client_op_id' => $clientOpId, 'status' => 'failed', 'message' => $e->getMessage()];
        }
    }
}
