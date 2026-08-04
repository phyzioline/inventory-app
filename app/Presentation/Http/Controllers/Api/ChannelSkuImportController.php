<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use App\Application\Services\InventoryTransactionService;
use App\Application\Services\SkuUniquenessGuard;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;
use PhpOffice\PhpSpreadsheet\IOFactory;

class ChannelSkuImportController extends Controller
{
    protected $transactionService;

    public function __construct(InventoryTransactionService $transactionService)
    {
        $this->transactionService = $transactionService;
    }

    /**
     * Parse an Excel/CSV file and return rows for preview.
     * No data is written to the database here.
     */
    public function upload(Request $request, int $channelId)
    {
        $request->validate([
            'file' => 'required|file|max:20480',
        ]);

        $channel = Channel::findOrFail($channelId);

        try {
            $path = $request->file('file')->getRealPath();
            $extension = strtolower($request->file('file')->getClientOriginalExtension());
            $isTabDelimited = in_array($extension, ['txt', 'tsv']);
            $detectedDelimiter = $this->detectCsvDelimiter($path, $isTabDelimited ? "\t" : ',');

            $reader = $isTabDelimited
                ? new \PhpOffice\PhpSpreadsheet\Reader\Csv
                : IOFactory::createReaderForFile($path);
            if ($reader instanceof \PhpOffice\PhpSpreadsheet\Reader\Csv) {
                $reader->setDelimiter($detectedDelimiter);
                $reader->setEnclosure('"');
                $reader->setInputEncoding($this->detectCsvInputEncoding($path));
            }

            $spreadsheet = $reader->load($path);
            $rows = $this->normalizeRowsEncoding($spreadsheet->getActiveSheet()->toArray());

            if (empty($rows)) {
                return response()->json(['success' => false, 'message' => 'File is empty'], 422);
            }

            $header = array_map(function ($h) {
                // Remove special chars and non-printable chars
                $cleaned = preg_replace('/[\x00-\x1F\x7F-\x9F\xad]/u', '', trim($h));

                return str_replace(['*', ':', '(', ')', '[', ']', '#'], '', $cleaned);
            }, array_shift($rows));

            $headerMap = $this->mapHeaders($header);

            Log::info('ChannelSkuImport upload: headers processed', [
                'channel_id' => $channelId,
                'raw_headers' => $header,
                'mapped_indices' => $headerMap,
                'first_row_snapshot' => $rows[0] ?? 'empty',
            ]);

            $rawItems = [];
            $errors = [];

            foreach ($rows as $index => $row) {
                if (empty(array_filter($row))) {
                    continue;
                }

                $skuCode = isset($headerMap['sku']) ? trim($row[$headerMap['sku']] ?? '') : '';
                if (empty($skuCode)) {
                    $errors[] = 'Row '.($index + 2).': SKU is required.';

                    continue;
                }

                $qty = isset($headerMap['stock']) ? (int) ($row[$headerMap['stock']] ?? 0) : 0;
                $imageUrl = isset($headerMap['image_url']) ? trim($row[$headerMap['image_url']] ?? '') : '';
                $imageUrl = $this->normalizeImageUrl($imageUrl);

                $rawItems[] = [
                    'name' => isset($headerMap['name']) ? trim($row[$headerMap['name']] ?? '') : $skuCode,
                    'sku' => $skuCode,
                    'barcode' => isset($headerMap['barcode']) ? trim($row[$headerMap['barcode']] ?? '') : (isset($headerMap['asin']) ? trim($row[$headerMap['asin']] ?? '') : ''),
                    'stock' => $qty,
                    'image_url' => $imageUrl,
                ];
            }

            // Aggregate by SKU (Amazon FBA reports have multiple rows per SKU: SELLABLE + UNSELLABLE)
            $aggregated = [];
            foreach ($rawItems as $item) {
                $key = $item['sku'];
                if (! isset($aggregated[$key])) {
                    $aggregated[$key] = $item;
                } else {
                    $aggregated[$key]['stock'] = ($aggregated[$key]['stock'] ?? 0) + ($item['stock'] ?? 0);
                    if (empty($aggregated[$key]['name']) && ! empty($item['name']) && $item['name'] !== $key) {
                        $aggregated[$key]['name'] = $item['name'];
                    }
                    if (empty($aggregated[$key]['image_url']) && ! empty($item['image_url'])) {
                        $aggregated[$key]['image_url'] = $item['image_url'];
                    }
                }
            }
            $preview = array_values($aggregated);

            return response()->json([
                'success' => true,
                'channel' => ['id' => $channel->id, 'name' => $channel->name],
                'preview' => $preview,
                'errors' => $errors,
                'total_rows' => count($rows),
                'valid_rows' => count($preview),
            ]);
        } catch (\Exception $e) {
            Log::error("ChannelSkuImport upload error (channel $channelId): ".$e->getMessage());

            return response()->json(['success' => false, 'message' => 'Failed to parse file: '.$e->getMessage()], 422);
        }
    }

    /**
     * Create SKUs for the channel from a previously parsed preview.
     * offer_id is left null – to be linked later via "Link to Master" workflow.
     */
    public function confirm(Request $request, int $channelId)
    {
        set_time_limit(300);

        Log::info('ChannelSkuImport confirm: starting', [
            'channel_id' => $channelId,
            'sku_count' => count($request->skus ?? []),
            'payload' => $request->skus[0] ?? 'empty',
        ]);

        $request->validate([
            'skus' => 'required|array|min:1',
            'skus.*.sku' => 'required|string',
        ]);

        $channel = Channel::findOrFail($channelId);
        $userId = auth()->id();

        $processed = 0;
        $errors = [];

        foreach ($request->skus as $row) {
            try {
                $skuCode = SkuUniquenessGuard::normalize((string) ($row['sku'] ?? ''));
                if ($skuCode === '') {
                    $errors[] = ['sku' => $row['sku'] ?? '', 'error' => 'SKU فارغ'];
                    continue;
                }

                $existingOnChannel = Sku::query()
                    ->where('user_id', $userId)
                    ->where('channel_id', $channelId)
                    ->where('sku', $skuCode)
                    ->first();

                if (! $existingOnChannel) {
                    try {
                        SkuUniquenessGuard::assertAvailable((int) $userId, $skuCode);
                    } catch (\Illuminate\Validation\ValidationException $e) {
                        $errors[] = [
                            'sku' => $skuCode,
                            'error' => (string) ($e->errors()['sku'][0] ?? $e->getMessage()),
                            'sku_duplicate' => true,
                            'duplicate_locations' => $e->response?->getData(true)['duplicate_locations'] ?? [],
                        ];
                        continue;
                    }
                }

                // Use updateOrCreate with multi-channel unique scope
                $attrs = [
                    'offer_id' => null,
                    'name' => $row['name'] ?? $row['sku'],
                    'selling_price' => is_numeric($row['selling_price'] ?? null) ? $row['selling_price'] : 0,
                    'image_url' => $row['image_url'] ?? null,
                    'is_active' => true,
                ];
                if (Schema::hasColumn('skus', 'barcode')) {
                    $attrs['barcode'] = $row['barcode'] ?? null;
                }
                $sku = Sku::updateOrCreate(
                    [
                        'user_id' => $userId,
                        'channel_id' => $channelId,
                        'sku' => $skuCode,
                    ],
                    $attrs
                );

                // --- STOCK INITIALIZATION ---
                $hasStockValue = array_key_exists('stock', $row) && $row['stock'] !== null && $row['stock'] !== '';
                if ($hasStockValue) {
                    $stockValue = max(0, (int) $row['stock']);
                    // 1. Ensure channel has a warehouse
                    $warehouse = InventoryLocation::where('channel_id', $channelId)
                        ->orWhere('name', 'LIKE', '%'.$sku->channel?->name.'%')
                        ->first();

                    if (! $warehouse) {
                        $channel = Channel::find($channelId);
                        $warehouse = InventoryLocation::create([
                            'user_id' => $userId,
                            'channel_id' => $channelId,
                            'name' => ($channel->name ?? 'Channel').' Warehouse',
                            'type' => 'channel',
                            'is_active' => true,
                        ]);
                    }

                    // 2. Update SkuInventory
                    $inventory = SkuInventory::firstOrCreate(
                        ['sku_id' => $sku->id, 'location_id' => $warehouse->id],
                        ['quantity' => 0, 'user_id' => $userId]
                    );

                    // Keep sku_inventory aligned with imported stock value.
                    // This supports both initial stock and later stock corrections from reconciliation sheets.
                    $currentQty = (int) $inventory->quantity;
                    $inventory->update(['quantity' => $stockValue]);

                    // 3. Record Transaction (delta-based)
                    $delta = $stockValue - $currentQty;
                    if ($delta !== 0) {
                        $this->transactionService->recordTransaction(
                            $sku->id,
                            $warehouse->id,
                            $delta > 0 ? 'IN' : 'OUT',
                            abs($delta),
                            $stockValue,
                            'IMPORT',
                            $channelId,
                            'Stock sync from channel import'
                        );
                    }
                }

                $processed++;
            } catch (\Exception $e) {
                $errors[] = "SKU {$row['sku']}: ".$e->getMessage();
                Log::error('ChannelSkuImport confirm error: '.$e->getMessage());
            }
        }

        Log::info('ChannelSkuImport confirm: finished', [
            'success' => true,
            'processed' => $processed,
            'errors' => $errors,
        ]);

        return response()->json([
            'success' => true,
            'processed' => $processed,
            'errors' => $errors,
            'message' => "Imported/Updated {$processed} products successfully.",
        ]);
    }

    /**
     * Download a template CSV for channel SKU import.
     */
    public function template()
    {
        $headers = ['Product Name*', 'SKU*', 'Barcode', 'Stock', 'Image URL'];

        $callback = function () use ($headers) {
            while (ob_get_level()) {
                ob_end_clean();
            }
            $file = fopen('php://output', 'w');
            fwrite($file, "\xEF\xBB\xBF");
            fputcsv($file, $headers);
            fputcsv($file, ['Example Product', 'CH-SKU-001', '1234567890', '10', '']);
            fclose($file);
        };

        return response()->stream($callback, 200, [
            'Content-type' => 'text/csv',
            'Content-Disposition' => 'attachment; filename=channel_sku_template.csv',
        ]);
    }

    /**
     * Map column header names to their index positions.
     */
    private function mapHeaders(array $header): array
    {
        $map = [];
        $aliases = [
            'name' => ['name', 'product name', 'item name', 'item-name', 'item-title', 'اسم المنتج', 'عنوان', 'title', 'product-name'],
            'sku' => ['sku', 'item sku', 'product sku', 'seller-sku', 'item-sku', 'sku-id', 'اس كيو يو', 'رمز المنتج'],
            'barcode' => ['barcode', 'ean', 'upc', 'asin1', 'product-id', 'external-id', 'باركود', 'الرمز'],
            'selling_price' => ['selling price', 'price', 'sale price', 'your-price', 'سعر البيع', 'السعر', 'سعر'],
            'stock' => ['stock', 'quantity', 'qty', 'inventory', 'quantity-available', 'quantity available', 'المخزون', 'الكمية', 'كمية', 'مخزن'],
            'asin' => ['asin', 'product-id', 'external-id'],
            'image_url' => ['image url', 'image', 'photo', 'picture', 'main-image-url', 'صورة'],
        ];

        foreach ($header as $index => $col) {
            $colLower = mb_strtolower(trim($col));
            if (empty($colLower)) {
                continue;
            }

            foreach ($aliases as $key => $possibles) {
                // Priority 1: Exact match or direct contains
                foreach ($possibles as $p) {
                    if ($colLower === $p || str_contains($colLower, $p)) {
                        $map[$key] = $index;

                        continue 2;
                    }
                }
            }
        }

        return $map;
    }

    /**
     * Convert Amazon product page URL to image URL when possible.
     * e.g. https://www.amazon.eg/dp/B0CGM79MSB → image CDN URL
     */
    private function normalizeImageUrl(?string $url): ?string
    {
        $url = trim((string) $url);
        if (empty($url)) {
            return null;
        }

        // Extract ASIN from Amazon product URL (amazon.eg/dp/ASIN or amazon.com/dp/ASIN)
        if (preg_match('#amazon\.(?:eg|com|sa|ae|co\.uk)/[^/]*/dp/([A-Z0-9]{10})#i', $url, $m)) {
            $asin = $m[1];

            // Try legacy image URL format (works for some products)
            return "https://images-na.ssl-images-amazon.com/images/P/{$asin}.01._SCMZZZZZZZ_.jpg";
        }

        return $url ?: null;
    }

    private function detectCsvInputEncoding(string $path): string
    {
        $sample = @file_get_contents($path, false, null, 0, 65536);
        if ($sample === false || $sample === '') {
            return 'UTF-8';
        }

        if (str_starts_with($sample, "\xEF\xBB\xBF")) {
            return 'UTF-8';
        }

        // If bytes are valid UTF-8, keep UTF-8 and avoid false Arabic recoding.
        if (mb_check_encoding($sample, 'UTF-8')) {
            return 'UTF-8';
        }

        $encodings = $this->filterSupportedEncodings([
            'UTF-8', 'CP1256', 'ISO-8859-6', 'Windows-1252', 'ISO-8859-1', 'ASCII',
        ]);
        if (empty($encodings)) {
            return 'UTF-8';
        }

        // Prefer Arabic legacy code pages when source bytes are non-UTF8.
        foreach (['CP1256', 'ISO-8859-6'] as $preferred) {
            if (in_array($preferred, $encodings, true)) {
                return $preferred;
            }
        }

        $detected = mb_detect_encoding(
            $sample,
            $encodings,
            true
        );

        return $detected ?: 'UTF-8';
    }

    private function detectCsvDelimiter(string $path, string $fallback = ','): string
    {
        $sample = @file_get_contents($path, false, null, 0, 65536);
        if ($sample === false || $sample === '') {
            return $fallback;
        }

        $lines = preg_split('/\r\n|\n|\r/', $sample) ?: [];
        $lines = array_values(array_filter(array_map('trim', $lines), fn ($line) => $line !== ''));
        if (empty($lines)) {
            return $fallback;
        }

        $lines = array_slice($lines, 0, 20);
        $candidates = array_values(array_unique(["\t", ';', ',', '|', $fallback]));

        $bestDelimiter = $fallback;
        $bestScore = 0.0;

        foreach ($candidates as $candidate) {
            $counts = [];
            foreach ($lines as $line) {
                $counts[] = count(str_getcsv($line, $candidate));
            }

            if (max($counts) < 2) {
                continue;
            }

            $score = array_sum($counts) / max(1, count($counts));
            if ($score > $bestScore) {
                $bestScore = $score;
                $bestDelimiter = $candidate;
            }
        }

        return $bestDelimiter;
    }

    private function normalizeRowsEncoding(array $rows): array
    {
        array_walk_recursive($rows, function (&$value) {
            if (! is_string($value)) {
                return;
            }

            $value = $this->normalizeStringEncoding($value);
        });

        return $rows;
    }

    private function normalizeStringEncoding(string $value): string
    {
        if ($value === '') {
            return $value;
        }

        $value = preg_replace('/^\xEF\xBB\xBF/', '', $value) ?? $value;

        if ($this->looksLikeArabicMojibake($value)) {
            $recovered = $this->recoverArabicMojibake($value);
            if ($recovered !== null) {
                return $recovered;
            }
        }

        if (preg_match('//u', $value)) {
            return $value;
        }

        $encodings = $this->filterSupportedEncodings(['CP1256', 'ISO-8859-6', 'Windows-1252', 'ISO-8859-1']);
        foreach ($encodings as $encoding) {
            $converted = @mb_convert_encoding($value, 'UTF-8', $encoding);
            if (is_string($converted) && $converted !== '' && preg_match('//u', $converted)) {
                return $converted;
            }
        }

        return $value;
    }

    private function looksLikeArabicMojibake(string $value): bool
    {
        if (preg_match('/[\x{0600}-\x{06FF}]/u', $value)) {
            return false;
        }

        return preg_match('/[\x{00C0}-\x{00FF}]/u', $value) === 1;
    }

    private function recoverArabicMojibake(string $value): ?string
    {
        $encodings = $this->filterSupportedEncodings(['Windows-1252', 'ISO-8859-1']);
        $targets = $this->filterSupportedEncodings(['CP1256', 'ISO-8859-6']);

        foreach ($encodings as $from) {
            $bytes = @mb_convert_encoding($value, $from, 'UTF-8');
            if (! is_string($bytes) || $bytes === '') {
                continue;
            }

            foreach ($targets as $to) {
                $fixed = @mb_convert_encoding($bytes, 'UTF-8', $to);
                if (is_string($fixed) && preg_match('/[\x{0600}-\x{06FF}]/u', $fixed)) {
                    return $fixed;
                }
            }
        }

        return null;
    }

    private function filterSupportedEncodings(array $encodings): array
    {
        $supported = array_map('strtolower', mb_list_encodings());

        return array_values(array_filter($encodings, function ($encoding) use ($supported) {
            return in_array(strtolower($encoding), $supported, true);
        }));
    }
}
