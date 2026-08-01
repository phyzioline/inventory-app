<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\ProductAlias;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;

class FbaShipmentTransferController extends Controller
{
    public function upload(Request $request)
    {
        $validated = $request->validate([
            'file' => [
                'required',
                'file',
                'max:20480',
                function (string $attribute, $value, \Closure $fail): void {
                    $ext = strtolower((string) $value->getClientOriginalExtension());
                    if (! in_array($ext, ['tsv', 'txt', 'csv'], true)) {
                        $fail('The shipment file must be a .tsv, .txt, or .csv export from Amazon.');
                    }
                },
            ],
            'source_location_id' => 'nullable|exists:inventory_locations,id',
            'destination_location_id' => 'nullable|exists:inventory_locations,id',
        ]);

        $raw = file_get_contents($request->file('file')->getRealPath());
        if ($raw === false) {
            return response()->json(['message' => 'Could not read uploaded file.'], 422);
        }

        $parsed = $this->parseAmazonShipmentTsv($raw);
        if (empty($parsed['rows'])) {
            return response()->json([
                'message' => 'No product rows found in the shipment file. Ensure you uploaded the Amazon shipment TSV export.',
            ], 422);
        }

        $sourceLocationId = isset($validated['source_location_id']) ? (int) $validated['source_location_id'] : null;
        $destinationLocationId = isset($validated['destination_location_id']) ? (int) $validated['destination_location_id'] : null;
        $sourceChannelId = null;
        if ($sourceLocationId) {
            $rawSourceChannel = InventoryLocation::query()->whereKey($sourceLocationId)->value('channel_id');
            $sourceChannelId = $rawSourceChannel ? (int) $rawSourceChannel : null;
        }
        $fbaChannelId = null;
        if ($destinationLocationId) {
            $fbaChannelId = InventoryLocation::query()->whereKey($destinationLocationId)->value('channel_id');
            $fbaChannelId = $fbaChannelId ? (int) $fbaChannelId : null;
        }

        $matched = [];
        $unmatched = [];

        foreach ($parsed['rows'] as $row) {
            $match = $this->matchSourceSku($row, $sourceLocationId, $sourceChannelId);
            if (! $match['sku']) {
                $unmatched[] = [
                    ...$row,
                    'reason' => 'No system SKU found for Amazon MSKU / ASIN / FNSKU',
                ];

                continue;
            }

            // If the MSKU/ASIN maps to the FBA SKU, pick the sibling SKU that exists in the chosen shop location
            // via the same master product, so the UI shows the real shop SKU code (not a hidden cross-channel id).
            $sku = $this->resolveShopSkuFromMatchedSku($match['sku'], $sourceLocationId, $sourceChannelId) ?? $match['sku'];
            // Reject cross-channel source picks when the source location has a channel.
            if ($sourceChannelId && (int) ($sku->channel_id ?? 0) > 0 && (int) $sku->channel_id !== $sourceChannelId) {
                $unmatched[] = [
                    ...$row,
                    'reason' => 'Matched SKU belongs to a different channel than the selected source location',
                ];

                continue;
            }
            $available = null;
            if ($sourceLocationId) {
                $available = (int) (SkuInventory::where('sku_id', $sku->id)
                    ->where('location_id', $sourceLocationId)
                    ->value('quantity') ?? 0);
            }

            $destSku = null;
            $toSkuId = null;
            $destSkuCode = null;
            if ($destinationLocationId) {
                $destSku = $this->matchDestinationSku($row, $fbaChannelId, $destinationLocationId);
                if ($destSku) {
                    $toSkuId = (int) $destSku->id;
                    $destSkuCode = (string) $destSku->sku;
                }
            }

            $matched[] = [
                ...$row,
                'sku_id' => $sku->id,
                'system_sku' => $sku->sku,
                'system_marketplace_id' => $sku->marketplace_id,
                'product_name' => $sku->offer?->masterProduct?->internal_name
                    ?? $sku->offer?->name
                    ?? $sku->sku,
                'matched_by' => $sku->id === ($match['sku']->id ?? null) ? $match['matched_by'] : 'master_product_shop_sku',
                'source_available' => $available,
                'stock_status' => $available === null
                    ? 'unknown'
                    : ($available >= $row['quantity'] ? 'ok' : 'insufficient'),
                'to_sku_id' => $toSkuId,
                'dest_sku_code' => $destSkuCode,
                'dest_matched_by' => $destSku ? ($destSku->sku === $row['amazon_msku'] ? 'msku' : 'asin/fnsku') : null,
            ];
        }

        $fbaLocations = InventoryLocation::query()
            ->where(function ($q) {
                $q->where('type', 'amazon_fba')
                    ->orWhere('type', 'like', '%fba%')
                    ->orWhereRaw('LOWER(name) LIKE ?', ['%fba%'])
                    ->orWhereRaw('LOWER(name) LIKE ?', ['%امازون%'])
                    ->orWhereRaw('LOWER(name) LIKE ?', ['%amazon%']);
            })
            ->orderBy('name')
            ->get(['id', 'name', 'type', 'channel_id']);

        $shipmentId = trim((string) ($parsed['shipment']['shipment_id'] ?? ''));
        $priorTransfer = $this->findPriorFbaShipmentTransfer($shipmentId);

        return response()->json([
            'message' => 'FBA shipment file parsed successfully',
            'shipment' => $parsed['shipment'],
            'summary' => [
                'rows' => count($parsed['rows']),
                'matched' => count($matched),
                'unmatched' => count($unmatched),
                'total_units' => array_sum(array_column($parsed['rows'], 'quantity')),
            ],
            'prior_transfer' => $priorTransfer,
            'fba_locations' => $fbaLocations,
            'matched_items' => $matched,
            'unmatched_items' => $unmatched,
        ]);
    }

    /**
     * Whether this Amazon shipment ID already produced transfer OUT lines.
     *
     * @return array{
     *   exists: bool,
     *   shipment_id?: string,
     *   transferred_at?: string|null,
     *   line_count?: int,
     *   total_units?: int,
     *   notes_sample?: string|null
     * }
     */
    private function findPriorFbaShipmentTransfer(string $shipmentId): array
    {
        $shipmentId = trim($shipmentId);
        if ($shipmentId === '') {
            return ['exists' => false];
        }

        $prefix = 'transfer_out:fba:'.$shipmentId.':';
        $base = InventoryTransaction::query()
            ->where('type', 'TRANSFER')
            ->where('reference_type', 'like', $prefix.'%');

        $lineCount = (clone $base)->count();
        if ($lineCount === 0) {
            return ['exists' => false, 'shipment_id' => $shipmentId];
        }

        $totalUnits = (int) (clone $base)->sum('quantity');
        $first = (clone $base)->orderBy('created_at')->first(['created_at', 'notes']);

        return [
            'exists' => true,
            'shipment_id' => $shipmentId,
            'transferred_at' => $first?->created_at?->toIso8601String(),
            'line_count' => $lineCount,
            'total_units' => $totalUnits,
            'notes_sample' => $first?->notes,
        ];
    }

    /**
     * @return array{shipment: array<string, mixed>, rows: list<array<string, mixed>>}
     */
    private function parseAmazonShipmentTsv(string $raw): array
    {
        $raw = preg_replace('/^\xEF\xBB\xBF/', '', $raw) ?? $raw;
        $lines = preg_split("/\r\n|\n|\r/", $raw) ?: [];

        $shipment = [
            'shipment_id' => '',
            'shipment_name' => '',
            'ship_to_fc' => '',
            'sku_count' => null,
            'total_units' => null,
        ];

        $headerIndex = null;
        $rows = [];

        foreach ($lines as $i => $line) {
            $line = trim((string) $line);
            if ($line === '') {
                continue;
            }

            if (str_contains($line, "\t") && ! str_contains($line, 'MSKU') && $headerIndex === null) {
                [$key, $value] = array_pad(explode("\t", $line, 2), 2, '');
                $key = trim($key);
                $value = trim($value);
                if ($this->isShipmentMetaKey($key, 'id')) {
                    $shipment['shipment_id'] = $value;
                } elseif ($this->isShipmentMetaKey($key, 'name')) {
                    $shipment['shipment_name'] = $value;
                } elseif ($this->isShipmentMetaKey($key, 'ship_to')) {
                    $shipment['ship_to_fc'] = $value;
                } elseif ($this->isShipmentMetaKey($key, 'sku_count')) {
                    $shipment['sku_count'] = is_numeric($value) ? (int) $value : null;
                } elseif ($this->isShipmentMetaKey($key, 'total_units')) {
                    $shipment['total_units'] = is_numeric($value) ? (int) $value : null;
                }

                continue;
            }

            if ($headerIndex === null && $this->looksLikeProductHeader($line)) {
                $headerIndex = $i;

                continue;
            }

            if ($headerIndex === null || $i <= $headerIndex) {
                continue;
            }

            $cols = explode("\t", $line);
            if (count($cols) < 5) {
                continue;
            }

            $amazonMsku = trim((string) ($cols[0] ?? ''));
            $title = trim((string) ($cols[1] ?? ''));
            $asin = trim((string) ($cols[2] ?? ''));
            $fnsku = trim((string) ($cols[3] ?? ''));
            $qtyToken = trim((string) ($cols[count($cols) - 1] ?? ''));
            $qty = is_numeric($qtyToken) ? (int) $qtyToken : 0;

            if ($amazonMsku === '' || $qty <= 0) {
                continue;
            }

            $key = strtoupper("{$amazonMsku}|{$asin}|{$fnsku}");
            if (! isset($rows[$key])) {
                $rows[$key] = [
                    'amazon_msku' => $amazonMsku,
                    'title' => $title,
                    'asin' => $asin,
                    'fnsku' => $fnsku,
                    'quantity' => 0,
                ];
            }
            $rows[$key]['quantity'] += $qty;
        }

        if ($shipment['shipment_id'] === '' && ! empty($shipment['shipment_name'])) {
            if (preg_match('/FBA[A-Z0-9]+/i', $shipment['shipment_name'], $m)) {
                $shipment['shipment_id'] = strtoupper($m[0]);
            }
        }

        return [
            'shipment' => $shipment,
            'rows' => array_values($rows),
        ];
    }

    private function isShipmentMetaKey(string $key, string $kind): bool
    {
        $k = mb_strtolower($key);

        return match ($kind) {
            'id' => str_contains($k, 'شحنة') || str_contains($k, 'shipment'),
            'name' => $k === 'الاسم' || $k === 'name',
            'ship_to' => str_contains($k, 'شحن إلى') || str_contains($k, 'ship to'),
            'sku_count' => str_contains($k, 'sku') && (str_contains($k, 'مجموع') || str_contains($k, 'count')),
            'total_units' => str_contains($k, 'وحدات') || str_contains($k, 'units'),
            default => false,
        };
    }

    private function looksLikeProductHeader(string $line): bool
    {
        $lower = mb_strtolower($line);

        return str_contains($lower, 'msku')
            && (str_contains($lower, 'asin') || str_contains($line, 'ASIN'));
    }

    private function matchSourceSku(array $row, ?int $sourceLocationId = null, ?int $sourceChannelId = null): array
    {
        return $this->matchSkuByCodesForSource(
            [
                trim((string) ($row['amazon_msku'] ?? '')),
                trim((string) ($row['asin'] ?? '')),
                trim((string) ($row['fnsku'] ?? '')),
            ],
            $sourceLocationId,
            $sourceChannelId
        );
    }

    private function matchDestinationSku(array $row, ?int $fbaChannelId, int $destinationLocationId): ?Sku
    {
        $codes = [
            trim((string) ($row['amazon_msku'] ?? '')),
            trim((string) ($row['asin'] ?? '')),
            trim((string) ($row['fnsku'] ?? '')),
        ];

        if ($fbaChannelId) {
            foreach ($codes as $code) {
                if ($code === '') {
                    continue;
                }
                $lower = mb_strtolower($code);
                $sku = Sku::query()
                    ->where('channel_id', $fbaChannelId)
                    ->where(function ($q) use ($lower) {
                        $q->whereRaw('LOWER(sku) = ?', [$lower])
                            ->orWhereRaw('LOWER(marketplace_id) = ?', [$lower]);
                    })
                    ->first();
                if ($sku) {
                    return $sku;
                }
            }
        }

        foreach ($codes as $code) {
            if ($code === '') {
                continue;
            }
            $lower = mb_strtolower($code);
            $sku = Sku::query()
                ->where(function ($q) use ($lower) {
                    $q->whereRaw('LOWER(sku) = ?', [$lower])
                        ->orWhereRaw('LOWER(marketplace_id) = ?', [$lower]);
                })
                ->whereHas('inventory', function ($q) use ($destinationLocationId) {
                    $q->where('location_id', $destinationLocationId);
                })
                ->first();
            if ($sku) {
                return $sku;
            }
        }

        $match = $this->matchSkuByCodes($codes);

        return $match['sku'];
    }

    /**
     * For source (shop) selection we must prefer a SKU that actually exists in the chosen source location inventory,
     * otherwise the UI shows only the numeric id (e.g. 6210) because that SKU isn't present in the shop warehouse list.
     * When the source location has a channel_id, also restrict to that channel (no merchant/FBA listings).
     *
     * @param  list<string>  $candidateCodes
     * @return array{sku: ?Sku, matched_by: ?string}
     */
    private function matchSkuByCodesForSource(array $candidateCodes, ?int $sourceLocationId, ?int $sourceChannelId = null): array
    {
        $candidateCodes = array_values(array_unique(array_filter(array_map('trim', $candidateCodes))));

        if ($sourceLocationId) {
            foreach ($candidateCodes as $code) {
                if ($code === '') {
                    continue;
                }
                $lower = mb_strtolower($code);
                $sku = Sku::with(['offer.masterProduct', 'channel'])
                    ->whereHas('inventory', function ($q) use ($sourceLocationId) {
                        $q->where('location_id', $sourceLocationId);
                    })
                    ->when($sourceChannelId, fn ($q) => $q->where('channel_id', $sourceChannelId))
                    ->where(function ($q) use ($lower) {
                        $q->whereRaw('LOWER(sku) = ?', [$lower])
                            ->orWhereRaw('LOWER(marketplace_id) = ?', [$lower]);
                    })
                    ->first();
                if ($sku) {
                    return ['sku' => $sku, 'matched_by' => $code];
                }
            }
        }

        // Fallback: any SKU match (may be cross-channel) — caller upgrades via resolveShopSkuFromMatchedSku.
        $match = $this->matchSkuByCodes($candidateCodes);
        if ($match['sku']) {
            $resolved = $this->resolveShopSkuFromMatchedSku($match['sku'], $sourceLocationId, $sourceChannelId);
            if ($resolved) {
                return ['sku' => $resolved, 'matched_by' => ($match['matched_by'] ?? null).'+source_channel'];
            }
            if (! $sourceChannelId) {
                return $match;
            }
        }

        // Alias fallback: but prefer the SKU that exists in the source location (+ channel) if possible.
        foreach ($candidateCodes as $code) {
            $lower = mb_strtolower($code);
            $alias = ProductAlias::with('masterProduct')
                ->whereRaw('LOWER(alias_text) = ?', [$lower])
                ->first();
            if (! $alias || ! $alias->masterProduct) {
                continue;
            }

            $skusQ = $alias->masterProduct->skus()->with(['offer.masterProduct', 'channel']);
            if ($sourceLocationId) {
                $skusQ->whereHas('inventory', fn ($q) => $q->where('location_id', $sourceLocationId));
            }
            if ($sourceChannelId) {
                $skusQ->where('channel_id', $sourceChannelId);
            }
            $sku = $skusQ->first();
            if ($sku) {
                return ['sku' => $sku, 'matched_by' => "alias: {$code}"];
            }
        }

        return ['sku' => null, 'matched_by' => null];
    }

    private function resolveShopSkuFromMatchedSku(?Sku $sku, ?int $sourceLocationId, ?int $sourceChannelId = null): ?Sku
    {
        if (! $sku || ! $sourceLocationId) {
            return null;
        }

        $inLocation = SkuInventory::query()
            ->where('sku_id', $sku->id)
            ->where('location_id', $sourceLocationId)
            ->exists();
        $channelOk = ! $sourceChannelId || (int) ($sku->channel_id ?? 0) === $sourceChannelId;

        // Already exists in shop location inventory and matches source channel.
        if ($inLocation && $channelOk) {
            return $sku;
        }

        $masterId = $sku->offer?->masterProduct?->id ?? null;
        if (! $masterId) {
            return null;
        }

        // Find a SKU for the same master product that exists in the chosen shop location (+ channel).
        $shopSku = Sku::query()
            ->with(['offer.masterProduct', 'channel'])
            ->whereHas('offer', fn ($q) => $q->where('master_product_id', $masterId))
            ->whereHas('inventory', fn ($q) => $q->where('location_id', $sourceLocationId))
            ->when($sourceChannelId, fn ($q) => $q->where('channel_id', $sourceChannelId))
            ->orderBy('id')
            ->first();

        return $shopSku ?: null;
    }

    /**
     * @param  list<string>  $candidateCodes
     * @return array{sku: ?Sku, matched_by: ?string}
     */
    private function matchSkuByCodes(array $candidateCodes): array
    {
        $candidateCodes = array_values(array_unique(array_filter(array_map('trim', $candidateCodes))));

        foreach ($candidateCodes as $code) {
            $lower = mb_strtolower($code);
            $sku = Sku::with(['offer.masterProduct', 'channel'])
                ->where(function ($q) use ($lower) {
                    $q->whereRaw('LOWER(sku) = ?', [$lower])
                        ->orWhereRaw('LOWER(marketplace_id) = ?', [$lower]);
                })
                ->first();

            if ($sku) {
                return ['sku' => $sku, 'matched_by' => $code];
            }
        }

        foreach ($candidateCodes as $code) {
            $lower = mb_strtolower($code);
            $alias = ProductAlias::with('masterProduct')
                ->whereRaw('LOWER(alias_text) = ?', [$lower])
                ->first();

            if (! $alias || ! $alias->masterProduct) {
                continue;
            }

            $sku = $alias->masterProduct
                ->skus()
                ->with(['offer.masterProduct', 'channel'])
                ->first();

            if ($sku) {
                return ['sku' => $sku, 'matched_by' => "alias: {$code}"];
            }
        }

        return ['sku' => null, 'matched_by' => null];
    }
}
