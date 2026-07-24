<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Application\Services\InventoryTransactionService;
use App\Domain\Models\Wms\InventoryAdjustment;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\PurchaseBatch;
use App\Domain\Models\Wms\PurchaseBatchItem;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;

class InventoryAdjustmentImportController extends Controller
{
    protected $transactionService;

    public function __construct(InventoryTransactionService $transactionService)
    {
        $this->transactionService = $transactionService;
    }

    private function mapHeaders(array $headerRow)
    {
        $map = [
            'sku' => -1,
            'quantity' => -1,
            'unit_cost' => -1,
            'location' => -1,
            'notes' => -1,
        ];

        $aliases = [
            'sku' => ['sku', 'رمز المنتج', 'item-sku', 'item sku', 'seller-sku'],
            'quantity' => ['quantity', 'qty', 'stock', 'count', 'الكمية', 'كمية', 'مخزون'],
            'unit_cost' => ['unit cost', 'cost', 'price', 'سعر التكلفة', 'تكلفة'],
            'location' => ['warehouse', 'location', 'store', 'المخزن', 'المستودع', 'warehouse name'],
            'notes' => ['notes', 'reason', 'ملاحظات'],
        ];

        foreach ($headerRow as $index => $col) {
            $colLower = mb_strtolower(trim($col));
            if (empty($colLower)) {
                continue;
            }

            foreach ($aliases as $key => $possibles) {
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
     * Download template for bulk adjustment import.
     */
    public function template()
    {
        error_reporting(0);
        $spreadsheet = new Spreadsheet;
        $sheet = $spreadsheet->getActiveSheet();

        // Set headers
        $headers = ['SKU*', 'Quantity*', 'Unit Cost', 'Warehouse Name*', 'Notes'];
        $sheet->fromArray($headers, null, 'A1');

        // Add example data
        $exampleData = [
            ['SKU-001', '50', '150.00', 'Main Warehouse', 'Initial Opening Balance'],
            ['SKU-002', '10', '200.50', 'Damaml', 'Found during stocktake'],
        ];
        $sheet->fromArray($exampleData, null, 'A2');

        // Helper text
        $sheet->setCellValue('G2', 'Instructions:');
        $sheet->setCellValue('G3', '1. SKU must match exactly.');
        $sheet->setCellValue('G4', '2. Warehouse Name must match exactly.');
        $sheet->setCellValue('G5', '3. Unit Cost is required for Opening Balance.');

        $writer = new Xlsx($spreadsheet);

        $fileName = 'inventory_adjustment_template.xlsx';

        return response()->streamDownload(function () use ($writer) {
            while (ob_get_level()) {
                ob_end_clean();
            }
            $writer->save('php://output');
        }, $fileName, [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ]);
    }

    /**
     * Import adjustments from Excel.
     */
    public function import(Request $request)
    {
        $request->validate([
            'file' => 'required|file|mimes:xlsx,xls,csv|max:10240',
        ]);

        $file = $request->file('file');

        // Must be authenticated - no fallback to preserve User Isolation
        $userId = auth()->id();
        if (! $userId) {
            return response()->json([
                'message' => 'User must be authenticated to import Opening Stock.',
                'success' => false,
            ], 401);
        }

        try {
            $spreadsheet = IOFactory::load($file->getPathname());
            $worksheet = $spreadsheet->getActiveSheet();
            $rows = $worksheet->toArray();

            $headerRow = array_shift($rows);
            $headerMap = $this->mapHeaders($headerRow);

            $results = [
                'success' => 0,
                'errors' => [],
            ];

            DB::beginTransaction();

            foreach ($rows as $index => $row) {
                // Skip empty rows
                if (empty(array_filter($row))) {
                    continue;
                }

                $rowNum = $index + 2;

                $skuCode = $headerMap['sku'] !== -1 ? trim($row[$headerMap['sku']] ?? '') : trim($row[0] ?? '');
                $quantity = $headerMap['quantity'] !== -1 ? floatval($row[$headerMap['quantity']] ?? 0) : floatval($row[1] ?? 0);
                $unitCost = $headerMap['unit_cost'] !== -1 ? floatval($row[$headerMap['unit_cost']] ?? 0) : (isset($row[2]) ? floatval($row[2]) : null);
                $warehouseName = $headerMap['location'] !== -1 ? trim($row[$headerMap['location']] ?? '') : trim($row[3] ?? '');
                $notes = $headerMap['notes'] !== -1 ? trim($row[$headerMap['notes']] ?? '') : (trim($row[4] ?? '') ?: 'Bulk Import');

                if (empty($skuCode) || $quantity <= 0 || empty($warehouseName)) {
                    $results['errors'][] = "Row {$rowNum}: Missing SKU, Quantity, or Warehouse.";

                    continue;
                }

                // Find SKU - Prioritize ones with an offer (meaning they are in the Master Product list)
                $sku = Sku::where('sku', $skuCode)
                    ->orderByRaw('offer_id IS NULL ASC') // DESC would put non-null first, wait...
                    ->orderByDesc('offer_id') // Put non-null offer_id at top
                    ->first();
                if (! $sku) {
                    $err = "Row {$rowNum}: SKU '{$skuCode}' not found. It may belong to another user or have null user_id (hidden by isolation).";
                    $results['errors'][] = $err;
                    Log::warning('Opening Stock Import - SKU not found', ['row' => $rowNum, 'sku' => $skuCode]);

                    continue;
                }

                // Find Warehouse (uses user isolation)
                $location = InventoryLocation::where('name', $warehouseName)->first();
                if (! $location) {
                    $err = "Row {$rowNum}: Warehouse '{$warehouseName}' not found. Check the name matches exactly.";
                    $results['errors'][] = $err;
                    Log::warning('Opening Stock Import - Warehouse not found', ['row' => $rowNum, 'warehouse' => $warehouseName]);

                    continue;
                }

                // Process Adjustment (Opening Balance style)
                try {
                    // 1. Create Adjustment Record
                    $adjustment = InventoryAdjustment::create([
                        'sku_id' => $sku->id,
                        'location_id' => $location->id,
                        'type' => 'OPENING_BALANCE',
                        'quantity' => $quantity, // Positive for addition
                        'unit_cost' => $unitCost,
                        'reason' => 'Bulk Import',
                        'notes' => $notes,
                        'user_id' => $userId,
                    ]);

                    // 2. Update Inventory (Add Stock)
                    $skuInventory = SkuInventory::firstOrCreate(
                        ['sku_id' => $sku->id, 'location_id' => $location->id],
                        ['quantity' => 0, 'user_id' => $userId]
                    );
                    $skuInventory->increment('quantity', $quantity);

                    // 3. Create Transaction
                    $this->transactionService->recordTransaction(
                        $sku->id,
                        $location->id,
                        'IN',
                        $quantity,
                        $skuInventory->quantity,
                        'ADJUSTMENT',
                        $adjustment->id,
                        "Import: {$notes}"
                    );

                    // 4. Create Purchase Batch (Important for FIFO/COGS)
                    // If no cost provided, use SKU cost or 0
                    $batchCost = $unitCost !== null ? $unitCost : ($sku->cost_price ?? 0);

                    $batch = PurchaseBatch::create([
                        'user_id' => $userId, // Explicitly set owner
                        'batch_number' => 'IMP-'.time().'-'.$rowNum,
                        'status' => 'received',
                        'payment_status' => 'paid', // Assume paid/owned for opening balance
                        'vendor_id' => null, // No vendor for opening balance
                        'location_id' => $location->id,
                        'received_at' => now(),
                        'notes' => "Imported Opening Balance - Row {$rowNum}",
                    ]);

                    PurchaseBatchItem::create([
                        'purchase_batch_id' => $batch->id,
                        'sku_id' => $sku->id,
                        'quantity_ordered' => $quantity,
                        'quantity_received' => $quantity,
                        'unit_cost' => $batchCost,
                        'expiry_date' => null,
                    ]);

                    $results['success']++;

                } catch (\Exception $e) {
                    Log::error("Import error at Row {$rowNum}: ".$e->getMessage());
                    $results['errors'][] = "Row {$rowNum}: Error processing - ".$e->getMessage();
                }
            }

            if (count($results['errors']) === 0) {
                DB::commit();

                return response()->json([
                    'message' => "Imported {$results['success']} items successfully.",
                    'success' => true,
                ]);
            } else {
                DB::rollBack();

                return response()->json([
                    'message' => 'Import failed with errors.',
                    'errors' => $results['errors'],
                    'success' => false,
                ], 422);
            }

        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Import error: '.$e->getMessage());

            return response()->json(['message' => 'Failed to process file: '.$e->getMessage()], 500);
        }
    }
}
