<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use App\Application\Services\AmazonRemovalIntakeService;
use App\Application\Services\ChannelStockResolver;
use App\Application\Services\RemovalFbaBalanceService;
use App\Application\Services\SkuImageResolver;
use App\Application\Support\TenantContext;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryRemovalItem;
use App\Domain\Models\Wms\InventoryRemovalOrder;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;

class RemovalController extends Controller
{
    public function __construct(
        private RemovalFbaBalanceService $fbaBalance,
        private AmazonRemovalIntakeService $removalIntake,
    ) {
    }

    private function normalizeDateTime(?string $value): ?string
    {
        $raw = trim((string) ($value ?? ''));
        if ($raw === '') {
            return null;
        }
        try {
            return (new \Carbon\Carbon($raw))->toDateTimeString();
        } catch (\Throwable $e) {
            return null;
        }
    }

    /** Strip BOM / quotes and normalize Amazon CSV header names. */
    private function normalizeCsvHeader(string $name): string
    {
        $key = trim($name);
        // UTF-8 BOM on first column is common in Seller Central exports.
        $key = preg_replace('/^\xEF\xBB\xBF/', '', $key) ?? $key;
        $key = trim($key, " \t\n\r\0\x0B\"'");

        return strtolower($key);
    }

    /**
     * Read a CSV cell by header name without triggering PHP 8 undefined-key ErrorException
     * when optional Amazon columns are absent from the file.
     *
     * @param  array<int, string|null>  $row
     * @param  array<string, int>  $map
     */
    private function csvCell(array $row, array $map, string $column): string
    {
        if (! array_key_exists($column, $map)) {
            return '';
        }
        $idx = $map[$column];
        if (! array_key_exists($idx, $row)) {
            return '';
        }

        return trim((string) ($row[$idx] ?? ''));
    }

    /** Find the live shop / physical warehouse (prefer the one that already holds stock). */
    private function resolveShopLocationId(): int
    {
        // Prefer is_main if present.
        if (Schema::hasColumn('inventory_locations', 'is_main')) {
            $main = InventoryLocation::query()
                ->where(function ($q) {
                    $q->where('is_active', true)->orWhereNull('is_active');
                })
                ->where('is_main', true)
                ->orderBy('id')
                ->first();
            if ($main) {
                return (int) $main->id;
            }
        }

        $shopLike = InventoryLocation::query()
            ->where(function ($q) {
                $q->where('is_active', true)->orWhereNull('is_active');
            })
            ->where(function ($q) {
                if (Schema::hasColumn('inventory_locations', 'type')) {
                    $q->whereIn('type', ['physical', 'shop', 'store', 'pos']);
                }
                $q->orWhere('name', 'ilike', '%المحل%')
                    ->orWhere('name', 'ilike', '%shop%')
                    ->orWhere('name', 'ilike', '%store%');
            })
            ->orderBy('id')
            ->get(['id']);

        if ($shopLike->isNotEmpty()) {
            $ids = $shopLike->pluck('id')->map(fn ($id) => (int) $id)->all();
            $best = (int) (SkuInventory::query()
                ->whereIn('location_id', $ids)
                ->selectRaw('location_id, COALESCE(SUM(quantity), 0) as total_qty')
                ->groupBy('location_id')
                ->orderByDesc('total_qty')
                ->value('location_id') ?? 0);
            if ($best > 0) {
                return $best;
            }

            return (int) $ids[array_key_last($ids)];
        }

        $any = InventoryLocation::query()
            ->where(function ($q) {
                $q->where('is_active', true)->orWhereNull('is_active');
            })
            ->orderBy('id')
            ->first();

        return (int) ($any?->id ?? 1);
    }

    /**
     * Prefer an existing inventory row location for this SKU (so restock lands where shop qty already lives).
     */
    private function resolveRestockLocationIdForSku(int $skuId, ?int $preferredLocationId = null): int
    {
        if ($preferredLocationId && $preferredLocationId > 0) {
            return $preferredLocationId;
        }

        if ($skuId > 0) {
            $existing = (int) (SkuInventory::query()
                ->where('sku_id', $skuId)
                ->orderByDesc('quantity')
                ->orderByDesc('id')
                ->value('location_id') ?? 0);
            if ($existing > 0) {
                return $existing;
            }
        }

        return $this->resolveShopLocationId();
    }

    /**
     * Removals return physical units to the shop listing — not the FBA/merchant listing SKU.
     */
    private function resolveRestockSku(Sku $listingSku): Sku
    {
        $storeChannelId = ChannelStockResolver::resolveMainStoreChannelId();
        $listingChannelId = (int) ($listingSku->channel_id ?? 0);

        if ($listingChannelId > 0 && $storeChannelId > 0 && $listingChannelId === $storeChannelId) {
            return $listingSku;
        }

        if ($listingSku->relationLoaded('channel')
            ? ChannelStockResolver::isLocalStoreLikeChannel($listingSku->channel)
            : ChannelStockResolver::isLocalStoreLikeChannel($listingSku->channel()->first())
        ) {
            return $listingSku;
        }

        $storeSkuId = ChannelStockResolver::resolveStoreSkuIdForListingSku($listingSku);
        if ($storeSkuId && $storeSkuId > 0 && $storeSkuId !== (int) $listingSku->id) {
            $storeSku = Sku::query()->with(['offer', 'channel'])->find($storeSkuId);
            if ($storeSku) {
                return $storeSku;
            }
        }

        return $listingSku;
    }

    /**
     * Expected units for a removal line: shipped when present, otherwise requested.
     */
    private function expectedQuantityForItem(InventoryRemovalItem $item): int
    {
        $shipped = (int) ($item->shipped_quantity ?: 0);
        if ($shipped > 0) {
            return $shipped;
        }

        return max(0, (int) ($item->requested_quantity ?: 0));
    }

    /**
     * Find an existing removal item for upsert: exact disposition match, else blank-disposition sibling.
     */
    private function findExistingRemovalItemForImport(int $orderId, string $skuCode, ?string $disposition): ?InventoryRemovalItem
    {
        $base = InventoryRemovalItem::query()
            ->where('inventory_removal_order_id', $orderId)
            ->where('sku_code', $skuCode);

        $exact = (clone $base)
            ->where(function ($q) use ($disposition) {
                if ($disposition === null || $disposition === '') {
                    $q->whereNull('disposition')->orWhere('disposition', '');
                } else {
                    $q->where('disposition', $disposition);
                }
            })
            ->orderByDesc('id')
            ->first();

        if ($exact) {
            return $exact;
        }

        // Detail CSV often upgrades an All-Orders row that had empty disposition — update that row.
        if ($disposition !== null && $disposition !== '') {
            return (clone $base)
                ->where(function ($q) {
                    $q->whereNull('disposition')->orWhere('disposition', '');
                })
                ->orderByDesc('id')
                ->first();
        }

        return null;
    }

    public function index(Request $request)
    {
        $perPage = (int) $request->query('per_page', 50);
        $perPage = max(10, min($perPage, 200));

        $query = InventoryRemovalItem::with([
            'removalOrder',
            'receivedLocation',
        ])->orderByDesc('id');

        $status = trim((string) $request->query('status', ''));
        if ($status !== '') {
            $query->where('receive_status', $status);
        }

        if ($request->boolean('shortfall')) {
            $query->where('receive_status', 'received')
                ->whereRaw(
                    '(CASE WHEN COALESCE(shipped_quantity, 0) > 0 THEN shipped_quantity ELSE COALESCE(requested_quantity, 0) END) > COALESCE(received_quantity, 0)'
                );
        }

        $search = trim((string) $request->query('search', ''));
        if ($search !== '') {
            $query->where(function ($q) use ($search) {
                $q->where('sku_code', 'like', '%'.$search.'%')
                    ->orWhere('fnsku', 'like', '%'.$search.'%')
                    ->orWhereHas('removalOrder', function ($o) use ($search) {
                        $o->where('removal_order_id', 'like', '%'.$search.'%');
                    });
            });
        }

        $paginator = $query->paginate($perPage)->appends($request->query());
        $skuMap = SkuImageResolver::mapBySkuCodes($paginator->getCollection()->pluck('sku_code'));
        $paginator->getCollection()->transform(function (InventoryRemovalItem $item) use ($skuMap) {
            $sku = $skuMap->get(trim((string) ($item->sku_code ?? '')));
            $item->setAttribute('product_image_url', SkuImageResolver::urlFromSku($sku));
            $item->setAttribute('product_name', SkuImageResolver::nameFromSku($sku));
            $expected = $this->expectedQuantityForItem($item);
            $received = (int) ($item->received_quantity ?? 0);
            $item->setAttribute('expected_quantity', $expected);
            $item->setAttribute('shortfall_quantity', max(0, $expected - $received));

            return $item;
        });

        return response()->json($paginator);
    }

    /**
     * Import Amazon Removal Order Detail CSV.
     * Does NOT change stock yet — stock is updated only when user confirms receipt.
     */
    public function import(Request $request)
    {
        $request->validate([
            'file' => 'required|file|mimes:csv,txt',
            'source' => 'nullable|string|max:50',
        ]);

        $uploadedFile = $request->file('file');
        if (! $uploadedFile || ! $uploadedFile->isValid()) {
            return response()->json(['message' => 'No valid file uploaded'], 422);
        }

        $source = strtolower((string) $request->input('source', 'amazon')) ?: 'amazon';
        $path = $uploadedFile->getRealPath();
        $raw = @file_get_contents($path);
        if ($raw === false) {
            return response()->json(['message' => 'Cannot read file'], 422);
        }

        // Seller Central sometimes exports UTF-16 (with BOM) tab-separated reports.
        if (str_starts_with($raw, "\xFF\xFE") || str_starts_with($raw, "\xFE\xFF")) {
            $raw = mb_convert_encoding($raw, 'UTF-8', 'UTF-16');
        } elseif (str_starts_with($raw, "\xEF\xBB\xBF")) {
            $raw = substr($raw, 3);
        }

        $firstLine = strtok($raw, "\r\n") ?: '';
        $delimiter = substr_count($firstLine, "\t") > substr_count($firstLine, ',') ? "\t" : ',';

        $tmp = tempnam(sys_get_temp_dir(), 'removal_csv_');
        if ($tmp === false || file_put_contents($tmp, $raw) === false) {
            return response()->json(['message' => 'Cannot prepare file for import'], 422);
        }

        $fh = @fopen($tmp, 'rb');
        if (! $fh) {
            @unlink($tmp);

            return response()->json(['message' => 'Cannot read file'], 422);
        }

        $header = fgetcsv($fh, 0, $delimiter);
        if (! $header || ! is_array($header)) {
            fclose($fh);
            @unlink($tmp);

            return response()->json(['message' => 'Invalid CSV header'], 422);
        }

        $map = [];
        foreach ($header as $i => $name) {
            $key = $this->normalizeCsvHeader((string) $name);
            if ($key === '') {
                continue;
            }
            // Keep first occurrence if Amazon duplicates a header.
            if (! array_key_exists($key, $map)) {
                $map[$key] = (int) $i;
            }
        }

        // Seller Central sometimes uses spaced / alternate headers.
        $aliases = [
            'order-id' => ['order id', 'orderid', 'removal-order-id', 'removal order id'],
            'sku' => ['merchant-sku', 'merchant sku', 'msku', 'seller-sku', 'seller sku'],
            'disposition' => ['disposition-status', 'disposition status'],
            'requested-quantity' => ['requested quantity', 'requested-qty'],
            'shipped-quantity' => ['shipped quantity', 'shipped-qty'],
            'cancelled-quantity' => ['cancelled quantity', 'canceled-quantity', 'canceled quantity'],
            'disposed-quantity' => ['disposed quantity'],
            'in-process-quantity' => ['in-process quantity', 'in process quantity'],
            'removal-fee' => ['removal fee'],
            'request-date' => ['request date'],
            'last-updated-date' => ['last updated date', 'last-updated'],
            'order-status' => ['order status'],
            'order-type' => ['order type'],
            'order-source' => ['order source'],
            'service-speed' => ['service speed'],
        ];
        foreach ($aliases as $canonical => $alts) {
            if (array_key_exists($canonical, $map)) {
                continue;
            }
            foreach ($alts as $alt) {
                if (array_key_exists($alt, $map)) {
                    $map[$canonical] = $map[$alt];
                    break;
                }
            }
        }

        $required = ['order-id', 'sku'];
        foreach ($required as $col) {
            if (! array_key_exists($col, $map)) {
                fclose($fh);
                @unlink($tmp);

                return response()->json([
                    'message' => "Missing required column: {$col}",
                    'headers_found' => array_keys($map),
                ], 422);
            }
        }

        $summary = [
            'total_rows' => 0,
            'orders_created' => 0,
            'orders_updated' => 0,
            'items_created' => 0,
            'items_updated' => 0,
            'errors' => [],
        ];

        $userId = (int) (TenantContext::id() ?? auth()->id() ?? 0);

        DB::beginTransaction();
        try {
            while (($row = fgetcsv($fh, 0, $delimiter)) !== false) {
                if (! is_array($row)) {
                    continue;
                }
                // Skip blank lines.
                if (count(array_filter($row, static fn ($v) => trim((string) $v) !== '')) === 0) {
                    continue;
                }

                $summary['total_rows']++;

                $oid = $this->csvCell($row, $map, 'order-id');
                $skuCode = $this->csvCell($row, $map, 'sku');
                if ($oid === '' || $skuCode === '') {
                    continue;
                }

                $currency = $this->csvCell($row, $map, 'currency') ?: null;

                $orderPayload = [
                    'user_id' => $userId > 0 ? $userId : null,
                    'source' => $source,
                    'removal_order_id' => $oid,
                    'order_source' => $this->csvCell($row, $map, 'order-source') ?: null,
                    'order_type' => $this->csvCell($row, $map, 'order-type') ?: null,
                    'service_speed' => $this->csvCell($row, $map, 'service-speed') ?: null,
                    'order_status' => $this->csvCell($row, $map, 'order-status') ?: null,
                    'request_date' => $this->normalizeDateTime($this->csvCell($row, $map, 'request-date')),
                    'last_updated_date' => $this->normalizeDateTime($this->csvCell($row, $map, 'last-updated-date')),
                    'currency' => $currency,
                ];

                $existingOrder = InventoryRemovalOrder::query()
                    ->where('source', $source)
                    ->where('removal_order_id', $oid)
                    ->when($userId > 0, fn ($q) => $q->where('user_id', $userId))
                    ->first();

                if (! $existingOrder) {
                    $requestDate = $this->normalizeDateTime($this->csvCell($row, $map, 'request-date'));
                    $requestedQty = (int) $this->csvCell($row, $map, 'requested-quantity');
                    $adopted = $this->removalIntake->adoptS02Sibling(
                        $userId,
                        $oid,
                        $skuCode,
                        $requestedQty,
                        $requestDate
                    );
                    if ($adopted) {
                        $existingOrder = $adopted;
                    }
                }

                if ($existingOrder) {
                    $existingOrder->update($orderPayload);
                    $order = $existingOrder;
                    $summary['orders_updated']++;
                } else {
                    $order = InventoryRemovalOrder::create($orderPayload);
                    $summary['orders_created']++;
                }

                $disposition = $this->csvCell($row, $map, 'disposition') ?: null;
                $removalFeeRaw = $this->csvCell($row, $map, 'removal-fee');
                $itemPayload = [
                    'user_id' => $userId > 0 ? $userId : null,
                    'inventory_removal_order_id' => $order->id,
                    'sku_code' => $skuCode,
                    'fnsku' => $this->csvCell($row, $map, 'fnsku') ?: null,
                    'disposition' => $disposition,
                    'requested_quantity' => (int) $this->csvCell($row, $map, 'requested-quantity'),
                    'cancelled_quantity' => (int) $this->csvCell($row, $map, 'cancelled-quantity'),
                    'disposed_quantity' => (int) $this->csvCell($row, $map, 'disposed-quantity'),
                    'shipped_quantity' => (int) $this->csvCell($row, $map, 'shipped-quantity'),
                    'in_process_quantity' => (int) $this->csvCell($row, $map, 'in-process-quantity'),
                    'removal_fee' => $removalFeeRaw !== '' ? (float) $removalFeeRaw : null,
                    'currency' => $currency,
                ];

                $existingItem = $this->findExistingRemovalItemForImport((int) $order->id, $skuCode, $disposition);

                if ($existingItem) {
                    // Preserve receipt fields on re-upload — never reset stock receipt state.
                    $preserve = [
                        'receive_status' => $existingItem->receive_status,
                        'received_at' => $existingItem->received_at,
                        'received_location_id' => $existingItem->received_location_id,
                        'received_quantity' => $existingItem->received_quantity,
                    ];
                    $existingItem->update(array_merge($itemPayload, $preserve));
                    $summary['items_updated']++;
                } else {
                    // Live DB has NOT NULL receive_status/received_quantity without defaults.
                    InventoryRemovalItem::create(array_merge($itemPayload, [
                        'receive_status' => 'pending',
                        'received_quantity' => 0,
                    ]));
                    $summary['items_created']++;
                }
            }

            DB::commit();
        } catch (\Throwable $e) {
            DB::rollBack();
            fclose($fh);
            @unlink($tmp);
            Log::error('Removal import failed', [
                'error' => $e->getMessage(),
                'file' => $e->getFile(),
                'line' => $e->getLine(),
            ]);

            return response()->json([
                'message' => 'Removal import failed',
                'error' => $e->getMessage(),
            ], 500);
        }

        fclose($fh);
        @unlink($tmp);

        return response()->json([
            'message' => 'Removal import done',
            'summary' => $summary,
        ]);
    }

    /**
     * Confirm receipt (supports multi-drop courier deliveries).
     * Shop stock IN = this batch only; cumulative received_quantity grows.
     * FBA OUT = full expected once (idempotent on later batches).
     */
    public function receive(Request $request, string $id)
    {
        $validated = $request->validate([
            'location_id' => 'nullable|exists:inventory_locations,id',
            'quantity' => 'nullable|integer|min:0',
        ]);

        $item = InventoryRemovalItem::with(['removalOrder'])->findOrFail($id);

        $expected = $this->expectedQuantityForItem($item);
        if ($expected <= 0) {
            return response()->json(['message' => 'No quantity available to receive.'], 422);
        }

        $alreadyReceived = max(0, (int) ($item->received_quantity ?? 0));
        if ($item->receive_status === 'received' && $alreadyReceived >= $expected) {
            return response()->json([
                'message' => 'Already fully received',
                'expected_quantity' => $expected,
                'received_quantity' => $alreadyReceived,
                'shortfall_quantity' => 0,
            ], 200);
        }

        $remaining = max(0, $expected - $alreadyReceived);

        // quantity = units in THIS delivery (delta). Omit = take the rest (legacy full receive).
        if ($request->exists('quantity')) {
            $batchQty = (int) ($validated['quantity'] ?? 0);
        } else {
            $batchQty = $remaining;
        }

        if ($alreadyReceived > 0 && $batchQty <= 0) {
            return response()->json([
                'message' => 'Enter a positive quantity for this delivery.',
                'expected_quantity' => $expected,
                'received_quantity' => $alreadyReceived,
                'remaining_quantity' => $remaining,
            ], 422);
        }

        if ($batchQty > $remaining) {
            return response()->json([
                'message' => 'Received quantity cannot exceed remaining quantity.',
                'expected_quantity' => $expected,
                'received_quantity' => $alreadyReceived,
                'remaining_quantity' => $remaining,
                'this_batch_quantity' => $batchQty,
            ], 422);
        }

        $newTotal = $alreadyReceived + $batchQty;
        $shortfall = max(0, $expected - $newTotal);

        // Find listing SKU from the removal sheet, then restock the linked shop SKU when present.
        $listingSku = Sku::query()
            ->with(['offer', 'channel'])
            ->where('sku', $item->sku_code)
            ->first();
        if (! $listingSku) {
            return response()->json([
                'message' => 'SKU not found in system for this removal item.',
                'sku' => $item->sku_code,
            ], 422);
        }

        $restockSku = $this->resolveRestockSku($listingSku);
        $storeChannelId = ChannelStockResolver::resolveMainStoreChannelId();
        $restockIsShop = ((int) ($restockSku->channel_id ?? 0) === $storeChannelId && $storeChannelId > 0)
            || ChannelStockResolver::isLocalStoreLikeChannel($restockSku->channel);

        if (! $restockIsShop && (int) $restockSku->id === (int) $listingSku->id) {
            return response()->json([
                'message' => 'No shop (المحل) SKU is linked to this product. Link a shop SKU on the master product, then confirm receipt.',
                'listing_sku' => $listingSku->sku,
                'master_product_id' => $listingSku->offer?->master_product_id,
            ], 422);
        }

        $locationId = $this->resolveRestockLocationIdForSku(
            (int) $restockSku->id,
            (int) ($validated['location_id'] ?? 0) ?: null
        );

        // Units that left the FC = expected; shop only gains what physically arrived this batch.
        $shouldDeductFba = (int) $restockSku->id !== (int) $listingSku->id
            && ChannelStockResolver::isFbaChannel((int) ($listingSku->channel_id ?? 0));

        $fbaDeducted = 0;
        $fbaLocationId = null;

        DB::beginTransaction();
        try {
            if ($batchQty > 0) {
                $inv = SkuInventory::query()
                    ->where('sku_id', $restockSku->id)
                    ->where('location_id', $locationId)
                    ->lockForUpdate()
                    ->first();
                if (! $inv) {
                    SkuInventory::firstOrCreate(
                        ['sku_id' => $restockSku->id, 'location_id' => $locationId],
                        ['quantity' => 0, 'reserved' => 0]
                    );
                    $inv = SkuInventory::query()
                        ->where('sku_id', $restockSku->id)
                        ->where('location_id', $locationId)
                        ->lockForUpdate()
                        ->firstOrFail();
                }

                $inv->increment('quantity', $batchQty);

                $notes = 'Amazon removal received: '.($item->removalOrder?->removal_order_id ?? '-').' ('.($item->disposition ?? '-').')';
                if ((int) $restockSku->id !== (int) $listingSku->id) {
                    $notes .= ' [listing '.$listingSku->sku.' → shop '.$restockSku->sku.']';
                }
                $notes .= " [batch +{$batchQty}, total {$newTotal}/{$expected}";
                if ($shortfall > 0) {
                    $notes .= ", shortfall {$shortfall}";
                }
                $notes .= ']';

                InventoryTransaction::create([
                    'sku_id' => $restockSku->id,
                    'location_id' => $locationId,
                    'type' => 'IN',
                    'quantity' => $batchQty,
                    'reference_type' => 'Removal',
                    'reference_id' => (string) $item->id,
                    'notes' => $notes,
                ]);
            }

            if ($shouldDeductFba) {
                // Idempotent: only the first receive batch deducts FBA for the full expected qty.
                $fbaResult = $this->fbaBalance->deductForReceivedItem($item, $listingSku, $expected);
                $fbaDeducted = (int) $fbaResult['deducted'];
                $fbaLocationId = $fbaResult['location_id'];
            }

            $item->update([
                'receive_status' => 'received',
                'received_at' => $item->received_at ?? now(),
                'received_location_id' => $batchQty > 0
                    ? $locationId
                    : ($item->received_location_id ?: null),
                'received_quantity' => $newTotal,
            ]);

            DB::commit();
        } catch (\Throwable $e) {
            DB::rollBack();

            return response()->json([
                'message' => 'Failed to receive removal item',
                'error' => $e->getMessage(),
            ], 500);
        }

        return response()->json([
            'message' => $alreadyReceived > 0
                ? 'Removal delivery batch restocked'
                : 'Removal item received and restocked',
            'item' => $item->fresh(['removalOrder', 'receivedLocation']),
            'restocked_sku' => $restockSku->sku,
            'listing_sku' => $listingSku->sku,
            'location_id' => $locationId,
            'expected_quantity' => $expected,
            'this_batch_quantity' => $batchQty,
            'received_quantity' => $newTotal,
            'shortfall_quantity' => $shortfall,
            'fba_balance_deducted' => $fbaDeducted,
            'fba_location_id' => $fbaLocationId,
        ]);
    }
}
