<?php

namespace App\Application\Services;

use Carbon\Carbon;
use App\Domain\Models\Wms\InventoryRemovalItem;
use App\Domain\Models\Wms\InventoryRemovalOrder;

/**
 * Amazon All Orders sheets include FBA removal shipments as S02-… rows (item-price 0).
 * Those are not customer sales: importing them as orders deducts FBA stock incorrectly.
 * This service classifies those IDs and upserts pending removal rows (stock changes only on receive).
 */
class AmazonRemovalIntakeService
{
    public const ALL_ORDERS_SOURCE_LABEL = 'Detected from All Orders import (S02 FBA removal)';

    /**
     * Amazon All Orders "removal shipment" ids look like S02-1234567-1234567.
     */
    public function isAllOrdersRemovalShipmentId(?string $orderId): bool
    {
        $id = strtoupper(trim((string) $orderId));
        if ($id === '') {
            return false;
        }

        return (bool) preg_match('/^S02[-_]/', $id);
    }

    /**
     * @return array{created: bool, duplicate: bool, order: InventoryRemovalOrder, item: InventoryRemovalItem}
     */
    public function upsertPendingFromAllOrdersRow(
        int $userId,
        string $s02OrderId,
        string $skuCode,
        int $quantity,
        ?string $orderDate,
        ?string $currency = 'EGP'
    ): array {
        $skuCode = trim($skuCode);
        $s02OrderId = trim($s02OrderId);
        $qty = max(0, $quantity);
        $requestDate = $this->normalizeDateTime($orderDate);

        $order = $this->findByRemovalOrderId($userId, $s02OrderId);

        if (! $order) {
            $canonical = $this->findMatchingRemovalOrder($userId, $skuCode, $qty, $requestDate);
            if ($canonical) {
                $item = $this->upsertPendingItem($userId, $canonical, $skuCode, $qty, $currency);

                return [
                    'created' => false,
                    'duplicate' => true,
                    'order' => $canonical,
                    'item' => $item,
                ];
            }

            $order = InventoryRemovalOrder::query()->create([
                'user_id' => $userId > 0 ? $userId : null,
                'source' => 'amazon',
                'removal_order_id' => $s02OrderId,
                'order_source' => self::ALL_ORDERS_SOURCE_LABEL,
                'order_type' => 'Return',
                'service_speed' => null,
                'order_status' => 'Pending',
                'request_date' => $requestDate,
                'last_updated_date' => $requestDate,
                'currency' => $currency ?: 'EGP',
            ]);
            $item = $this->upsertPendingItem($userId, $order, $skuCode, $qty, $currency);

            return [
                'created' => true,
                'duplicate' => false,
                'order' => $order,
                'item' => $item,
            ];
        }

        $itemExisted = $this->findItem($order, $skuCode) !== null;
        $item = $this->upsertPendingItem($userId, $order, $skuCode, $qty, $currency);

        return [
            'created' => ! $itemExisted,
            'duplicate' => $itemExisted,
            'order' => $order,
            'item' => $item,
        ];
    }

    public function previewMatch(
        int $userId,
        string $s02OrderId,
        string $skuCode,
        int $quantity,
        ?string $orderDate
    ): ?InventoryRemovalOrder {
        return $this->findByRemovalOrderId($userId, $s02OrderId)
            ?? $this->findMatchingRemovalOrder($userId, trim($skuCode), max(0, $quantity), $this->normalizeDateTime($orderDate));
    }

    /**
     * When the official Removal Order Detail CSV arrives, rename a pending S02- sibling
     * so the same physical removal is not received twice.
     */
    public function adoptS02Sibling(
        int $userId,
        string $officialRemovalOrderId,
        string $skuCode,
        int $quantity,
        ?string $requestDate
    ): ?InventoryRemovalOrder {
        if ($this->isAllOrdersRemovalShipmentId($officialRemovalOrderId)) {
            return null;
        }

        $sibling = $this->findS02Sibling($userId, trim($skuCode), max(0, $quantity), $this->normalizeDateTime($requestDate));
        if (! $sibling) {
            return null;
        }

        $sibling->update([
            'removal_order_id' => trim($officialRemovalOrderId),
        ]);

        return $sibling->fresh();
    }

    public function findByRemovalOrderId(int $userId, string $removalOrderId): ?InventoryRemovalOrder
    {
        $id = trim($removalOrderId);
        if ($id === '') {
            return null;
        }

        return InventoryRemovalOrder::query()
            ->with('items')
            ->where('source', 'amazon')
            ->where('removal_order_id', $id)
            ->when($userId > 0, fn ($q) => $q->where('user_id', $userId))
            ->first();
    }

    public function findS02Sibling(int $userId, string $skuCode, int $quantity, ?string $requestDate): ?InventoryRemovalOrder
    {
        return $this->findMatchingRemovalOrder($userId, $skuCode, $quantity, $requestDate, s02Only: true);
    }

    private function findMatchingRemovalOrder(
        int $userId,
        string $skuCode,
        int $quantity,
        ?string $requestDate,
        bool $s02Only = false
    ): ?InventoryRemovalOrder {
        if ($skuCode === '' || $quantity <= 0) {
            return null;
        }

        $itemQuery = InventoryRemovalItem::query()
            ->with('removalOrder.items')
            ->where('sku_code', $skuCode)
            ->where('requested_quantity', $quantity)
            ->whereHas('removalOrder', function ($o) use ($userId, $requestDate, $s02Only) {
                $o->where('source', 'amazon');
                if ($userId > 0) {
                    $o->where('user_id', $userId);
                }
                if ($s02Only) {
                    $o->where('removal_order_id', 'ilike', 'S02-%');
                }
                if ($requestDate) {
                    try {
                        $day = Carbon::parse($requestDate)->toDateString();
                        $o->whereDate('request_date', $day);
                    } catch (\Throwable) {
                        // keep SKU+qty match without date if parse fails
                    }
                }
            })
            ->orderByDesc('id');

        $item = $itemQuery->first();

        return $item?->removalOrder;
    }

    private function findItem(InventoryRemovalOrder $order, string $skuCode): ?InventoryRemovalItem
    {
        return InventoryRemovalItem::query()
            ->where('inventory_removal_order_id', $order->id)
            ->where('sku_code', $skuCode)
            ->where(function ($q) {
                $q->whereNull('disposition')->orWhere('disposition', '');
            })
            ->first();
    }

    private function upsertPendingItem(
        int $userId,
        InventoryRemovalOrder $order,
        string $skuCode,
        int $quantity,
        ?string $currency
    ): InventoryRemovalItem {
        $existing = $this->findItem($order, $skuCode);
        $payload = [
            'user_id' => $userId > 0 ? $userId : null,
            'inventory_removal_order_id' => $order->id,
            'sku_code' => $skuCode,
            'fnsku' => null,
            'disposition' => null,
            'requested_quantity' => $quantity,
            'cancelled_quantity' => 0,
            'disposed_quantity' => 0,
            'shipped_quantity' => 0,
            'in_process_quantity' => $quantity,
            'removal_fee' => null,
            'currency' => $currency ?: $order->currency,
        ];

        if ($existing) {
            if ((string) $existing->receive_status === 'received') {
                return $existing;
            }
            $existing->update($payload);

            return $existing->fresh() ?? $existing;
        }

        return InventoryRemovalItem::query()->create(array_merge($payload, [
            'receive_status' => 'pending',
            'received_quantity' => 0,
        ]));
    }

    private function normalizeDateTime(?string $value): ?string
    {
        $raw = trim((string) ($value ?? ''));
        if ($raw === '') {
            return null;
        }
        try {
            return Carbon::parse($raw)->toDateTimeString();
        } catch (\Throwable) {
            return null;
        }
    }
}
