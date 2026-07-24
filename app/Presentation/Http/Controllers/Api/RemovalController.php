<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use App\Application\Services\SkuImageResolver;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryRemovalItem;
use App\Domain\Models\Wms\InventoryRemovalOrder;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;

class RemovalController extends Controller
{
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

    /** Find a reasonable "shop" / main physical location. */
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

        // Prefer "physical"/"shop"/"store" type if present.
        if (Schema::hasColumn('inventory_locations', 'type')) {
            $physical = InventoryLocation::query()
                ->where(function ($q) {
                    $q->where('is_active', true)->orWhereNull('is_active');
                })
                ->whereIn('type', ['physical', 'shop', 'store'])
                ->orderBy('id')
                ->first();
            if ($physical) {
                return (int) $physical->id;
            }
        }

        $any = InventoryLocation::query()
            ->where(function ($q) {
                $q->where('is_active', true)->orWhereNull('is_active');
            })
            ->orderBy('id')
            ->first();

        return (int) ($any?->id ?? 1);
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
        $fh = @fopen($path, 'rb');
        if (! $fh) {
            return response()->json(['message' => 'Cannot read file'], 422);
        }

        $header = fgetcsv($fh);
        if (! $header || ! is_array($header)) {
            fclose($fh);

            return response()->json(['message' => 'Invalid CSV header'], 422);
        }

        $map = [];
        foreach ($header as $i => $name) {
            $key = trim((string) $name);
            if ($key === '') {
                continue;
            }
            $map[$key] = $i;
        }

        $required = ['order-id', 'sku'];
        foreach ($required as $col) {
            if (! array_key_exists($col, $map)) {
                fclose($fh);

                return response()->json([
                    'message' => "Missing required column: {$col}",
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

        $userId = auth()->id();

        DB::beginTransaction();
        try {
            while (($row = fgetcsv($fh)) !== false) {
                $summary['total_rows']++;

                $oid = trim((string) ($row[$map['order-id']] ?? ''));
                $skuCode = trim((string) ($row[$map['sku']] ?? ''));
                if ($oid === '' || $skuCode === '') {
                    continue;
                }

                $orderPayload = [
                    'user_id' => $userId,
                    'source' => $source,
                    'removal_order_id' => $oid,
                    'order_source' => trim((string) ($row[$map['order-source']] ?? '')) ?: null,
                    'order_type' => trim((string) ($row[$map['order-type']] ?? '')) ?: null,
                    'service_speed' => trim((string) ($row[$map['service-speed']] ?? '')) ?: null,
                    'order_status' => trim((string) ($row[$map['order-status']] ?? '')) ?: null,
                    'request_date' => $this->normalizeDateTime((string) ($row[$map['request-date']] ?? '')),
                    'last_updated_date' => $this->normalizeDateTime((string) ($row[$map['last-updated-date']] ?? '')),
                    'currency' => trim((string) ($row[$map['currency']] ?? '')) ?: null,
                ];

                $existingOrder = InventoryRemovalOrder::query()
                    ->where('source', $source)
                    ->where('removal_order_id', $oid)
                    ->first();

                if ($existingOrder) {
                    $existingOrder->update($orderPayload);
                    $order = $existingOrder;
                    $summary['orders_updated']++;
                } else {
                    $order = InventoryRemovalOrder::create($orderPayload);
                    $summary['orders_created']++;
                }

                $disposition = trim((string) ($row[$map['disposition']] ?? '')) ?: null;
                $itemPayload = [
                    'user_id' => $userId,
                    'inventory_removal_order_id' => $order->id,
                    'sku_code' => $skuCode,
                    'fnsku' => trim((string) ($row[$map['fnsku']] ?? '')) ?: null,
                    'disposition' => $disposition,
                    'requested_quantity' => (int) ($row[$map['requested-quantity']] ?? 0),
                    'cancelled_quantity' => (int) ($row[$map['cancelled-quantity']] ?? 0),
                    'disposed_quantity' => (int) ($row[$map['disposed-quantity']] ?? 0),
                    'shipped_quantity' => (int) ($row[$map['shipped-quantity']] ?? 0),
                    'in_process_quantity' => (int) ($row[$map['in-process-quantity']] ?? 0),
                    'removal_fee' => array_key_exists('removal-fee', $map) && ($row[$map['removal-fee']] ?? '') !== ''
                        ? (float) ($row[$map['removal-fee']] ?? 0)
                        : null,
                    'currency' => trim((string) ($row[$map['currency']] ?? '')) ?: null,
                ];

                $existingItem = InventoryRemovalItem::query()
                    ->where('inventory_removal_order_id', $order->id)
                    ->where('sku_code', $skuCode)
                    ->where(function ($q) use ($disposition) {
                        if ($disposition === null || $disposition === '') {
                            $q->whereNull('disposition')->orWhere('disposition', '');
                        } else {
                            $q->where('disposition', $disposition);
                        }
                    })
                    ->first();

                if ($existingItem) {
                    // Preserve receipt fields on re-upload.
                    $preserve = [
                        'receive_status' => $existingItem->receive_status,
                        'received_at' => $existingItem->received_at,
                        'received_location_id' => $existingItem->received_location_id,
                        'received_quantity' => $existingItem->received_quantity,
                    ];
                    $existingItem->update(array_merge($itemPayload, $preserve));
                    $summary['items_updated']++;
                } else {
                    InventoryRemovalItem::create($itemPayload);
                    $summary['items_created']++;
                }
            }

            DB::commit();
        } catch (\Throwable $e) {
            DB::rollBack();
            fclose($fh);

            return response()->json([
                'message' => 'Removal import failed',
                'error' => $e->getMessage(),
            ], 500);
        }

        fclose($fh);

        return response()->json([
            'message' => 'Removal import done',
            'summary' => $summary,
        ]);
    }

    /**
     * Confirm receipt and restock to shop (default) or a provided location.
     */
    public function receive(Request $request, string $id)
    {
        $validated = $request->validate([
            'location_id' => 'nullable|exists:inventory_locations,id',
            'quantity' => 'nullable|integer|min:1',
        ]);

        $item = InventoryRemovalItem::with(['removalOrder'])->findOrFail($id);
        if ($item->receive_status === 'received') {
            return response()->json(['message' => 'Already received'], 200);
        }

        $qty = (int) ($validated['quantity'] ?? 0);
        if ($qty <= 0) {
            // Choose a sensible default quantity to receive.
            $qty = (int) ($item->shipped_quantity ?: 0);
            if ($qty <= 0) {
                $qty = (int) ($item->requested_quantity ?: 0);
            }
            if ($qty <= 0) {
                return response()->json(['message' => 'No quantity available to receive.'], 422);
            }
        }

        $locationId = (int) ($validated['location_id'] ?? 0);
        if ($locationId <= 0) {
            $locationId = $this->resolveShopLocationId();
        }

        // Find SKU by sku code.
        $sku = Sku::query()->where('sku', $item->sku_code)->first();
        if (! $sku) {
            return response()->json([
                'message' => 'SKU not found in system for this removal item.',
                'sku' => $item->sku_code,
            ], 422);
        }

        DB::beginTransaction();
        try {
            // Lock inventory row and increment (race-safe).
            $inv = SkuInventory::query()
                ->where('sku_id', $sku->id)
                ->where('location_id', $locationId)
                ->lockForUpdate()
                ->first();
            if (! $inv) {
                SkuInventory::firstOrCreate(
                    ['sku_id' => $sku->id, 'location_id' => $locationId],
                    ['quantity' => 0, 'reserved' => 0]
                );
                $inv = SkuInventory::query()
                    ->where('sku_id', $sku->id)
                    ->where('location_id', $locationId)
                    ->lockForUpdate()
                    ->firstOrFail();
            }

            $inv->increment('quantity', $qty);

            InventoryTransaction::create([
                'sku_id' => $sku->id,
                'location_id' => $locationId,
                'type' => 'IN',
                'quantity' => $qty,
                'reference_type' => 'Removal',
                'reference_id' => (string) $item->id,
                'notes' => 'Amazon removal received: '.($item->removalOrder?->removal_order_id ?? '-').' ('.($item->disposition ?? '-').')',
            ]);

            $item->update([
                'receive_status' => 'received',
                'received_at' => now(),
                'received_location_id' => $locationId,
                'received_quantity' => $qty,
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
            'message' => 'Removal item received and restocked',
            'item' => $item->fresh(['removalOrder', 'receivedLocation']),
        ]);
    }
}
