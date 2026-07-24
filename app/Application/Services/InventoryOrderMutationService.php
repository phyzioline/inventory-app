<?php

namespace App\Application\Services;

use Exception;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\Customer;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryOrderItem;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\Receipt;
use App\Domain\Models\Wms\SettlementItem;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;

class InventoryOrderMutationService
{
    private function filterOrderColumns(array $payload): array
    {
        static $columns = null;
        if ($columns === null) {
            $columns = array_flip(Schema::getColumnListing('inventory_orders'));
        }

        return array_intersect_key($payload, $columns);
    }

    private function filterTransactionColumns(array $payload): array
    {
        static $columns = null;
        if ($columns === null) {
            $columns = array_flip(Schema::getColumnListing('inventory_transactions'));
        }

        return array_intersect_key($payload, $columns);
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        // Legacy payload path (old endpoint contract)
        if (
            $request->filled('channel_id')
            && $request->filled('location_id')
            && is_array($request->input('items'))
            && isset($request->input('items')[0]['sku_id'])
        ) {
            return $this->storeLegacyOrder($request);
        }

        // New manual sales payload (CreateSalesOrderDialog)
        return $this->storeManualSalesOrder($request);
    }

    private function storeLegacyOrder(Request $request)
    {
        $validated = $request->validate([
            'channel_id' => 'required|exists:channels,id',
            'order_date' => 'required|date',
            'platform_order_id' => 'nullable|string',
            'customer_id' => 'nullable|exists:customers,id',
            'customer_name' => 'nullable|string',
            'customer_email' => 'nullable|email',
            'customer_phone' => 'nullable|string',
            'shipping_address' => 'nullable|string',
            'total_amount' => 'required|numeric',
            'shipping_amount' => 'nullable|numeric',
            'tax_amount' => 'nullable|numeric',
            'items' => 'required|array|min:1',
            'items.*.sku_id' => 'required|exists:skus,id',
            'items.*.quantity' => 'required|integer|min:1',
            'items.*.unit_price' => 'required|numeric',
            'location_id' => 'required|exists:inventory_locations,id',
        ]);

        DB::beginTransaction();

        try {
            $legacyPayload = [
                'channel_id' => $validated['channel_id'],
                'order_date' => $validated['order_date'],
                'platform_order_id' => $validated['platform_order_id']
                    ?? ('LEGACY-'.strtoupper(uniqid('', true))),
                'currency' => 'EGP',
                'discount_amount' => 0,
                'customer_name' => $validated['customer_name'] ?? null,
                'customer_email' => $validated['customer_email'] ?? null,
                'customer_phone' => $validated['customer_phone'] ?? null,
                'shipping_address' => $validated['shipping_address'] ?? null,
                'total_amount' => $validated['total_amount'],
                'shipping_amount' => $validated['shipping_amount'] ?? 0,
                'tax_amount' => $validated['tax_amount'] ?? 0,
                'payment_type' => 'credit',
                'paid_amount' => 0,
                'remaining_amount' => $validated['total_amount'],
                'status' => 'pending', // Initial status
                'financial_status' => 'pending',
                'settlement_status' => 'pending',
                'user_id' => Auth::id(),
            ];
            if (! empty($validated['customer_id'])) {
                $legacyPayload['customer_id'] = (int) $validated['customer_id'];
            }
            // Create Order
            $order = InventoryOrder::create($this->filterOrderColumns($legacyPayload));

            // Process Items
            foreach ($validated['items'] as $itemData) {
                $sku = Sku::query()->find($itemData['sku_id']);
                $qty = (int) $itemData['quantity'];
                $unit = (float) $itemData['unit_price'];

                InventoryOrderItem::create([
                    'inventory_order_id' => $order->id,
                    'sku_id' => $itemData['sku_id'],
                    'sku_code' => $sku?->sku ?? (string) $itemData['sku_id'],
                    'product_name' => $sku?->name ?? $sku?->sku ?? 'SKU '.$itemData['sku_id'],
                    'quantity' => $qty,
                    'unit_price' => $unit,
                    'total_price' => $qty * $unit,
                ]);

                $this->deductInventory($itemData['sku_id'], $validated['location_id'], $qty, $order->id);
            }

            DB::commit();

            return response()->json([
                'message' => 'Order created successfully',
                'order' => $order->load('items.sku'),
            ], 201);

        } catch (Exception $e) {
            DB::rollBack();
            if ((int) $e->getCode() === 422) {
                return response()->json([
                    'message' => $e->getMessage(),
                    'error' => $e->getMessage(),
                ], 422);
            }

            return response()->json([
                'message' => 'Failed to create order',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    private function storeManualSalesOrder(Request $request)
    {
        $validated = $request->validate([
            'order_number' => 'required|string|max:100',
            'warehouse_id' => 'required|exists:inventory_locations,id',
            'fulfillment_warehouse_id' => 'nullable|exists:inventory_locations,id',
            'credit_warehouse_id' => 'nullable|exists:inventory_locations,id',
            'payment_type' => 'nullable|string|in:cash,credit',
            'paid_amount' => 'nullable|numeric|min:0',
            'customer_id' => 'nullable|exists:customers,id',
            'customer_name' => 'nullable|string|max:255',
            'customer_phone' => 'nullable|string|max:255',
            'shipping_address' => 'nullable|string|max:2000',
            'notes' => 'nullable|string|max:2000',
            'marketplace_source' => 'required|string|max:100',
            'external_order_number' => 'nullable|string|max:255',
            'source_account_email' => 'nullable|string|max:255',
            'auto_pull_from_source' => 'nullable|boolean',
            'tax_amount' => 'nullable|numeric|min:0',
            'discount_amount' => 'nullable|numeric|min:0',
            'total_amount' => 'required|numeric|min:0',
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required|exists:master_products,id',
            'items.*.quantity' => 'required|numeric|min:1',
            'items.*.unit_price' => 'required|numeric|min:0',
        ]);

        $channelId = $this->resolveChannelIdForManualSales($validated);
        if (! $channelId) {
            return response()->json([
                'message' => 'Could not map the selected channel/account to an active sales channel.',
            ], 422);
        }

        $linkedCustomer = null;
        if (! empty($validated['customer_id'])) {
            $linkedCustomer = Customer::query()->find((int) $validated['customer_id']);
        }

        $sourceLocationId = (int) $validated['warehouse_id'];
        $fulfillmentLocationId = (int) ($validated['fulfillment_warehouse_id'] ?? $sourceLocationId);
        $autoPull = (bool) ($validated['auto_pull_from_source'] ?? false);
        $paymentType = (string) ($validated['payment_type'] ?? 'cash');
        $totalAmount = (float) ($validated['total_amount'] ?? 0);
        $taxAmount = (float) ($validated['tax_amount'] ?? 0);
        $discountAmount = (float) ($validated['discount_amount'] ?? 0);
        $paidAmount = $validated['paid_amount'] ?? null;
        $paidAmount = $paidAmount === null
            ? ($paymentType === 'cash' ? $totalAmount : 0.0)
            : (float) $paidAmount;
        $paidAmount = min(max(0.0, $paidAmount), max(0.0, $totalAmount));
        $remainingAmount = max(0.0, $totalAmount - $paidAmount);
        $isFullyPaid = $remainingAmount <= 0.0001;

        DB::beginTransaction();
        try {
            $externalRef = trim((string) ($validated['external_order_number'] ?? ''));
            $platformOrderId = $externalRef !== '' ? $externalRef : $validated['order_number'];
            if (InventoryOrder::where('platform_order_id', $platformOrderId)->exists()) {
                $platformOrderId = $validated['order_number'].'-'.strtoupper(substr(md5((string) microtime(true)), 0, 6));
            }

            $resolvedCustomerName = $validated['customer_name']
                ?? ($linkedCustomer?->name)
                ?? 'Direct Customer';
            $resolvedCustomerEmail = $validated['source_account_email']
                ?? ($linkedCustomer?->email);
            $resolvedCustomerPhone = trim((string) ($validated['customer_phone'] ?? ''))
                ?: ($linkedCustomer?->phone);
            $resolvedShippingAddress = trim((string) ($validated['shipping_address'] ?? '')) ?: null;
            $resolvedNotes = trim((string) ($validated['notes'] ?? '')) ?: null;

            $orderPayload = [
                'channel_id' => $channelId,
                'order_date' => now(),
                'platform_order_id' => $platformOrderId,
                'customer_name' => $resolvedCustomerName,
                'customer_email' => $resolvedCustomerEmail,
                'customer_phone' => $resolvedCustomerPhone ?: null,
                'shipping_address' => $resolvedShippingAddress,
                'notes' => $resolvedNotes,
                'currency' => 'EGP',
                'total_amount' => $totalAmount,
                'shipping_amount' => 0,
                'tax_amount' => $taxAmount,
                'discount_amount' => $discountAmount,
                // Fully paid at creation (typical cash POS): treat as completed sale, not workflow "pending".
                'status' => $isFullyPaid ? 'sold' : 'pending',
                'payment_type' => $paymentType,
                'paid_amount' => $paidAmount,
                'remaining_amount' => $remainingAmount,
                'financial_status' => $isFullyPaid ? 'charged' : 'pending',
                'settlement_status' => $isFullyPaid ? 'settled' : 'pending',
                'user_id' => Auth::id(),
            ];
            if ($linkedCustomer) {
                $orderPayload['customer_id'] = $linkedCustomer->id;
            }
            if ($resolvedCustomerPhone !== null && $resolvedCustomerPhone !== '') {
                $orderPayload['customer_phone'] = $resolvedCustomerPhone;
            }
            $order = InventoryOrder::create($this->filterOrderColumns($orderPayload));

            foreach ($validated['items'] as $itemData) {
                $sku = $this->resolveSkuForManualOrder((int) $itemData['product_id'], $channelId);
                if (! $sku) {
                    throw new Exception("No SKU mapped for master product ID {$itemData['product_id']} on selected channel.");
                }

                $qty = (float) $itemData['quantity'];
                if (ChannelStockResolver::deductsFromMainStoreBucket($channelId)) {
                    $plan = ChannelStockResolver::planMerchantOrderDeduction((int) $sku->id, $channelId, $qty);
                    if (! $plan['can_fulfill']) {
                        throw new Exception(
                            'الرصيد غير كافٍ في المحل لهذا المنتج على قناة التاجر.',
                            422
                        );
                    }
                    if ($plan['deduct_store_qty'] > 0.0000001 && ! empty($plan['store_sku_id']) && ! empty($plan['store_location_id'])) {
                        $this->deductInventory((int) $plan['store_sku_id'], (int) $plan['store_location_id'], (float) $plan['deduct_store_qty'], $order->id);
                    }
                } else {
                    if ($autoPull && $sourceLocationId !== $fulfillmentLocationId) {
                        $this->autoTransferFromSourceToFulfillment($sku->id, $sourceLocationId, $fulfillmentLocationId, $qty, $order->id);
                    }

                    $this->deductInventory($sku->id, $fulfillmentLocationId, $qty, $order->id);
                }

                InventoryOrderItem::create([
                    'inventory_order_id' => $order->id,
                    'sku_id' => $sku->id,
                    'sku_code' => $sku->sku,
                    'product_name' => $sku->name ?? $sku->sku,
                    'quantity' => $qty,
                    'unit_price' => $itemData['unit_price'],
                    'total_price' => $qty * (float) $itemData['unit_price'],
                ]);
            }

            if ($paidAmount > 0.00001) {
                $this->autoCreateReceiptForOrder($order, $paidAmount, $paymentType, $resolvedCustomerName);
            }

            DB::commit();

            return response()->json([
                'message' => 'Sales order created successfully',
                'order' => $order->load(['items.sku', 'channel']),
            ], 201);
        } catch (Exception $e) {
            DB::rollBack();
            if ((int) $e->getCode() === 422) {
                return response()->json([
                    'message' => $e->getMessage(),
                    'error' => $e->getMessage(),
                ], 422);
            }

            return response()->json([
                'message' => 'Failed to create sales order',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Deduct inventory and log transaction.
     */
    private function deductInventory($skuId, $locationId, $quantity, $orderId)
    {
        $inventory = SkuInventory::query()
            ->where('sku_id', $skuId)
            ->where('location_id', $locationId)
            ->lockForUpdate()
            ->first();

        if (! $inventory) {
            $inventory = SkuInventory::create([
                'sku_id' => $skuId,
                'location_id' => $locationId,
                'quantity' => 0,
                'reserved' => 0,
                'user_id' => Auth::id(),
            ]);
            $inventory = SkuInventory::query()->whereKey($inventory->id)->lockForUpdate()->first();
        }

        if ((float) $inventory->quantity < (float) $quantity) {
            throw new Exception(
                "Insufficient stock for SKU ID {$skuId} at location {$locationId}. Available: {$inventory->quantity}, requested: {$quantity}.",
                422
            );
        }

        $inventory->decrement('quantity', $quantity);

        // Create transaction log
        InventoryTransaction::create($this->filterTransactionColumns([
            'sku_id' => $skuId,
            'location_id' => $locationId,
            'type' => 'OUT',
            'quantity' => $quantity,
            'reference_type' => 'Order',
            'reference_id' => $orderId,
            'user_id' => Auth::id(),
            'notes' => 'Order Fulfillment',
        ]));
    }

    private function autoTransferFromSourceToFulfillment(int $skuId, int $sourceLocationId, int $fulfillmentLocationId, float $quantity, int $orderId): void
    {
        $source = SkuInventory::query()
            ->where('sku_id', $skuId)
            ->where('location_id', $sourceLocationId)
            ->lockForUpdate()
            ->first();
        if (! $source) {
            $source = SkuInventory::create([
                'sku_id' => $skuId,
                'location_id' => $sourceLocationId,
                'quantity' => 0,
                'reserved' => 0,
                'user_id' => Auth::id(),
            ]);
            $source = SkuInventory::query()->whereKey($source->id)->lockForUpdate()->first();
        }
        $destination = SkuInventory::firstOrCreate(
            ['sku_id' => $skuId, 'location_id' => $fulfillmentLocationId],
            ['quantity' => 0, 'reserved' => 0, 'user_id' => Auth::id()]
        );

        if ((float) $source->quantity < (float) $quantity) {
            throw new Exception(
                "Insufficient stock at source location {$sourceLocationId} for auto-transfer. Available: {$source->quantity}, requested: {$quantity}.",
                422
            );
        }

        $source->decrement('quantity', $quantity);
        $destination->increment('quantity', $quantity);

        InventoryTransaction::create($this->filterTransactionColumns([
            'sku_id' => $skuId,
            'location_id' => $sourceLocationId,
            'type' => 'OUT',
            'quantity' => $quantity,
            'reference_type' => 'AutoTransferBeforeSale',
            'reference_id' => $orderId,
            'user_id' => Auth::id(),
            'notes' => 'Auto transfer to fulfillment location before merchant sale',
        ]));

        InventoryTransaction::create($this->filterTransactionColumns([
            'sku_id' => $skuId,
            'location_id' => $fulfillmentLocationId,
            'type' => 'IN',
            'quantity' => $quantity,
            'reference_type' => 'AutoTransferBeforeSale',
            'reference_id' => $orderId,
            'user_id' => Auth::id(),
            'notes' => 'Auto transfer from source location before merchant sale',
        ]));
    }

    private function resolveSkuForManualOrder(int $masterProductId, int $channelId): ?Sku
    {
        $preferred = Sku::query()
            ->where('channel_id', $channelId)
            ->whereHas('offer', function ($q) use ($masterProductId) {
                $q->where('master_product_id', $masterProductId);
            })
            ->first();

        if ($preferred) {
            return $preferred;
        }

        // For POS/direct sales, ensure we still prefer the main store SKU even if the selected "channel"
        // mapping fell back to a non-store channel.
        $storeChannelId = ChannelStockResolver::resolveMainStoreChannelId();
        if ($storeChannelId > 0 && $storeChannelId !== $channelId) {
            $storeSku = Sku::query()
                ->where('channel_id', $storeChannelId)
                ->whereHas('offer', function ($q) use ($masterProductId) {
                    $q->where('master_product_id', $masterProductId);
                })
                ->first();
            if ($storeSku) {
                return $storeSku;
            }
        }

        return Sku::query()
            ->whereHas('offer', function ($q) use ($masterProductId) {
                $q->where('master_product_id', $masterProductId);
            })
            ->first();
    }

    private function resolveChannelIdForManualSales(array $validated): ?int
    {
        if (! empty($validated['channel_id'])) {
            return (int) $validated['channel_id'];
        }

        $marketplaceSource = strtolower((string) ($validated['marketplace_source'] ?? ''));
        if ($marketplaceSource === 'direct') {
            // POS/Shop sales should always be attributed to the main store channel.
            $storeId = ChannelStockResolver::resolveMainStoreChannelId();
            if ($storeId > 0) {
                return $storeId;
            }
        }
        $channels = Channel::query()
            ->where(function ($q) {
                $q->where('is_active', true)->orWhereNull('is_active');
            })
            ->get();
        if ($channels->isEmpty()) {
            // Fallback for legacy rows where is_active is missing/false by mistake.
            $channels = Channel::query()->get();
        }
        if ($channels->isEmpty()) {
            return null;
        }

        // If account email is provided, first try to match channel by credentials JSON.
        $sourceEmail = strtolower(trim((string) ($validated['source_account_email'] ?? '')));
        if ($sourceEmail !== '') {
            $byEmail = Channel::query()
                ->where(function ($q) {
                    $q->where('is_active', true)->orWhereNull('is_active');
                })
                ->where(function ($q) use ($sourceEmail) {
                    $q->whereJsonContains('credentials->account_email', $sourceEmail)
                        ->orWhereJsonContains('credentials->email', $sourceEmail);
                })
                ->first();
            if ($byEmail) {
                return (int) $byEmail->id;
            }
        }

        $matcher = match ($marketplaceSource) {
            'amazon_fba' => fn ($name, $slug) => str_contains($name, 'amazon') && (str_contains($name, 'fba') || str_contains($slug, 'fba') || str_contains($slug, 'afn')),
            'amazon_store' => fn ($name, $slug) => str_contains($name, 'amazon') && (str_contains($name, 'merchant') || str_contains($name, 'تاجر') || str_contains($slug, 'merchant') || str_contains($slug, 'mfn') || str_contains($slug, 'fbm')),
            'noon' => fn ($name, $slug) => str_contains($name, 'noon') || str_contains($slug, 'noon') || str_contains($name, 'نون'),
            'jumia' => fn ($name, $slug) => str_contains($name, 'jumia') || str_contains($slug, 'jumia') || str_contains($name, 'جوميا'),
            default => fn ($name, $slug) => str_contains($name, 'store') || str_contains($name, 'shop') || str_contains($name, 'المحل') || str_contains($slug, 'store') || str_contains($slug, 'physical') || str_contains($name, 'physical'),
        };

        foreach ($channels as $channel) {
            $name = strtolower((string) $channel->name);
            $slug = strtolower((string) $channel->slug);
            if ($matcher($name, $slug)) {
                return (int) $channel->id;
            }
        }

        // Last-resort fallback: prefer the main store channel if it exists.
        $storeId = ChannelStockResolver::resolveMainStoreChannelId();
        if ($storeId > 0) {
            return $storeId;
        }

        return (int) ($channels->first()->id ?? 0) ?: null;
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, $id)
    {
        $order = InventoryOrder::findOrFail($id);

        $validated = $request->validate([
            'status' => 'sometimes|string|in:pending,processing,completed,cancelled,shipped,delivered,sold,return_in_progress,returned,rejected',
            'customer_name' => 'sometimes|nullable|string|max:255',
            'shipping_address' => 'sometimes|nullable|string|max:2000',
            'payment_type' => 'sometimes|nullable|string|in:cash,credit',
            'paid_amount' => 'sometimes|nullable|numeric|min:0',
            'remaining_amount' => 'sometimes|nullable|numeric|min:0',
            'total_amount' => 'sometimes|nullable|numeric|min:0',
            'tax_amount' => 'sometimes|nullable|numeric|min:0',
            'discount_amount' => 'sometimes|nullable|numeric|min:0',
            'items' => 'sometimes|array|min:1',
            'items.*.id' => 'sometimes',
            'items.*.sku_id' => 'sometimes|nullable|exists:skus,id',
            'items.*.product_id' => 'sometimes|nullable',
            'items.*.quantity' => 'required_with:items|numeric|min:0',
            'items.*.unit_price' => 'required_with:items|numeric|min:0',
        ]);

        $hasItems = array_key_exists('items', $validated);

        DB::beginTransaction();
        try {
            if (! $hasItems) {
                $previousPaid = (float) ($order->paid_amount ?? 0);
                $prevCustomerName = (string) ($order->customer_name ?? '');
                $updatePayload = $this->filterOrderColumns($validated);
                // Recalculate settlement/financial status from updated amounts
                $updatedPaid = array_key_exists('paid_amount', $validated) ? (float) ($validated['paid_amount'] ?? 0) : (float) ($order->paid_amount ?? 0);
                $updatedRemaining = array_key_exists('remaining_amount', $validated) ? (float) ($validated['remaining_amount'] ?? 0) : (float) ($order->remaining_amount ?? 0);
                $isNowFullyPaid = $updatedRemaining <= 0.0001;
                $updatePayload['settlement_status'] = $isNowFullyPaid ? 'settled' : 'pending';
                $updatePayload['financial_status'] = $isNowFullyPaid ? 'charged' : 'pending';
                $order->update($updatePayload);
                $payDelta = round($updatedPaid - $previousPaid, 2);
                if ($payDelta > 0.00001) {
                    $prevPayType = (string) (($validated['payment_type'] ?? $order->payment_type) ?: 'cash');
                    $this->autoCreateReceiptForOrder($order, $payDelta, $prevPayType, $prevCustomerName ?: 'Customer');
                }
                DB::commit();

                return response()->json([
                    'message' => 'Order updated successfully',
                    'order' => $order->fresh(['items.sku.offer.masterProduct', 'channel', 'costs', 'settlementItems']),
                ]);
            }

            $previousPaid = (float) ($order->paid_amount ?? 0);
            $prevCustomerName = (string) ($order->customer_name ?? '');

            $locationId = $this->resolveOrderPrimaryLocationId($order);
            if ($locationId === null) {
                return response()->json([
                    'message' => 'Cannot edit this order because its stock location could not be determined.',
                ], 422);
            }

            // Build old/new qty maps by SKU.
            // Use withoutGlobalScopes() so items created before user_id was added (or under a
            // different user context) are still included in the delta calculation and deletion.
            $oldItems = InventoryOrderItem::withoutGlobalScopes()
                ->where('inventory_order_id', $order->id)
                ->get();
            $oldItemById = $oldItems->keyBy('id');

            $oldQtyBySku = [];
            foreach ($oldItems as $it) {
                $sid = (int) ($it->sku_id ?? 0);
                if ($sid <= 0) {
                    continue;
                }
                $oldQtyBySku[$sid] = ($oldQtyBySku[$sid] ?? 0.0) + (float) ($it->quantity ?? 0);
            }

            $newQtyBySku = [];
            $newLines = [];
            foreach ((array) $validated['items'] as $row) {
                $sid = $this->resolveSkuIdFromUpdateRow($row, $oldItemById);
                $qty = (float) ($row['quantity'] ?? 0);
                $unit = (float) ($row['unit_price'] ?? 0);
                // Items without a resolvable SKU (e.g. manually typed sku_code) skip inventory
                // delta but are still persisted with updated price/qty.
                if ($sid !== null) {
                    $newQtyBySku[$sid] = ($newQtyBySku[$sid] ?? 0.0) + $qty;
                }
                // Preserve sku_code and product_name from the original item when available.
                $existingItem = isset($row['id']) ? ($oldItemById[(int) $row['id']] ?? null) : null;
                $newLines[] = [
                    'sku_id' => $sid,
                    'sku_code' => $existingItem?->sku_code ?? ($sid ? ('SKU-'.$sid) : 'ITEM'),
                    'product_name' => $existingItem?->product_name ?? ($sid ? ('Item '.$sid) : 'Item'),
                    'quantity' => $qty,
                    'unit_price' => $unit,
                ];
            }

            $this->applyInventoryDeltasForOrderEdit($order, (int) $locationId, $oldQtyBySku, $newQtyBySku);

            // Replace order items with new lines — delete ALL rows regardless of user_id scope.
            InventoryOrderItem::withoutGlobalScopes()
                ->where('inventory_order_id', $order->id)
                ->delete();

            foreach ($newLines as $line) {
                if ($line['sku_id'] !== null) {
                    $sku = Sku::query()->with(['offer.masterProduct'])->find($line['sku_id']);
                    $skuCode = $sku?->sku ?? $line['sku_code'];
                    $productName = $sku?->offer?->masterProduct?->internal_name
                        ?? ($sku?->offer?->name)
                        ?? ($sku?->sku)
                        ?? $line['product_name'];
                } else {
                    $sku = null;
                    $skuCode = $line['sku_code'];
                    $productName = $line['product_name'];
                }
                $qty = (float) $line['quantity'];
                $unit = (float) $line['unit_price'];
                InventoryOrderItem::create([
                    'inventory_order_id' => $order->id,
                    'sku_id' => $line['sku_id'],
                    'sku_code' => $skuCode,
                    'product_name' => $productName,
                    'quantity' => $qty,
                    'unit_price' => $unit,
                    'total_price' => $qty * $unit,
                    'user_id' => Auth::id(),
                ]);
            }

            // Recompute totals defensively (server source-of-truth).
            // Use withoutGlobalScopes() so the new items (just created) are always visible.
            $freshItems = InventoryOrderItem::withoutGlobalScopes()
                ->where('inventory_order_id', $order->id)
                ->get();
            $computedTotal = (float) $freshItems->sum(function ($it) {
                return (float) ($it->total_price ?? ((float) $it->quantity * (float) $it->unit_price));
            });
            $taxAmount = array_key_exists('tax_amount', $validated)
                ? (float) ($validated['tax_amount'] ?? 0)
                : (float) ($order->tax_amount ?? 0);
            $discountAmount = array_key_exists('discount_amount', $validated)
                ? (float) ($validated['discount_amount'] ?? 0)
                : (float) ($order->discount_amount ?? 0);
            $computedGrand = max(0.0, $computedTotal - max(0.0, $discountAmount) + max(0.0, $taxAmount));
            $paymentType = (string) (($validated['payment_type'] ?? $order->payment_type) ?: 'cash');
            $paidAmount = array_key_exists('paid_amount', $validated)
                ? (float) ($validated['paid_amount'] ?? 0)
                : (float) ($order->paid_amount ?? 0);
            if ($paymentType === 'cash') {
                $paidAmount = $computedGrand;
            } else {
                $paidAmount = max(0.0, min($paidAmount, max(0.0, $computedGrand)));
            }
            $remainingAmount = max(0.0, $computedGrand - $paidAmount);

            $orderUpdate = $this->filterOrderColumns(array_merge($validated, [
                'tax_amount' => $taxAmount,
                'discount_amount' => $discountAmount,
                'total_amount' => $computedGrand,
                'payment_type' => $paymentType,
                'paid_amount' => $paidAmount,
                'remaining_amount' => $remainingAmount,
                'settlement_status' => $remainingAmount <= 0.0001 ? 'settled' : 'pending',
                'financial_status' => $remainingAmount <= 0.0001 ? 'charged' : 'pending',
            ]));
            unset($orderUpdate['items']);
            $order->update($orderUpdate);

            $itemsDelta = round($paidAmount - $previousPaid, 2);
            if ($itemsDelta > 0.00001) {
                $this->autoCreateReceiptForOrder($order, $itemsDelta, $paymentType, $prevCustomerName ?: 'Customer');
            }

            DB::commit();

            $fresh = $order->fresh(['items.sku.offer.masterProduct', 'channel', 'costs', 'settlementItems']);
            app(ProfitEngineService::class)->hydrateOrderCollectionWithEffectivePurchaseCosts([$fresh]);

            return response()->json([
                'message' => 'Order updated successfully',
                'order' => $fresh,
            ]);
        } catch (Exception $e) {
            DB::rollBack();

            return response()->json([
                'message' => 'Failed to update order',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    private function resolveSkuIdFromUpdateRow(array $row, ?\Illuminate\Support\Collection $oldItemById = null): ?int
    {
        if (isset($row['sku_id']) && $row['sku_id'] !== null && $row['sku_id'] !== '') {
            return (int) $row['sku_id'];
        }

        // Frontend may send product_id that is actually a sku_id.
        if (isset($row['product_id']) && $row['product_id'] !== null && $row['product_id'] !== '') {
            $candidate = (int) $row['product_id'];
            if ($candidate > 0 && Sku::query()->whereKey($candidate)->exists()) {
                return $candidate;
            }
        }

        // Fallback: use the existing item record looked up by id.
        if ($oldItemById !== null && isset($row['id']) && (int) $row['id'] > 0) {
            $existing = $oldItemById[(int) $row['id']] ?? null;
            if ($existing && $existing->sku_id) {
                return (int) $existing->sku_id;
            }
        }

        // Item has no resolvable SKU — caller will skip inventory delta for this item.
        return null;
    }

    private function resolveOrderPrimaryLocationId(InventoryOrder $order): ?int
    {
        $candidates = [
            $order->fulfillment_warehouse_id ?? null,
            $order->warehouse_id ?? null,
            $order->location_id ?? null,
            $order->inventory_location_id ?? null,
        ];
        foreach ($candidates as $c) {
            $id = (int) ($c ?? 0);
            if ($id > 0) {
                return $id;
            }
        }

        $tx = InventoryTransaction::query()
            ->where('reference_id', (string) $order->id)
            ->whereIn('reference_type', ['Order', 'AutoTransferBeforeSale', 'OrderEdit'])
            ->orderByDesc('id')
            ->first();
        if ($tx && (int) $tx->location_id > 0) {
            return (int) $tx->location_id;
        }

        return null;
    }

    /**
     * Auto-create a Receipt record for a paid order so it appears in the customer receipts tab.
     * Called inside an active DB transaction — does NOT wrap in a nested transaction.
     */
    private function autoCreateReceiptForOrder(
        InventoryOrder $order,
        float $amount,
        string $paymentMethod,
        string $payerName
    ): void {
        if ($amount <= 0.00001) {
            return;
        }

        $userId = (int) Auth::id();
        $ledger = app(FinanceAccountLedgerService::class);
        $ledger->ensureDefaultAccountsForUser($userId);
        $financeAccountId = $ledger->resolveFinanceAccountId(null, $paymentMethod, $userId);

        Receipt::create([
            'receipt_number' => app(ReceiptApplicationService::class)->generateNextReceiptNumber(),
            'type' => 'Customer Payment',
            'category' => 'customer_collection',
            'amount' => round($amount, 2),
            'description' => 'مقبوضة تلقائية — فاتورة #'.($order->platform_order_id ?? $order->id),
            'receipt_date' => now()->toDateString(),
            'payment_method' => $paymentMethod,
            'finance_account_id' => $financeAccountId,
            'reference_type' => InventoryOrder::class,
            'reference_id' => $order->id,
            'payer_name' => $payerName,
            'user_id' => $userId,
            'warehouse_id' => null,
            'external_reference' => 'auto_receipt',
        ]);
    }

    /**
     * Apply stock deltas for order edit (positive diff => OUT, negative diff => IN).
     *
     * @param  array<int, float>  $oldQtyBySku
     * @param  array<int, float>  $newQtyBySku
     */
    private function applyInventoryDeltasForOrderEdit(InventoryOrder $order, int $locationId, array $oldQtyBySku, array $newQtyBySku): void
    {
        $allSkuIds = array_unique(array_merge(array_keys($oldQtyBySku), array_keys($newQtyBySku)));
        foreach ($allSkuIds as $sid) {
            $sid = (int) $sid;
            if ($sid <= 0) {
                continue;
            }
            $old = (float) ($oldQtyBySku[$sid] ?? 0.0);
            $new = (float) ($newQtyBySku[$sid] ?? 0.0);
            $diff = $new - $old;
            if (abs($diff) <= 0.00001) {
                continue;
            }

            $inv = SkuInventory::firstOrCreate(
                ['sku_id' => $sid, 'location_id' => $locationId],
                ['quantity' => 0, 'reserved' => 0, 'user_id' => Auth::id()]
            );

            if ($diff > 0) {
                // Need more stock OUT.
                $inv->decrement('quantity', $diff);
                InventoryTransaction::create($this->filterTransactionColumns([
                    'sku_id' => $sid,
                    'location_id' => $locationId,
                    'type' => 'OUT',
                    'quantity' => $diff,
                    'reference_type' => 'OrderEdit',
                    'reference_id' => (string) $order->id,
                    'user_id' => Auth::id(),
                    'notes' => 'Order edit: increase quantity',
                ]));
            } else {
                // Return stock IN.
                $inv->increment('quantity', abs($diff));
                InventoryTransaction::create($this->filterTransactionColumns([
                    'sku_id' => $sid,
                    'location_id' => $locationId,
                    'type' => 'IN',
                    'quantity' => abs($diff),
                    'reference_type' => 'OrderEdit',
                    'reference_id' => (string) $order->id,
                    'user_id' => Auth::id(),
                    'notes' => 'Order edit: decrease quantity',
                ]));
            }
        }
    }

    /**
     * Mark an order as cancelled for accounting/UI (same flags as marketplace import cancellations).
     * Excludes the order from profit-by-period queries; clears pending-receivable style totals when amounts are zeroed.
     */
    public function cancel(Request $request, $id)
    {
        $order = InventoryOrder::findOrFail($id);

        $validated = $request->validate([
            'force' => 'sometimes|boolean',
        ]);
        $force = (bool) ($validated['force'] ?? false);

        $status = strtolower((string) ($order->status ?? ''));
        $financial = strtolower((string) ($order->financial_status ?? ''));
        if ($status === 'cancelled' && $financial === 'cancelled') {
            return response()->json([
                'message' => 'Order is already cancelled.',
                'order' => $order->fresh(['channel', 'items.sku.offer.masterProduct', 'costs', 'settlementItems']),
            ]);
        }

        $settlement = strtolower((string) ($order->settlement_status ?? ''));
        if ($settlement === 'settled' && ! $force) {
            return response()->json([
                'message' => 'This order is marked as settled. Confirm to unlink settlement rows from this order and cancel it.',
                'requires_force' => true,
            ], 422);
        }

        DB::beginTransaction();
        try {
            if ($settlement === 'settled' && $force) {
                SettlementItem::query()
                    ->where('inventory_order_id', $order->id)
                    ->update(['inventory_order_id' => null]);
            }

            // Roll back inventory movements created by this order (and any auto-transfer/edit deltas).
            // This returns stock to the same location(s) it was deducted from.
            $this->rollbackInventoryForOrderCancellation($order);

            $payload = $this->filterOrderColumns([
                'status' => 'cancelled',
                'financial_status' => 'cancelled',
                'settlement_status' => 'cancelled',
                'total_amount' => 0,
                'paid_amount' => 0,
                'remaining_amount' => 0,
                'shipping_amount' => 0,
                'tax_amount' => 0,
            ]);
            $order->update($payload);

            DB::commit();
        } catch (Exception $e) {
            DB::rollBack();

            return response()->json([
                'message' => 'Failed to cancel order',
                'error' => $e->getMessage(),
            ], 500);
        }

        $fresh = $order->fresh(['channel', 'items.sku.offer.masterProduct', 'costs', 'settlementItems']);
        app(ProfitEngineService::class)->hydrateOrderCollectionWithEffectivePurchaseCosts([$fresh]);

        return response()->json([
            'message' => 'Order cancelled successfully',
            'order' => $fresh,
        ]);
    }

    /**
     * Reverse inventory transactions that were created for this order.
     *
     * Strategy:
     * - Aggregate net movement per (sku_id, location_id) across reference types related to orders.
     * - Apply inverse net movement, with safety checks to never go negative.
     *
     * This correctly handles cases where we auto-transfer from a source location to a fulfillment location
     * before deducting for the sale: reversing both returns stock to the original source.
     */
    private function rollbackInventoryForOrderCancellation(InventoryOrder $order): void
    {
        $orderId = (int) $order->id;
        if ($orderId <= 0) {
            return;
        }

        $types = ['Order', 'AutoTransferBeforeSale', 'OrderEdit'];

        $rows = InventoryTransaction::query()
            ->where('reference_id', (string) $orderId)
            ->whereIn('reference_type', $types)
            ->whereIn('type', ['IN', 'OUT'])
            ->get();

        if ($rows->isEmpty()) {
            return;
        }

        // net = IN - OUT (positive means inventory was added to that location for this order flow)
        $netByKey = [];
        foreach ($rows as $tx) {
            $skuId = (int) ($tx->sku_id ?? 0);
            $locId = (int) ($tx->location_id ?? 0);
            $qty = (float) ($tx->quantity ?? 0);
            if ($skuId <= 0 || $locId <= 0 || $qty <= 0) {
                continue;
            }
            $key = $skuId.':'.$locId;
            $delta = ((string) $tx->type === 'IN') ? $qty : -$qty;
            $netByKey[$key] = ($netByKey[$key] ?? 0.0) + $delta;
        }

        foreach ($netByKey as $key => $net) {
            if (abs($net) <= 0.00001) {
                continue;
            }
            [$skuIdStr, $locIdStr] = explode(':', $key, 2);
            $skuId = (int) $skuIdStr;
            $locId = (int) $locIdStr;
            if ($skuId <= 0 || $locId <= 0) {
                continue;
            }

            $inverse = -1.0 * (float) $net;
            $inv = SkuInventory::query()
                ->where('sku_id', $skuId)
                ->where('location_id', $locId)
                ->lockForUpdate()
                ->first();

            if (! $inv) {
                $inv = SkuInventory::create([
                    'sku_id' => $skuId,
                    'location_id' => $locId,
                    'quantity' => 0,
                    'reserved' => 0,
                    'user_id' => Auth::id(),
                ]);
                $inv = SkuInventory::query()->whereKey($inv->id)->lockForUpdate()->first();
            }

            if ($inverse > 0) {
                // We need to add stock back (the order net consumed from this location).
                $inv->increment('quantity', $inverse);
                InventoryTransaction::create($this->filterTransactionColumns([
                    'sku_id' => $skuId,
                    'location_id' => $locId,
                    'type' => 'IN',
                    'quantity' => $inverse,
                    'reference_type' => 'OrderCancelRollback',
                    'reference_id' => (string) $orderId,
                    'user_id' => Auth::id(),
                    'notes' => 'Order cancellation rollback (return stock)',
                ]));
            } else {
                // We need to remove stock (the order net added into this location, e.g. auto-transfer IN).
                $need = abs($inverse);
                if ((float) ($inv->quantity ?? 0) + 1e-9 < $need) {
                    throw new Exception(
                        "Cannot cancel order: stock already consumed for SKU {$skuId} at location {$locId}. Required {$need}, available {$inv->quantity}.",
                        422
                    );
                }
                $inv->decrement('quantity', $need);
                InventoryTransaction::create($this->filterTransactionColumns([
                    'sku_id' => $skuId,
                    'location_id' => $locId,
                    'type' => 'OUT',
                    'quantity' => $need,
                    'reference_type' => 'OrderCancelRollback',
                    'reference_id' => (string) $orderId,
                    'user_id' => Auth::id(),
                    'notes' => 'Order cancellation rollback (remove transferred stock)',
                ]));
            }
        }
    }
}
