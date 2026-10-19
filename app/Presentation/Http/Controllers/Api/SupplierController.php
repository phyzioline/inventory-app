<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use App\Application\Services\SupplierAccountService;
use App\Domain\Models\Wms\Payment;
use App\Domain\Models\Wms\Supplier;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;

class SupplierController extends Controller
{
    /**
     * Display a listing of suppliers.
     */
    public function index()
    {
        $suppliers = Supplier::orderBy('name')->get();

        return response()->json($suppliers);
    }

    /**
     * Store a newly created supplier.
     */
    public function store(Request $request)
    {
        $request->merge([
            'email' => $this->nullIfBlank($request->input('email')),
            'phone' => $this->nullIfBlank($request->input('phone')),
            'address' => $this->nullIfBlank($request->input('address')),
            'balance' => $request->input('balance') === '' || $request->input('balance') === null
                ? 0
                : $request->input('balance'),
        ]);

        $validator = Validator::make($request->all(), [
            'name' => 'required|string|max:255',
            'email' => 'nullable|email|max:255',
            'phone' => 'nullable|string|max:50',
            'address' => 'nullable|string|max:500',
            'balance' => 'nullable|numeric',
        ]);

        if ($validator->fails()) {
            return response()->json(['errors' => $validator->errors()], 422);
        }

        $data = $validator->validated();
        $data['balance'] = isset($data['balance']) ? (float) $data['balance'] : 0.0;

        try {
            $supplier = Supplier::create($data);
        } catch (\Throwable $e) {
            report($e);

            return response()->json([
                'message' => 'Could not create supplier',
                'error' => config('app.debug') ? $e->getMessage() : null,
            ], 500);
        }

        return response()->json($supplier, 201);
    }

    private function nullIfBlank(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $trimmed = trim((string) $value);

        return $trimmed === '' ? null : $trimmed;
    }

    /**
     * Display the specified supplier.
     */
    public function show($id)
    {
        $supplier = Supplier::findOrFail($id);

        return response()->json($supplier);
    }

    /**
     * Update the specified supplier.
     */
    public function update(Request $request, $id)
    {
        $supplier = Supplier::findOrFail($id);

        $validator = Validator::make($request->all(), [
            'name' => 'sometimes|required|string|max:255',
            'email' => 'nullable|email|max:255',
            'phone' => 'nullable|string|max:50',
            'address' => 'nullable|string|max:500',
            'balance' => 'nullable|numeric',
        ]);

        if ($validator->fails()) {
            return response()->json(['errors' => $validator->errors()], 422);
        }

        $supplier->update($validator->validated());

        return response()->json($supplier);
    }

    /**
     * Remove the specified supplier.
     */
    public function destroy($id)
    {
        $supplier = Supplier::findOrFail($id);
        $supplier->delete();

        return response()->json(['message' => 'Supplier deleted successfully']);
    }

    /**
     * Bulk upload suppliers from Excel/CSV file.
     */
    public function bulkUpload(Request $request)
    {
        $request->validate([
            'file' => 'required|file|mimes:xlsx,xls,csv|max:10240', // 10MB max
        ]);

        try {
            $file = $request->file('file');

            // Load spreadsheet
            $spreadsheet = IOFactory::load($file->getPathname());
            $worksheet = $spreadsheet->getActiveSheet();
            $data = $worksheet->toArray();

            // Remove header row
            $header = array_shift($data);

            $results = [
                'success' => [],
                'errors' => [],
                'duplicates' => [],
            ];

            foreach ($data as $index => $row) {
                $rowNumber = $index + 2; // +2 because we removed header and Excel is 1-indexed

                // Skip empty rows
                if (empty(array_filter($row))) {
                    continue;
                }

                // Map columns: Name, Email, Phone, Address, Initial Balance
                $supplierData = [
                    'name' => $row[0] ?? null,
                    'email' => $row[1] ?? null,
                    'phone' => $row[2] ?? null,
                    'address' => $row[3] ?? null,
                    'balance' => isset($row[4]) ? floatval($row[4]) : 0,
                ];

                // Validate required fields
                if (empty($supplierData['name'])) {
                    $results['errors'][] = [
                        'row' => $rowNumber,
                        'data' => $supplierData,
                        'reason' => 'Name is required',
                    ];

                    continue;
                }

                // Check for duplicates (by name or email)
                $existingSupplier = Supplier::where('name', $supplierData['name']);
                if (! empty($supplierData['email'])) {
                    $existingSupplier->orWhere('email', $supplierData['email']);
                }
                $existingSupplier = $existingSupplier->first();

                if ($existingSupplier) {
                    $results['duplicates'][] = [
                        'row' => $rowNumber,
                        'data' => $supplierData,
                        'existing' => $existingSupplier,
                    ];

                    continue;
                }

                // Create supplier
                try {
                    $supplier = Supplier::create($supplierData);
                    $results['success'][] = [
                        'row' => $rowNumber,
                        'supplier' => $supplier,
                    ];
                } catch (\Exception $e) {
                    $results['errors'][] = [
                        'row' => $rowNumber,
                        'data' => $supplierData,
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
     * Download template for bulk upload.
     */
    public function downloadTemplate()
    {
        \Log::info('Downloading Supplier Template request received');

        // Create new spreadsheet
        $spreadsheet = new Spreadsheet;
        $sheet = $spreadsheet->getActiveSheet();

        // Set headers
        $headers = ['Name*', 'Email', 'Phone', 'Address', 'Initial Balance'];
        $sheet->fromArray($headers, null, 'A1');

        // Add example data
        $exampleData = [
            ['Supplier ABC', 'supplier@example.com', '+20123456789', 'Cairo, Egypt', '0'],
            ['Supplier XYZ', 'xyz@example.com', '+20987654321', 'Alexandria, Egypt', '0'],
        ];
        $sheet->fromArray($exampleData, null, 'A2');

        // Create writer and save to output
        $writer = new Xlsx($spreadsheet);

        // Set headers for download
        $fileName = 'supplier-upload-template.xlsx';
        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment;filename="'.$fileName.'"');
        header('Cache-Control: max-age=0');

        // Save to php://output
        $writer->save('php://output');
        exit;
    }

    /**
     * Process a payment to the supplier (treasury-backed Payment row + balance update).
     */
    public function pay(Request $request, $id)
    {
        $request->validate([
            'amount' => 'required|numeric|min:0.01',
            'notes' => 'nullable|string|max:500',
            'payment_method' => 'required|string', // cash, bank_transfer, etc.
            'payment_date' => 'nullable|date',
        ]);

        $supplier = Supplier::findOrFail($id);
        $amount = round((float) $request->amount, 2);
        $userId = (int) (\Illuminate\Support\Facades\Auth::id() ?? 0);

        $spendGuard = app(\App\Application\Services\TreasurySpendGuard::class);
        $spendGuard->ensureCapitalRegistered();
        $spendGuard->assertPaymentAllowed($amount);

        $ledger = app(\App\Application\Services\FinanceAccountLedgerService::class);
        $ledger->ensureDefaultAccountsForUser($userId);
        $financeAccountId = $ledger->resolveFinanceAccountId(
            null,
            (string) $request->payment_method,
            $userId
        );

        \Illuminate\Support\Facades\DB::beginTransaction();
        try {
            $prefix = 'PAY-';
            $last = (string) Payment::whereNotNull('payment_number')
                ->where('payment_number', 'like', $prefix.'%')
                ->orderByDesc('id')
                ->value('payment_number');
            $lastNum = (int) preg_replace('/\D+/', '', $last ?: '');
            $next = $lastNum + 1;
            $paymentNumber = $prefix.str_pad((string) $next, 3, '0', STR_PAD_LEFT);
            while (Payment::where('payment_number', $paymentNumber)->exists()) {
                $next++;
                $paymentNumber = $prefix.str_pad((string) $next, 3, '0', STR_PAD_LEFT);
            }

            $payment = Payment::create([
                'payment_number' => $paymentNumber,
                'payee_type' => Supplier::class,
                'payee_id' => $supplier->id,
                'payee_name' => $supplier->name,
                'amount' => $amount,
                'payment_method' => $request->payment_method,
                'payment_date' => $request->input('payment_date', now()->toDateString()),
                'status' => 'completed',
                'notes' => $request->input('notes'),
                'user_id' => $userId,
                'finance_account_id' => $financeAccountId,
            ]);

            $supplier->balance = (float) $supplier->balance - $amount;
            $supplier->save();

            $linkedVendor = $supplier->resolveLinkedVendor();
            if ($linkedVendor) {
                $linkedVendor->updateBalance($amount, 'subtract');
            }

            \Illuminate\Support\Facades\DB::commit();

            app(\App\Application\Services\InventoryAuditLogService::class)->record(
                'supplier.pay',
                Supplier::class,
                (int) $supplier->id,
                [
                    'amount' => $amount,
                    'payment_id' => $payment->id,
                    'payment_number' => $payment->payment_number,
                ],
            );

            return response()->json([
                'message' => 'Payment recorded successfully',
                'supplier' => $supplier->fresh(),
                'payment' => $payment,
            ], 201);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\DB::rollBack();

            return response()->json([
                'message' => 'Payment failed',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Accounting view for supplier: KPIs + invoices + payments + ledger ({@see SupplierAccountService}).
     */
    public function accountSummary(Request $request, $id, SupplierAccountService $accounts)
    {
        $supplier = Supplier::findOrFail($id);

        return response()->json($accounts->summarize(
            $supplier,
            $request->query('start_date'),
            $request->query('end_date'),
        ));
    }
}
