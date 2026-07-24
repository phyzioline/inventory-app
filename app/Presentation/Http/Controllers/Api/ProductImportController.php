<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use App\Application\Services\ProductImportService;

class ProductImportController extends Controller
{
    protected ProductImportService $importService;

    public function __construct(ProductImportService $importService)
    {
        $this->importService = $importService;
    }

    public function upload(Request $request)
    {
        \Log::info('Product Import Upload Request', [
            'all' => $request->all(),
            'files' => $request->allFiles(),
            'headers' => $request->headers->all(),
        ]);

        $request->validate([
            'file' => 'required|file|mimes:csv,txt,xlsx,xls|max:20480', // 20MB max
        ]);

        try {
            $parseResult = $this->importService->parseFile($request->file('file'));

            return response()->json([
                'success' => true,
                'data' => $parseResult['data'],
                'errors' => $parseResult['errors'],
                'meta' => [
                    'total_rows' => $parseResult['total_rows'],
                    'valid_rows' => $parseResult['valid_rows'],
                ],
            ]);
        } catch (\Exception $e) {
            Log::error('Product Import Upload Error: '.$e->getMessage());

            return response()->json([
                'success' => false,
                'message' => 'Failed to parse file: '.$e->getMessage(),
            ], 422);
        }
    }

    public function confirm(Request $request)
    {
        set_time_limit(300); // 5 minutes for bulk import
        $request->validate([
            'products' => 'required|array',
            'products.*.name' => 'required|string',
            'products.*.sku' => 'required|string',
        ]);

        try {
            $results = $this->importService->import($request->products);

            return response()->json([
                'success' => true,
                'message' => 'Import processed successfully',
                'results' => $results,
            ]);
        } catch (\Exception $e) {
            Log::error('Product Import Confirmation Error: '.$e->getMessage());

            return response()->json([
                'success' => false,
                'message' => 'Import failed: '.$e->getMessage(),
            ], 500);
        }
    }

    public function drafts(Request $request)
    {
        $status = $request->query('status', 'pending');
        $drafts = $this->importService->getDrafts($status);

        return response()->json($drafts);
    }

    public function process(Request $request, int $id)
    {
        $request->validate([
            'action' => 'required|string|in:create_new,link_existing,reject',
            'matched_product_id' => 'nullable|integer',
        ]);

        try {
            $draft = $this->importService->processDraft($id, $request->action, $request->matched_product_id);

            return response()->json([
                'success' => true,
                'message' => 'Draft processed successfully',
                'data' => $draft,
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to process draft: '.$e->getMessage(),
            ], 422);
        }
    }

    public function batch(Request $request)
    {
        set_time_limit(300); // 5 minutes for batch processing
        $request->validate([
            'ids' => 'required|array',
            'ids.*' => 'integer',
            'action' => 'required|string|in:create_new,reject',
        ]);

        try {
            $results = $this->importService->processBatch($request->ids, $request->action);

            return response()->json([
                'success' => true,
                'message' => 'Batch processing completed',
                'results' => $results,
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Batch processing failed: '.$e->getMessage(),
            ], 500);
        }
    }

    public function template()
    {
        error_reporting(0);
        $headers = [
            'اسم المنتج الأساسي*',
            'SKU*',
            'اسم المورد',
            'ملاحظات',
            'التصنيف',
            'الوصف',
            'سعر الشراء',
            'الباركود',
            'حد أدنى للمخزون',
            'رابط الصورة',
        ];

        $callback = function () use ($headers) {
            while (ob_get_level()) {
                ob_end_clean();
            }
            $file = fopen('php://output', 'w');

            // Add BOM for Excel UTF-8 compatibility
            fwrite($file, "\xEF\xBB\xBF");

            fputcsv($file, $headers);

            // Example row
            fputcsv($file, ['مثال: مجموعة هاند جريب', 'SHOP-HG-001', 'مورد عام', 'اختياري', 'أجهزة رياضية', 'وصف مختصر', '120.00', '123456789', '5', 'https://example.com/image.jpg']);

            fclose($file);
        };

        return response()->stream($callback, 200, [
            'Content-type' => 'text/csv',
            'Content-Disposition' => 'attachment; filename=product_import_template.csv',
            'Pragma' => 'no-cache',
            'Cache-Control' => 'must-revalidate, post-check=0, pre-check=0',
            'Expires' => '0',
        ]);
    }
}
