<?php

namespace App\Application\Services;

use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryReturn;

class InventoryReturnMutationService
{
    public function __construct(
        private InventoryReturnImportService $imports,
    ) {}

    public function findWithLoss(int $id): InventoryReturn
    {
        $return = InventoryReturn::with([
            'inventoryOrder.items.sku.offer.masterProduct',
            'inventoryOrder.channel',
        ])->findOrFail($id);

        $return->loss_amount = $return->calculateLoss();

        return $return;
    }

    /**
     * @return array{return: InventoryReturn, created: bool, ignored: bool}
     */
    public function upsertFromValidated(array $validated, int $userId): array
    {
        $order = InventoryOrder::with('items')->findOrFail((int) $validated['inventory_order_id']);
        $sumLineQty = (int) ($order->items?->sum('quantity') ?? 1);
        $returnQty = isset($validated['return_quantity'])
            ? max(1, (int) $validated['return_quantity'])
            : max(1, $sumLineQty);

        $payload = [
            'user_id' => $userId,
            'inventory_order_id' => $validated['inventory_order_id'],
            'platform_return_id' => $validated['platform_return_id'] ?? null,
            'sku_code' => $validated['sku_code'] ?? null,
            'return_quantity' => $returnQty,
            'reason' => $validated['reason'],
            'disposition' => $validated['disposition'],
            'status' => 'pending',
            'return_status' => $validated['return_status'] ?? 'return_requested',
            'inventory_status' => $validated['inventory_status'] ?? 'on_hold',
            'return_location' => $validated['return_location'] ?? null,
            'last_update_date' => $this->imports->normalizeDateTime($validated['last_update_date'] ?? null) ?? now(),
            'channel' => $validated['channel'] ?? null,
            'refund_amount' => (float) ($validated['refund_amount'] ?? 0),
            'financial_deduction' => (float) ($validated['financial_deduction'] ?? 0),
            'extra_shipping_fee' => (float) ($validated['extra_shipping_fee'] ?? 0),
            'external_status' => $validated['external_status'] ?? null,
        ];

        $return = $this->imports->findExistingReturn($payload);
        $createdNew = false;

        if ($return) {
            if (! $this->imports->shouldApplyIncomingUpdate($return, $payload['last_update_date'] ?? null)) {
                return ['return' => $return, 'created' => false, 'ignored' => true];
            }

            $return->update($payload);
        } else {
            $return = InventoryReturn::create($payload);
            $createdNew = true;
        }

        if ($createdNew && $return->disposition === 'sellable' && $return->status !== 'completed') {
            $return->refresh();

            if (! $return->processReturn()) {
                Log::warning('inventory_return.auto_process_failed', [
                    'return_id' => $return->id,
                    'inventory_order_id' => $return->inventory_order_id,
                ]);
            }

            $return = $return->fresh(['inventoryOrder.items.sku']);
        } else {
            $return->load(['inventoryOrder.items.sku']);
        }

        return ['return' => $return, 'created' => $createdNew, 'ignored' => false];
    }

    /**
     * @throws ValidationException
     */
    public function process(int $id): void
    {
        $return = InventoryReturn::findOrFail($id);

        if ($return->status === 'completed') {
            throw ValidationException::withMessages([
                'status' => ['Return already processed'],
            ]);
        }

        if (! $return->processReturn()) {
            throw ValidationException::withMessages([
                'process' => ['Failed to process return'],
            ]);
        }
    }

    /**
     * Mark return as physically received; merchant sellable lines auto-restock main store.
     */
    public function receive(int $id): InventoryReturn
    {
        $return = InventoryReturn::with('inventoryOrder')->findOrFail($id);

        if ($return->status !== 'completed') {
            $return->update([
                'status' => 'approved',
                'return_status' => 'arrived_to_warehouse',
                'inventory_status' => 'pending_confirmation',
                'last_update_date' => now(),
            ]);
        }

        $return->refresh();
        $channelId = (int) ($return->inventoryOrder?->channel_id ?? 0);
        $isMerchant = ChannelStockResolver::deductsFromMainStoreBucket($channelId);

        if (
            $isMerchant
            && $return->disposition === 'sellable'
            && $return->status !== 'completed'
        ) {
            if (! $return->processReturn()) {
                Log::warning('inventory_return.receive_restock_failed', [
                    'return_id' => $return->id,
                    'inventory_order_id' => $return->inventory_order_id,
                ]);
            }
        }

        return $return->fresh(['inventoryOrder']);
    }

    /**
     * @return array{return: InventoryReturn, ignored: bool, invalid_transition: bool, from?: string, to?: string}
     */
    public function updateFromValidated(int $id, array $validated): array
    {
        $return = InventoryReturn::findOrFail($id);

        if (array_key_exists('status', $validated)) {
            $current = (string) ($return->status ?? 'pending');
            $next = (string) $validated['status'];

            if (! $this->imports->canTransitionStatus($current, $next)) {
                if ($this->allowsMetadataOnlyStatusSync($current, $next)) {
                    unset($validated['status']);
                } else {
                    return [
                        'return' => $return,
                        'ignored' => false,
                        'invalid_transition' => true,
                        'from' => $current,
                        'to' => $next,
                    ];
                }
            }
        }

        $incomingUpdateDate = $this->imports->normalizeDateTime($validated['last_update_date'] ?? null) ?? now();

        if (! $this->imports->shouldApplyIncomingUpdate($return, $incomingUpdateDate)) {
            return ['return' => $return->fresh('inventoryOrder'), 'ignored' => true, 'invalid_transition' => false];
        }

        $validated['last_update_date'] = $incomingUpdateDate;
        $return->update($validated);

        return [
            'return' => $return->fresh('inventoryOrder'),
            'ignored' => false,
            'invalid_transition' => false,
        ];
    }

    private function allowsMetadataOnlyStatusSync(string $current, string $next): bool
    {
        return $next === 'in_transit' && in_array($current, ['approved', 'completed'], true);
    }
}
