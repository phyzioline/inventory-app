<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Maatwebsite\Excel\Facades\Excel;
use App\Domain\Models\Wms\ASIN;
use App\Domain\Models\Wms\Product;

class ASINController extends Controller
{
    /**
     * Display listing of ASINs.
     */
    public function index()
    {
        $asins = ASIN::with('product')->orderBy('created_at', 'desc')->get();

        return response()->json($asins);
    }

    /**
     * Store a newly created ASIN.
     */
    public function store(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'product_id' => 'required|exists:products,id',
            'asin_code' => 'required|string|size:10|unique:asins,asin_code',
            'marketplace' => 'nullable|string|max:50',
            'display_price' => 'nullable|numeric|min:0',
            'status' => 'nullable|in:active,paused,inactive,pending',
            'notes' => 'nullable|string',
        ]);

        if ($validator->fails()) {
            return response()->json(['errors' => $validator->errors()], 422);
        }

        $asin = ASIN::create($validator->validated());

        return response()->json($asin, 201);
    }

    /**
     * Update the specified ASIN.
     */
    public function update(Request $request, $id)
    {
        $asin = ASIN::findOrFail($id);

        $validator = Validator::make($request->all(), [
            'marketplace' => 'nullable|string|max:50',
            'display_price' => 'nullable|numeric|min:0',
            'status' => 'nullable|in:active,paused,inactive,pending',
            'notes' => 'nullable|string',
            'image_url' => 'nullable|string',
        ]);

        if ($validator->fails()) {
            return response()->json(['errors' => $validator->errors()], 422);
        }

        $asin->update($validator->validated());

        return response()->json($asin);
    }

    /**
     * Delete the specified ASIN.
     */
    public function destroy($id)
    {
        $asin = ASIN::findOrFail($id);
        $asin->delete();

        return response()->json(['message' => 'ASIN deleted successfully']);
    }

    /**
     * Bulk upload ASINs from Excel/CSV file with auto-linking.
     */
    public function bulkUpload(Request $request)
    {
        $request->validate([
            'file' => 'required|file|mimes:xlsx,xls,csv|max:10240',
        ]);

        try {
            $file = $request->file('file');
            $data = Excel::toArray([], $file)[0];

            // Remove header row
            $header = array_shift($data);

            $results = [
                'success' => [],
                'errors' => [],
                'duplicates' => [],
                'not_found' => [],
            ];

            foreach ($data as $index => $row) {
                $rowNumber = $index + 2;

                // Skip empty rows
                if (empty(array_filter($row))) {
                    continue;
                }

                // Map columns: Product SKU, ASIN Code, Marketplace, Display Price, Status, Notes
                $asinData = [
                    'product_sku' => $row[0] ?? null,
                    'asin_code' => strtoupper($row[1] ?? ''),
                    'marketplace' => $row[2] ?? null,
                    'display_price' => isset($row[3]) ? floatval($row[3]) : null,
                    'status' => $row[4] ?? 'active',
                    'notes' => $row[5] ?? null,
                ];

                // Validate required fields
                if (empty($asinData['product_sku']) || empty($asinData['asin_code'])) {
                    $results['errors'][] = [
                        'row' => $rowNumber,
                        'data' => $asinData,
                        'reason' => 'Product SKU and ASIN Code are required',
                    ];

                    continue;
                }

                // Validate ASIN format (10 alphanumeric characters)
                if (! preg_match('/^[A-Z0-9]{10}$/', $asinData['asin_code'])) {
                    $results['errors'][] = [
                        'row' => $rowNumber,
                        'data' => $asinData,
                        'reason' => 'ASIN must be exactly 10 alphanumeric characters',
                    ];

                    continue;
                }

                // Find product by SKU
                $product = Product::where('sku', $asinData['product_sku'])->first();

                if (! $product) {
                    $results['not_found'][] = [
                        'row' => $rowNumber,
                        'data' => $asinData,
                        'reason' => 'Product with SKU "'.$asinData['product_sku'].'" not found',
                    ];

                    continue;
                }

                // Check for duplicate ASIN
                $existingASIN = ASIN::where('asin_code', $asinData['asin_code'])->first();

                if ($existingASIN) {
                    $results['duplicates'][] = [
                        'row' => $rowNumber,
                        'data' => $asinData,
                        'existing' => $existingASIN,
                    ];

                    continue;
                }

                // Create ASIN
                try {
                    $asin = ASIN::create([
                        'product_id' => $product->id,
                        'asin_code' => $asinData['asin_code'],
                        'marketplace' => $asinData['marketplace'],
                        'display_price' => $asinData['display_price'],
                        'status' => $asinData['status'],
                        'notes' => $asinData['notes'],
                    ]);

                    $results['success'][] = [
                        'row' => $rowNumber,
                        'asin' => $asin,
                        'product' => $product,
                    ];
                } catch (\Exception $e) {
                    $results['errors'][] = [
                        'row' => $rowNumber,
                        'data' => $asinData,
                        'reason' => $e->getMessage(),
                    ];
                }
            }

            return response()->json([
                'message' => 'Bulk upload completed',
                'summary' => [
                    'total_rows' => count($data),
                    'successful' => count($results['success']),
                    'errors' => count($results['errors']),
                    'duplicates' => count($results['duplicates']),
                    'not_found' => count($results['not_found']),
                ],
                'results' => $results,
            ]);

        } catch (\Exception $e) {
            return response()->json([
                'message' => 'Failed to process file',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Download template for ASIN bulk upload.
     */
    public function downloadTemplate()
    {
        $headers = ['Product SKU*', 'ASIN Code*', 'Marketplace*', 'Display Price', 'Status', 'Notes'];
        $exampleData = [
            ['KNE-001', 'B08XYZABC1', 'Amazon.eg', '350', 'active', 'Main listing'],
            ['KNE-001', 'B08DEFGHI2', 'Amazon.ae', '95', 'active', 'UAE market'],
            ['ANK-002', 'B08JKLMNO3', 'Amazon.sa', '125', 'active', 'Saudi market'],
        ];

        $data = array_merge([$headers], $exampleData);

        return Excel::download(new class($data) implements \Maatwebsite\Excel\Concerns\FromArray
        {
            protected $data;

            public function __construct($data)
            {
                $this->data = $data;
            }

            public function array(): array
            {
                return $this->data;
            }
        }, 'asin-upload-template.xlsx');
    }

    /**
     * Get price history for an ASIN.
     */
    public function priceHistory($id)
    {
        $asin = ASIN::findOrFail($id);
        $history = $asin->priceHistory()->orderBy('created_at', 'desc')->get();

        return response()->json($history);
    }
}
