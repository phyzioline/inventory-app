<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use App\Domain\Models\Wms\Inventory;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\Product;
use App\Domain\Models\Wms\ReturnItem;
use App\Domain\Models\Wms\SalesOrder;
use App\Domain\Models\Wms\Warehouse;

class BarcodeReturnController extends Controller
{
    /**
     * Scan barcode and detect product + channel.
     */
    public function scanBarcode(Request $request)
    {
        $request->validate([
            'barcode' => 'required|string',
        ]);

        return response()->json($this->detectByCode((string) $request->barcode));
    }

    /**
     * OCR label image/pdf then detect code.
     */
    public function scanImage(Request $request)
    {
        $request->validate([
            'file' => 'required|file|mimes:jpg,jpeg,png,webp,pdf|max:20480',
        ]);

        $file = $request->file('file');
        $text = $this->extractTextFromImageOrPdf($file->getRealPath(), $file->getMimeType() ?: 'image/jpeg');

        if (trim($text) === '') {
            return response()->json([
                'found' => false,
                'message' => 'Could not read label text from image.',
            ], 422);
        }

        $candidates = $this->extractCandidates($text);
        foreach ($candidates as $candidate) {
            $detected = $this->detectByCode($candidate);
            if (($detected['found'] ?? false) === true) {
                $detected['ocr_detected'] = true;
                $detected['ocr_code'] = $candidate;

                return response()->json($detected);
            }
        }

        if (! empty($candidates)) {
            $fallback = $this->detectByCode($candidates[0]);
            $fallback['ocr_detected'] = true;
            $fallback['ocr_code'] = $candidates[0];
            $fallback['message'] = $fallback['message'] ?? 'Code detected but not linked.';

            return response()->json($fallback);
        }

        return response()->json([
            'found' => false,
            'message' => 'No VRET / AWB / Amazon Order ID detected in label image.',
        ], 404);
    }

    private function detectByCode(string $barcode): array
    {
        $barcode = strtoupper(trim($barcode));
        if ($barcode === '') {
            return [
                'found' => false,
                'message' => 'Empty barcode',
            ];
        }

        // Amazon order ID pattern (e.g. 171-2413408-2914735)
        if (preg_match('/^\d{3}-\d{7}-\d{7}$/', $barcode)) {
            $inventoryOrder = InventoryOrder::where('platform_order_id', $barcode)->first();
            if ($inventoryOrder) {
                return [
                    'found' => true,
                    'type' => 'amazon_order_id',
                    'barcode' => $barcode,
                    'order' => $inventoryOrder->load('items.sku'),
                    'message' => 'Amazon order ID matched.',
                ];
            }

            $salesOrder = SalesOrder::where('external_order_number', $barcode)
                ->orWhere('order_number', $barcode)
                ->first();
            if ($salesOrder) {
                return [
                    'found' => true,
                    'type' => 'amazon_order_id',
                    'barcode' => $barcode,
                    'order' => $salesOrder->load('items.product'),
                    'message' => 'Amazon order ID matched.',
                ];
            }

            return [
                'found' => false,
                'type' => 'amazon_order_id',
                'barcode' => $barcode,
                'message' => 'Order ID detected but not found in system.',
            ];
        }

        // Handle Amazon Return Order IDs (VRET...)
        if (str_starts_with($barcode, 'VRET')) {
            $order = SalesOrder::where('external_order_number', $barcode)->first();
            if ($order) {
                return [
                    'found' => true,
                    'type' => 'amazon_return',
                    'order' => $order->load('items.product'),
                    'message' => 'Found Amazon Order for this return ID',
                ];
            }

            return [
                'found' => false,
                'type' => 'amazon_return',
                'barcode' => $barcode,
                'message' => 'Amazon Return ID scanned but no matching order found in system',
            ];
        }

        // Handle Mylerz Tracking (MYLE...)
        if (str_starts_with($barcode, 'MYLE')) {
            return [
                'found' => true,
                'type' => 'tracking_number',
                'provider' => 'Mylerz',
                'tracking_number' => $barcode,
                'message' => 'Mylerz tracking number detected',
            ];
        }

        // Handle AWB (e.g. AWB AEG180212224 or AEG180212224)
        $awb = preg_replace('/^AWB\s*/', '', $barcode);
        if (preg_match('/^[A-Z]{2,6}\d{6,}$/', $awb)) {
            $order = SalesOrder::where('external_order_number', 'like', '%'.$awb.'%')
                ->orWhere('order_number', 'like', '%'.$awb.'%')
                ->first();
            if ($order) {
                return [
                    'found' => true,
                    'type' => 'awb',
                    'barcode' => $awb,
                    'order' => $order->load('items.product'),
                    'message' => 'AWB matched to order.',
                ];
            }

            return [
                'found' => true,
                'type' => 'awb',
                'barcode' => $awb,
                'tracking_number' => $awb,
                'message' => 'AWB detected. No direct order match found.',
            ];
        }

        // Find product by barcode (standard product scan)
        $product = Product::where('barcode', $barcode)->first();

        if (! $product) {
            return [
                'found' => false,
                'message' => 'Product not found',
            ];
        }

        // Try to detect channel from recent sales
        $recentSale = SalesOrder::whereHas('items', function ($q) use ($product) {
            $q->where('product_id', $product->id);
        })->orderBy('order_date', 'desc')->first();

        $detectedChannel = $recentSale ? $recentSale->warehouse->name ?? 'Unknown' : 'Unknown';

        return [
            'found' => true,
            'type' => 'product',
            'product' => $product,
            'detected_channel' => $detectedChannel,
            'suggestions' => [
                'last_sold_from' => $detectedChannel,
                'available_warehouses' => Warehouse::where('is_active', true)->get(['id', 'name']),
            ],
        ];
    }

    /**
     * Process return with condition-based auto-transfer.
     */
    public function processReturn(Request $request)
    {
        $validated = $request->validate([
            'product_id' => 'required|exists:products,id',
            'condition' => 'required|in:good,damaged',
            'detected_channel' => 'nullable|string',
            'warehouse_id' => 'required|exists:warehouses,id',
            'quantity' => 'required|integer|min:1',
            'notes' => 'nullable|string',
        ]);

        DB::beginTransaction();
        try {
            $product = Product::findOrFail($validated['product_id']);
            $warehouse = Warehouse::findOrFail($validated['warehouse_id']);

            // Create return record
            $returnItem = ReturnItem::create([
                'product_id' => $product->id,
                'warehouse_id' => $warehouse->id,
                'quantity' => $validated['quantity'],
                'condition' => $validated['condition'],
                'detected_channel' => $validated['detected_channel'],
                'notes' => $validated['notes'],
                'status' => 'processed',
            ]);

            // If condition is GOOD, auto-transfer back to inventory
            if ($validated['condition'] === 'good') {
                $inventory = Inventory::firstOrCreate(
                    [
                        'product_id' => $product->id,
                        'warehouse_id' => $warehouse->id,
                    ],
                    ['quantity' => 0]
                );

                $inventory->increment('quantity', $validated['quantity']);

                return response()->json([
                    'message' => 'Return processed and added back to inventory',
                    'return' => $returnItem,
                    'auto_transferred' => true,
                    'new_inventory_quantity' => $inventory->quantity,
                ]);
            }

            // If DAMAGED, mark but don't add to inventory
            return response()->json([
                'message' => 'Return processed - marked as damaged',
                'return' => $returnItem,
                'auto_transferred' => false,
            ]);

            DB::commit();

        } catch (\Exception $e) {
            DB::rollBack();

            return response()->json([
                'message' => 'Failed to process return',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    private function extractCandidates(string $text): array
    {
        $patterns = [
            '/\b\d{3}-\d{7}-\d{7}\b/', // Amazon order ID
            '/\bVRET[0-9A-Z\-]+\b/i',
            '/\bMYLE[0-9A-Z\-]+\b/i',
            '/\bAWB\s*([A-Z]{2,6}\d{6,})\b/i',
            '/\b[A-Z]{2,6}\d{6,}\b/', // Generic AWB
        ];

        $found = [];
        foreach ($patterns as $pattern) {
            if (preg_match_all($pattern, $text, $matches)) {
                foreach (($matches[1] ?? $matches[0]) as $m) {
                    $value = strtoupper(trim((string) $m));
                    if ($value !== '' && ! in_array($value, $found, true)) {
                        $found[] = $value;
                    }
                }
            }
        }

        return $found;
    }

    private function extractTextFromImageOrPdf(string $path, string $mimeType): string
    {
        $apiKey = config('services.gemini.api_key');
        if (empty($apiKey)) {
            Log::warning('Barcode OCR skipped: Gemini API key missing.');

            return '';
        }

        $model = config('services.gemini.model', 'gemini-1.5-flash');
        $url = "https://generativelanguage.googleapis.com/v1beta/models/{$model}:generateContent?key=".$apiKey;
        $prompt = 'Extract all visible text from this shipping return label exactly as printed. '
            .'Focus on AWB, VRET, MYLE, and Amazon order IDs in format 000-0000000-0000000.';

        try {
            $response = Http::timeout(60)->post($url, [
                'contents' => [[
                    'parts' => [
                        ['text' => $prompt],
                        [
                            'inline_data' => [
                                'mime_type' => $mimeType,
                                'data' => base64_encode((string) file_get_contents($path)),
                            ],
                        ],
                    ],
                ]],
            ]);

            if (! $response->successful()) {
                Log::warning('Barcode OCR request failed', ['status' => $response->status()]);

                return '';
            }

            return (string) ($response->json('candidates.0.content.parts.0.text') ?? '');
        } catch (\Throwable $e) {
            Log::warning('Barcode OCR exception', ['error' => $e->getMessage()]);

            return '';
        }
    }
}
