<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\ProductAlias;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;

class AsnTransferController extends Controller
{
    public function upload(Request $request)
    {
        $validated = $request->validate([
            'file' => 'required|file|mimes:pdf|max:20480',
            'source_location_id' => 'nullable|exists:inventory_locations,id',
        ]);

        $text = $this->extractTextFromPdf($request->file('file')->getRealPath());
        $rows = $this->parseAsnRows($text);

        $sourceLocationId = isset($validated['source_location_id']) ? (int) $validated['source_location_id'] : null;
        $matched = [];
        $unmatched = [];

        foreach ($rows as $row) {
            $match = $this->matchSkuForRow($row);
            if (! $match['sku']) {
                $unmatched[] = [
                    ...$row,
                    'reason' => 'SKU not found by Partner SKU / SKU / Partner Barcode',
                ];

                continue;
            }

            $sku = $match['sku'];
            $available = null;
            if ($sourceLocationId) {
                $available = (int) (SkuInventory::where('sku_id', $sku->id)
                    ->where('location_id', $sourceLocationId)
                    ->value('quantity') ?? 0);
            }

            $matched[] = [
                ...$row,
                'sku_id' => $sku->id,
                'system_sku' => $sku->sku,
                'system_marketplace_id' => $sku->marketplace_id,
                'product_name' => $sku->offer?->masterProduct?->internal_name
                    ?? $sku->offer?->name
                    ?? $sku->sku,
                'matched_by' => $match['matched_by'],
                'source_available' => $available,
                'stock_status' => $available === null
                    ? 'unknown'
                    : ($available >= $row['quantity'] ? 'ok' : 'insufficient'),
            ];
        }

        $destinationSuggestion = InventoryLocation::where(function ($q) {
            $q->where('name', 'like', '%noon%')
                ->orWhere('name', 'like', '%zara%')
                ->orWhere('name', 'like', '%زارا%');
        })->first();

        return response()->json([
            'message' => 'ASN PDF parsed successfully',
            'summary' => [
                'rows' => count($rows),
                'matched' => count($matched),
                'unmatched' => count($unmatched),
            ],
            'suggested_destination_location' => $destinationSuggestion,
            'matched_items' => $matched,
            'unmatched_items' => $unmatched,
        ]);
    }

    public function execute(Request $request)
    {
        $validated = $request->validate([
            'source_location_id' => 'required|exists:inventory_locations,id|different:destination_location_id',
            'destination_location_id' => 'required|exists:inventory_locations,id',
            'asn_number' => 'nullable|string|max:120',
            'items' => 'required|array|min:1',
            'items.*.sku_id' => 'required|exists:skus,id',
            'items.*.quantity' => 'required|integer|min:1',
            'items.*.partner_barcode' => 'nullable|string|max:255',
            'items.*.partner_sku' => 'nullable|string|max:255',
            'items.*.sku_code' => 'nullable|string|max:255',
        ]);

        $groupedRequested = [];
        foreach ($validated['items'] as $item) {
            $skuId = (int) $item['sku_id'];
            if (! isset($groupedRequested[$skuId])) {
                $groupedRequested[$skuId] = 0;
            }
            $groupedRequested[$skuId] += (int) $item['quantity'];
        }

        $insufficient = [];
        foreach ($groupedRequested as $skuId => $requestedQty) {
            $available = (int) (SkuInventory::where('sku_id', $skuId)
                ->where('location_id', $validated['source_location_id'])
                ->value('quantity') ?? 0);

            if ($available < $requestedQty) {
                $insufficient[] = [
                    'sku_id' => $skuId,
                    'available' => $available,
                    'requested' => $requestedQty,
                ];
            }
        }

        if (! empty($insufficient)) {
            return response()->json([
                'message' => 'Insufficient stock for one or more items',
                'insufficient' => $insufficient,
            ], 422);
        }

        DB::beginTransaction();
        try {
            $transferredLines = 0;
            $totalUnits = 0;
            $asn = trim((string) ($validated['asn_number'] ?? ''));

            foreach ($validated['items'] as $item) {
                $qty = (int) $item['quantity'];
                $totalUnits += $qty;

                $sourceInventory = SkuInventory::firstOrCreate(
                    ['sku_id' => $item['sku_id'], 'location_id' => $validated['source_location_id']],
                    ['quantity' => 0, 'reserved' => 0]
                );
                $sourceInventory->decrement('quantity', $qty);

                $destInventory = SkuInventory::firstOrCreate(
                    ['sku_id' => $item['sku_id'], 'location_id' => $validated['destination_location_id']],
                    ['quantity' => 0, 'reserved' => 0]
                );
                $destInventory->increment('quantity', $qty);

                $noteParts = [];
                if ($asn !== '') {
                    $noteParts[] = "ASN {$asn}";
                }
                if (! empty($item['partner_sku'])) {
                    $noteParts[] = "Partner SKU: {$item['partner_sku']}";
                }
                if (! empty($item['partner_barcode'])) {
                    $noteParts[] = "Partner Barcode: {$item['partner_barcode']}";
                }
                $notes = implode(' | ', $noteParts);

                $outTx = InventoryTransaction::create([
                    'sku_id' => $item['sku_id'],
                    'location_id' => $validated['source_location_id'],
                    'type' => 'TRANSFER',
                    'quantity' => $qty,
                    'notes' => $notes !== '' ? "Transfer OUT - {$notes}" : 'Transfer OUT',
                    'reference_type' => 'asn_transfer_out',
                ]);

                $inTx = InventoryTransaction::create([
                    'sku_id' => $item['sku_id'],
                    'location_id' => $validated['destination_location_id'],
                    'type' => 'IN',
                    'quantity' => $qty,
                    'notes' => $notes !== '' ? "Transfer IN - {$notes}" : 'Transfer IN',
                    'reference_type' => 'asn_transfer_in',
                    'reference_id' => (string) $outTx->id,
                ]);

                $outTx->update(['reference_id' => (string) $inTx->id]);
                $transferredLines++;
            }

            DB::commit();

            return response()->json([
                'message' => 'ASN transfer completed successfully',
                'transferred_lines' => $transferredLines,
                'total_units' => $totalUnits,
            ], 201);
        } catch (\Throwable $e) {
            DB::rollBack();

            return response()->json([
                'message' => 'ASN transfer failed',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    public function printBarcodes(Request $request)
    {
        $validated = $request->validate([
            'items' => 'required|array|min:1',
            'items.*.partner_barcode' => 'required|string|max:255',
            'items.*.quantity' => 'required|integer|min:1',
            'items.*.partner_sku' => 'nullable|string|max:255',
        ]);

        if (! class_exists(\Picqer\Barcode\BarcodeGeneratorSVG::class)) {
            return response()->json([
                'message' => 'Barcode generator package is missing. Install picqer/php-barcode-generator.',
            ], 422);
        }

        $generator = new \Picqer\Barcode\BarcodeGeneratorSVG;
        $labelsHtml = '';
        $labelsCount = 0;

        foreach ($validated['items'] as $item) {
            $barcodeValue = trim((string) $item['partner_barcode']);
            if ($barcodeValue === '') {
                continue;
            }

            $qty = (int) $item['quantity'];
            for ($i = 0; $i < $qty; $i++) {
                $svg = $generator->getBarcode($barcodeValue, $generator::TYPE_CODE_128, 1.7, 32);
                $labelsHtml .= '<div class="label">';
                $labelsHtml .= '<div class="sku">'.e((string) ($item['partner_sku'] ?? '')).'</div>';
                $labelsHtml .= '<div class="barcode">'.$svg.'</div>';
                $labelsHtml .= '<div class="code">'.e($barcodeValue).'</div>';
                $labelsHtml .= '</div>';
                $labelsCount++;
            }
        }

        $html = '<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ASN Partner Barcodes</title>
  <style>
    @page { margin: 6mm; }
    body { font-family: Arial, sans-serif; margin: 0; }
    .sheet { display: flex; flex-wrap: wrap; gap: 4mm; }
    .label {
      width: 2cm;
      min-height: 2cm;
      border: 1px solid #ddd;
      padding: 1mm;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      overflow: hidden;
    }
    .sku { font-size: 7px; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .barcode { width: 100%; display: flex; justify-content: center; align-items: center; }
    .barcode svg { width: 100%; height: 10mm; }
    .code { font-size: 6px; text-align: center; line-height: 1.1; word-break: break-all; }
  </style>
</head>
<body>
  <div class="sheet">'.$labelsHtml.'</div>
</body>
</html>';

        return response()->json([
            'labels_count' => $labelsCount,
            'html' => $html,
        ]);
    }

    private function extractTextFromPdf(string $path): string
    {
        if (! class_exists(\Smalot\PdfParser\Parser::class)) {
            throw new \RuntimeException('PDF parser package is missing. Install smalot/pdfparser.');
        }

        $parser = new \Smalot\PdfParser\Parser;
        $pdf = $parser->parseFile($path);
        $text = (string) $pdf->getText();

        if (trim($text) === '') {
            throw new \RuntimeException('Could not extract text from PDF.');
        }

        return $text;
    }

    private function parseAsnRows(string $text): array
    {
        $lines = preg_split("/\r\n|\n|\r/", $text) ?: [];
        $rows = [];

        foreach ($lines as $line) {
            $line = trim((string) $line);
            if ($line === '') {
                continue;
            }

            if (
                stripos($line, 'Name') === 0 ||
                stripos($line, 'Barcode') === 0 ||
                stripos($line, 'FBN Transfers') === 0 ||
                stripos($line, 'about:blank') !== false ||
                preg_match('/^\-\-\s*\d+\s+of\s+\d+\s*\-\-$/i', $line)
            ) {
                continue;
            }

            $parts = preg_split('/\t+|\s{2,}/u', $line) ?: [];
            $parts = array_values(array_filter(array_map(static fn ($v) => trim((string) $v), $parts), static fn ($v) => $v !== ''));

            if (count($parts) < 4) {
                continue;
            }

            $quantityToken = $parts[count($parts) - 1];
            if (! preg_match('/^\d+$/', $quantityToken)) {
                continue;
            }

            if (count($parts) > 4) {
                $parts = array_slice($parts, -4);
            }

            [$partnerBarcode, $partnerSku, $skuCode, $qty] = $parts;
            $partnerBarcode = trim((string) $partnerBarcode);
            $partnerSku = trim((string) $partnerSku);
            $skuCode = trim((string) $skuCode);
            $qtyInt = (int) $qty;

            if ($partnerBarcode === '' || $partnerSku === '' || $skuCode === '' || $qtyInt <= 0) {
                continue;
            }

            $key = strtoupper("{$partnerBarcode}|{$partnerSku}|{$skuCode}");
            if (! isset($rows[$key])) {
                $rows[$key] = [
                    'partner_barcode' => $partnerBarcode,
                    'partner_sku' => $partnerSku,
                    'sku_code' => $skuCode,
                    'quantity' => 0,
                ];
            }

            $rows[$key]['quantity'] += $qtyInt;
        }

        return array_values($rows);
    }

    private function matchSkuForRow(array $row): array
    {
        $candidateCodes = array_values(array_unique(array_filter([
            trim((string) ($row['partner_sku'] ?? '')),
            trim((string) ($row['sku_code'] ?? '')),
            trim((string) ($row['partner_barcode'] ?? '')),
        ])));

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
