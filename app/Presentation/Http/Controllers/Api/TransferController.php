<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Maatwebsite\Excel\Facades\Excel;
use App\Domain\Models\Wms\Inventory;
use App\Domain\Models\Wms\Product;
use App\Domain\Models\Wms\Warehouse;

class TransferController extends Controller
{
    /**
     * Get all transfers.
     */
    public function index()
    {
        // This would typically come from a transfers table
        // For now, return empty array
        return response()->json([]);
    }

    /**
     * Bulk upload transfers from Excel/CSV file.
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
                'not_found' => [],
            ];

            // Store transfers for review
            $transferBatch = [];

            foreach ($data as $index => $row) {
                $rowNumber = $index + 2;

                // Skip empty rows
                if (empty(array_filter($row))) {
                    continue;
                }

                // Map columns: Product SKU, From Warehouse, To Warehouse, Quantity, Notes
                $transferData = [
                    'product_sku' => $row[0] ?? null,
                    'from_warehouse' => $row[1] ?? null,
                    'to_warehouse' => $row[2] ?? null,
                    'quantity' => isset($row[3]) ? intval($row[3]) : 0,
                    'notes' => $row[4] ?? null,
                ];

                // Validate required fields
                if (empty($transferData['product_sku']) || empty($transferData['from_warehouse']) || empty($transferData['to_warehouse'])) {
                    $results['errors'][] = [
                        'row' => $rowNumber,
                        'data' => $transferData,
                        'reason' => 'Product SKU, From Warehouse, and To Warehouse are required',
                    ];

                    continue;
                }

                if ($transferData['quantity'] <= 0) {
                    $results['errors'][] = [
                        'row' => $rowNumber,
                        'data' => $transferData,
                        'reason' => 'Quantity must be greater than 0',
                    ];

                    continue;
                }

                // Find product
                $product = Product::where('sku', $transferData['product_sku'])->first();
                if (! $product) {
                    $results['not_found'][] = [
                        'row' => $rowNumber,
                        'data' => $transferData,
                        'reason' => 'Product not found',
                    ];

                    continue;
                }

                // Find warehouses
                $fromWarehouse = Warehouse::where('name', 'LIKE', '%'.$transferData['from_warehouse'].'%')->first();
                $toWarehouse = Warehouse::where('name', 'LIKE', '%'.$transferData['to_warehouse'].'%')->first();

                if (! $fromWarehouse || ! $toWarehouse) {
                    $results['not_found'][] = [
                        'row' => $rowNumber,
                        'data' => $transferData,
                        'reason' => 'Warehouse(s) not found',
                    ];

                    continue;
                }

                // Check inventory availability
                $inventory = Inventory::where('product_id', $product->id)
                    ->where('warehouse_id', $fromWarehouse->id)
                    ->first();

                if (! $inventory || $inventory->quantity < $transferData['quantity']) {
                    $results['errors'][] = [
                        'row' => $rowNumber,
                        'data' => $transferData,
                        'reason' => 'Insufficient inventory in source warehouse',
                    ];

                    continue;
                }

                // Add to batch for review
                $transferBatch[] = [
                    'row' => $rowNumber,
                    'product' => $product,
                    'from_warehouse' => $fromWarehouse,
                    'to_warehouse' => $toWarehouse,
                    'quantity' => $transferData['quantity'],
                    'notes' => $transferData['notes'],
                    'current_stock' => $inventory->quantity,
                ];
            }

            return response()->json([
                'message' => 'Upload processed - review transfers before executing',
                'summary' => [
                    'total_rows' => count($data),
                    'ready_to_transfer' => count($transferBatch),
                    'errors' => count($results['errors']),
                    'not_found' => count($results['not_found']),
                ],
                'transfers' => $transferBatch,
                'errors' => $results['errors'],
                'not_found' => $results['not_found'],
            ]);

        } catch (\Exception $e) {
            return response()->json([
                'message' => 'Failed to process file',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Execute bulk transfers.
     */
    public function executeBulkTransfer(Request $request)
    {
        $validated = $request->validate([
            'transfers' => 'required|array',
            'transfers.*.product_id' => 'required|exists:products,id',
            'transfers.*.from_warehouse_id' => 'required|exists:warehouses,id',
            'transfers.*.to_warehouse_id' => 'required|exists:warehouses,id',
            'transfers.*.quantity' => 'required|integer|min:1',
        ]);

        DB::beginTransaction();
        try {
            $results = [];

            foreach ($validated['transfers'] as $transfer) {
                // Deduct from source
                $fromInventory = Inventory::firstOrCreate(
                    [
                        'product_id' => $transfer['product_id'],
                        'warehouse_id' => $transfer['from_warehouse_id'],
                    ],
                    ['quantity' => 0]
                );

                if ($fromInventory->quantity < $transfer['quantity']) {
                    throw new \Exception('Insufficient inventory');
                }

                $fromInventory->decrement('quantity', $transfer['quantity']);

                // Add to destination
                $toInventory = Inventory::firstOrCreate(
                    [
                        'product_id' => $transfer['product_id'],
                        'warehouse_id' => $transfer['to_warehouse_id'],
                    ],
                    ['quantity' => 0]
                );

                $toInventory->increment('quantity', $transfer['quantity']);

                $results[] = [
                    'product_id' => $transfer['product_id'],
                    'transferred' => $transfer['quantity'],
                ];
            }

            DB::commit();

            return response()->json([
                'message' => 'Bulk transfer completed successfully',
                'transferred' => count($results),
            ]);

        } catch (\Exception $e) {
            DB::rollBack();

            return response()->json([
                'message' => 'Transfer failed',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Download template for bulk transfer.
     */
    public function downloadTemplate()
    {
        $headers = ['Product SKU*', 'From Warehouse*', 'To Warehouse*', 'Quantity*', 'Notes'];
        $exampleData = [
            ['KNE-001', 'Main Warehouse', 'Amazon FBA', '50', 'Shipment #12345'],
            ['ANK-002', 'Main Warehouse', 'Amazon FBA', '30', 'Shipment #12345'],
            ['SHL-003', 'Store', 'Main Warehouse', '10', 'Restocking'],
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
        }, 'transfer-upload-template.xlsx');
    }
}
