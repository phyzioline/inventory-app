<?php

namespace App\Application\Services;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use App\Domain\Models\Wms\DraftMasterProduct;
use App\Domain\Models\Wms\MasterProduct;
use PhpOffice\PhpSpreadsheet\IOFactory;

class ProductImportService
{
    protected MatchingEngineService $matchingEngine;

    public function __construct(MatchingEngineService $matchingEngine)
    {
        $this->matchingEngine = $matchingEngine;
    }

    public function parseFile(UploadedFile $file): array
    {
        $path = $file->getRealPath();
        $extension = strtolower($file->getClientOriginalExtension());

        Log::info("ProductImport: Parsing file: $path, Extension: $extension");

        try {
            $reader = IOFactory::createReaderForFile($path);

            if ($reader instanceof \PhpOffice\PhpSpreadsheet\Reader\Csv) {
                $inputEncoding = $this->detectCsvInputEncoding($path);
                $detectedDelimiter = $this->detectCsvDelimiter($path, in_array($extension, ['txt', 'tsv']) ? "\t" : ',');
                $reader->setInputEncoding($inputEncoding);
                $reader->setDelimiter($detectedDelimiter);
                $reader->setEnclosure('"');
                Log::info("ProductImport: CSV input encoding detected as {$inputEncoding}, delimiter: {$detectedDelimiter}");
            }

            $spreadsheet = $reader->load($path);
            $sheet = $spreadsheet->getActiveSheet();
            $rows = $this->normalizeRowsEncoding($sheet->toArray());

            Log::info('ProductImport: Total raw rows found: '.count($rows));

            if (empty($rows)) {
                return [
                    'data' => [],
                    'errors' => ['File is empty or could not be read'],
                    'total_rows' => 0,
                    'valid_rows' => 0,
                ];
            }

            $header = array_shift($rows);
            Log::info('ProductImport: Header row: ', $header);

            $headerMap = $this->mapHeaders($header);
            Log::info('ProductImport: Header map: ', $headerMap);

            $parsedData = [];
            $errors = [];

            foreach ($rows as $index => $row) {
                if ($this->isEmptyRow($row)) {
                    continue;
                }

                $rowData = $this->mapRowData($row, $headerMap);
                $validation = $this->validateRow($rowData, $index + 2);

                if ($validation['valid']) {
                    $parsedData[] = $rowData;
                } else {
                    $errors[] = $validation['error'];
                }
            }

            Log::info('ProductImport: Parsing finished. Valid: '.count($parsedData).', Errors: '.count($errors));

            return [
                'data' => $parsedData,
                'errors' => $errors,
                'total_rows' => count($rows),
                'valid_rows' => count($parsedData),
            ];
        } catch (\Exception $e) {
            Log::error('ProductImport Error: '.$e->getMessage());
            throw $e;
        }
    }

    /**
     * Import products into draft_master_products with matching results.
     * Clears all existing pending drafts first to avoid duplicates on re-upload.
     */
    public function import(array $data): array
    {
        $results = [
            'drafts_created' => 0,
            'drafts_updated' => 0,
            'failed' => 0,
            'errors' => [],
            'drafts' => [],
        ];

        // ─── Clear only THIS user's pending drafts before new import ────────
        $userId = Auth::id() ?: 1;
        DraftMasterProduct::where('status', 'pending')->where('user_id', $userId)->delete();
        Log::info("Cleared pending drafts for user {$userId} before new import.");

        // ─── Optimization: Pre-load products into Matching Engine ───────────
        $products = MasterProduct::all();
        $this->matchingEngine->setProductsCache($products);
        Log::info('Pre-loaded '.$products->count().' products into Matching Engine cache.');

        foreach ($data as $row) {
            try {
                $draft = $this->createDraftProduct($row);
                $results['drafts'][] = $draft;
                $results['drafts_created']++;
            } catch (\Exception $e) {
                $results['failed']++;
                $results['errors'][] = 'Row SKU '.($row['sku'] ?? 'unknown').': '.$e->getMessage();
                Log::error('Product Import Error: '.$e->getMessage());
            }
        }

        return $results;
    }

    /**
     * Get drafts based on status.
     */
    public function getDrafts(string $status = 'pending')
    {
        return DraftMasterProduct::with('matchedProduct')
            ->where('status', $status)
            ->latest()
            ->get();
    }

    /**
     * Process a single draft.
     */
    public function processDraft(int $id, string $action, ?int $matchedProductId = null)
    {
        $draft = DraftMasterProduct::findOrFail($id);

        $draft->user_action = $action;
        if ($matchedProductId) {
            $draft->matched_product_id = $matchedProductId;
        }

        if ($action === 'reject') {
            $draft->reject();
        } else {
            $draft->approve();
        }

        return $draft;
    }

    /**
     * Process multiple drafts in batch.
     */
    public function processBatch(array $ids, string $action)
    {
        $results = ['success' => 0, 'failed' => 0, 'errors' => []];

        foreach ($ids as $id) {
            try {
                $this->processDraft($id, $action);
                $results['success']++;
            } catch (\Exception $e) {
                $results['failed']++;
                $results['errors'][] = "ID {$id}: ".$e->getMessage();
            }
        }

        return $results;
    }

    /**
     * Create draft product with matching engine results.
     */
    private function createDraftProduct(array $row): DraftMasterProduct
    {
        // Use matching engine to find existing products
        $match = $this->matchingEngine->findMatch([
            'name' => $row['name'],
            'barcode' => $row['barcode'] ?? null,
            'sku' => $row['sku'] ?? null,
        ]);

        // Create draft product
        $user = Auth::user();
        if (! $user) {
            throw new \Exception('User must be authenticated to import products.');
        }

        $draft = DraftMasterProduct::create([
            'proposed_name' => $row['name'],
            'category' => $row['category'] ?? null,
            'description' => $row['description'] ?? null,
            'supplier_name' => $row['supplier_name'] ?? null,
            'notes' => $row['notes'] ?? null,
            'specifications' => [
                'min_stock' => $row['min_stock'] ?? 0,
                'selling_price' => $row['selling_price'] ?? 0,
                'cost_price' => $row['cost_price'] ?? 0,
                'asin' => $row['asin'] ?? null,
                'quantity' => $row['quantity'] ?? 0,
                'image_url' => $row['image_url'] ?? null,
            ],
            'barcode' => $row['barcode'] ?? null,
            'sku' => $row['sku'] ?? null,
            'matched_product_id' => $match['product_id'],
            'match_confidence' => $match['confidence'],
            'status' => 'pending',
            'user_id' => $user->id,
            'created_by' => $user->id,
        ]);

        return $draft->load('matchedProduct');
    }

    private function mapHeaders(?array $header): array
    {
        if (! $header) {
            return [];
        }

        $map = [];
        foreach ($header as $index => $col) {
            $col = strtolower(trim($col ?? ''));

            // ── Amazon TSV exact columns ───────────────────────────────
            if ($col === 'item-name') {
                $map['name'] = $index;
            } elseif ($col === 'seller-sku') {
                $map['sku'] = $index;
            } elseif ($col === 'asin1') {
                $map['asin'] = $index;
            } elseif ($col === 'item-description') {
                $map['description'] = $index;
            } elseif ($col === 'price') {
                $map['selling_price'] = $index;
            } elseif ($col === 'quantity') {
                $map['quantity'] = $index;
            } elseif ($col === 'product-id') {
                $map['barcode'] = $index;
            }

            // ── Generic / custom / Arabic columns ──────────────────────
            elseif (str_contains($col, 'name') || str_contains($col, 'product') || str_contains($col, 'اسم') || str_contains($col, 'منتج')) {
                if (! isset($map['name'])) {
                    $map['name'] = $index;
                }
            } elseif (str_contains($col, 'sku') || str_contains($col, 'سكيو') || str_contains($col, 'كود')) {
                if (! isset($map['sku'])) {
                    $map['sku'] = $index;
                }
            } elseif (str_contains($col, 'category') || str_contains($col, 'تصنيف') || str_contains($col, 'قسم')) {
                $map['category'] = $index;
            } elseif (str_contains($col, 'description') || str_contains($col, 'وصف')) {
                if (! isset($map['description'])) {
                    $map['description'] = $index;
                }
            } elseif ((str_contains($col, 'sell') && str_contains($col, 'price')) || str_contains($col, 'بيع') || (str_contains($col, 'سعر') && ! str_contains($col, 'شراء') && ! str_contains($col, 'تكلفة'))) {
                $map['selling_price'] = $index;
            } elseif ((str_contains($col, 'cost') && str_contains($col, 'price')) || str_contains($col, 'شراء') || str_contains($col, 'تكلفة')) {
                $map['cost_price'] = $index;
            } elseif (str_contains($col, 'barcode') || str_contains($col, 'باركود') || str_contains($col, 'رمز')) {
                $map['barcode'] = $index;
            } elseif ((str_contains($col, 'min') && str_contains($col, 'stock')) || str_contains($col, 'حد') || str_contains($col, 'أدنى')) {
                $map['min_stock'] = $index;
            } elseif (str_contains($col, 'quantity') || str_contains($col, 'qty') || str_contains($col, 'كمية') || str_contains($col, 'عدد')) {
                $map['quantity'] = $index;
            } elseif (str_contains($col, 'image') || str_contains($col, 'img') || str_contains($col, 'صورة')) {
                $map['image_url'] = $index;
            } elseif (str_contains($col, 'supplier') || str_contains($col, 'vendor') || str_contains($col, 'مورد')) {
                $map['supplier_name'] = $index;
            } elseif (str_contains($col, 'notes') || str_contains($col, 'note') || str_contains($col, 'ملاحظات')) {
                $map['notes'] = $index;
            }
        }

        return $map;
    }

    private function mapRowData(array $row, array $map): array
    {
        return [
            'name' => isset($map['name']) ? trim($row[$map['name']] ?? '') : null,
            'sku' => isset($map['sku']) ? trim($row[$map['sku']] ?? '') : null,
            'asin' => isset($map['asin']) ? trim($row[$map['asin']] ?? '') : null,
            'category' => isset($map['category']) ? trim($row[$map['category']] ?? '') : null,
            'description' => isset($map['description']) ? trim($row[$map['description']] ?? '') : null,
            'selling_price' => isset($map['selling_price']) ? floatval($row[$map['selling_price']] ?? 0) : 0,
            'cost_price' => isset($map['cost_price']) ? floatval($row[$map['cost_price']] ?? 0) : 0,
            'barcode' => isset($map['barcode']) ? trim($row[$map['barcode']] ?? '') : null,
            'min_stock' => isset($map['min_stock']) ? intval($row[$map['min_stock']] ?? 0) : 0,
            'quantity' => isset($map['quantity']) ? intval($row[$map['quantity']] ?? 0) : 0,
            'image_url' => isset($map['image_url']) ? trim($row[$map['image_url']] ?? '') : null,
            'supplier_name' => isset($map['supplier_name']) ? trim($row[$map['supplier_name']] ?? '') : null,
            'notes' => isset($map['notes']) ? trim($row[$map['notes']] ?? '') : null,
        ];
    }

    private function validateRow(array $data, int $rowNum): array
    {
        if (empty($data['name']) || empty($data['sku'])) {
            return [
                'valid' => false,
                'error' => "Row $rowNum: Missing required fields (Name or SKU)",
            ];
        }

        return ['valid' => true];
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

    private function isEmptyRow(array $row): bool
    {
        foreach ($row as $cell) {
            if (! empty(trim($cell ?? ''))) {
                return false;
            }
        }

        return true;
    }
}
