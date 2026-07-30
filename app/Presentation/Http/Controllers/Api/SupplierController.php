<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Validator;
use App\Application\Services\PurchaseImportService;
use App\Application\Services\SupplierIdentityConsolidationService;
use App\Domain\Models\Wms\Payment;
use App\Domain\Models\Wms\PurchaseBatch;
use App\Domain\Models\Wms\PurchaseReturn;
use App\Domain\Models\Wms\Supplier;
use App\Domain\Models\Wms\Vendor;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;

class SupplierController extends Controller
{
    private function parsePaymentMeta(?string $rawNotes): array
    {
        $notes = (string) ($rawNotes ?? '');
        $line = collect(preg_split('/\r\n|\r|\n/', $notes))
            ->first(fn ($entry) => str_starts_with(trim((string) $entry), '[PAYMENT]')) ?? '';

        preg_match('/paid=([0-9]+(?:\.[0-9]+)?)/i', $line, $paidMatch);
        preg_match('/remaining=([0-9]+(?:\.[0-9]+)?)/i', $line, $remainingMatch);
        preg_match('/type=(cash|credit)/i', $line, $typeMatch);
        preg_match('/status=([a-z_]+)/i', $line, $statusMatch);

        return [
            'paid' => isset($paidMatch[1]) ? (float) $paidMatch[1] : null,
            'remaining' => isset($remainingMatch[1]) ? (float) $remainingMatch[1] : null,
            'type' => isset($typeMatch[1]) ? strtolower((string) $typeMatch[1]) : null,
            'status' => isset($statusMatch[1]) ? strtolower((string) $statusMatch[1]) : null,
        ];
    }

    /**
     * @return array{paid: float, remaining: float}
     */
    private function resolvePurchaseInvoicePaidRemaining(PurchaseBatch $batch, float $invoiceTotal): array
    {
        $notes = (string) ($batch->notes ?? '');
        $hasPayment = str_contains($notes, '[PAYMENT]');
        $meta = $this->parsePaymentMeta($notes);
        $status = strtolower((string) ($batch->status ?? ''));

        if (($meta['type'] ?? '') === 'cash') {
            return ['paid' => $invoiceTotal, 'remaining' => 0.0];
        }

        if ($hasPayment && $meta['remaining'] !== null) {
            $remaining = max(0.0, min((float) $meta['remaining'], $invoiceTotal));

            return [
                'paid' => max(0.0, $invoiceTotal - $remaining),
                'remaining' => $remaining,
            ];
        }

        if ($hasPayment && $meta['paid'] !== null) {
            $paid = max(0.0, min((float) $meta['paid'], $invoiceTotal));

            return [
                'paid' => $paid,
                'remaining' => max(0.0, $invoiceTotal - $paid),
            ];
        }

        // Do not treat "received" (goods in) as fully paid without [PAYMENT] / cash meta:
        // credit purchases stay open until notes or linked Payment rows reflect settlement.

        return ['paid' => 0.0, 'remaining' => $invoiceTotal];
    }

    /**
     * Whether a Finance payment row is explicitly tied to a purchase invoice (batch).
     * Used to de-duplicate total_paid vs invoice [PAYMENT] / received settlement.
     */
    private function paymentReferencesPurchaseBatch(mixed $referenceType): bool
    {
        if ($referenceType === null || $referenceType === '') {
            return false;
        }

        $t = is_string($referenceType) ? $referenceType : (string) $referenceType;

        return is_a($t, PurchaseBatch::class, true)
            || str_ends_with($t, '\\PurchaseBatch')
            || $t === 'PurchaseBatch';
    }

    /**
     * Cash-mirror rows (AUTO_PURCHASE_BATCH) are skipped from KPI only when the linked batch is
     * in the current supplier invoice scope — settlement is already in [PAYMENT] meta for cash batches.
     * Out-of-scope AUTO rows (wrong payee / foreign batch) still appear in ledger and must reduce KPI.
     */
    private function shouldSkipAutoPurchaseBatchPaymentForKpi(mixed $payment, array $batchIdSet): bool
    {
        if (! str_contains((string) ($payment->notes ?? ''), 'AUTO_PURCHASE_BATCH:')) {
            return false;
        }

        $bid = (int) ($payment->reference_id ?? 0);
        if ($bid <= 0) {
            if (preg_match('/AUTO_PURCHASE_BATCH:(\d+)/', (string) ($payment->notes ?? ''), $m)) {
                $bid = (int) $m[1];
            }
        }

        return $bid > 0 && isset($batchIdSet[$bid]);
    }

    /**
     * Split completed supplier payments into amounts linked to purchase batches in scope vs orphan (on-account).
     *
     * @param  \Illuminate\Support\Collection|array<int, array<string, mixed>>  $invoiceRows
     * @param  \Illuminate\Support\Collection  $payments
     * @return array{paid_by_batch: array<int, float>, orphan_total: float}
     */
    private function allocateCompletedPaymentsByBatch($invoiceRows, $payments): array
    {
        $batchIdSet = [];
        foreach ($invoiceRows as $inv) {
            $batchIdSet[(int) $inv['id']] = true;
        }

        $paidByBatch = [];
        $orphan = 0.0;

        foreach ($payments as $payment) {
            if (strtolower((string) ($payment->status ?? '')) !== 'completed') {
                continue;
            }
            if ($this->shouldSkipAutoPurchaseBatchPaymentForKpi($payment, $batchIdSet)) {
                continue;
            }

            $amt = (float) $payment->amount;

            if ($this->paymentReferencesPurchaseBatch($payment->reference_type)) {
                $bid = (int) ($payment->reference_id ?? 0);
                if ($bid > 0 && isset($batchIdSet[$bid])) {
                    $paidByBatch[$bid] = ($paidByBatch[$bid] ?? 0.0) + $amt;

                    continue;
                }
            }

            $orphan += $amt;
        }

        return ['paid_by_batch' => $paidByBatch, 'orphan_total' => $orphan];
    }

    /**
     * KPI total paid: merge invoice-side paid with batch-linked payments without double-counting
     * when the same settlement is both reflected in [PAYMENT] meta and stored as a Payment row.
     */
    private function computeDedupedTotalPaid($invoiceRows, $payments): float
    {
        $alloc = $this->allocateCompletedPaymentsByBatch($invoiceRows, $payments);
        $paidByBatchId = $alloc['paid_by_batch'];
        $orphanPayments = $alloc['orphan_total'];

        $mergedBatchPaid = 0.0;
        foreach ($invoiceRows as $inv) {
            $bid = (int) $inv['id'];
            $invTotal = (float) $inv['total'];
            $fromMeta = (float) $inv['paid'];
            $fromLinkedPayments = (float) ($paidByBatchId[$bid] ?? 0.0);
            $effective = max($fromMeta, $fromLinkedPayments);
            if ($invTotal > 0) {
                $effective = min($invTotal, $effective);
            }
            $mergedBatchPaid += $effective;
        }

        return round($mergedBatchPaid + $orphanPayments, 2);
    }

    /**
     * Open AP: per-invoice remaining from notes, minus batch-linked payments that are not already
     * reflected in that remaining, then returns and orphan (on-account) payments.
     *
     * @param  \Illuminate\Support\Collection|array<int, array<string, mixed>>  $invoiceRows
     */
    private function computeOutstandingFromInvoiceLines($invoiceRows, $payments, float $totalReturns): float
    {
        $alloc = $this->allocateCompletedPaymentsByBatch($invoiceRows, $payments);
        $paidByBatchId = $alloc['paid_by_batch'];
        $orphanTotal = $alloc['orphan_total'];

        $sumLineOpen = 0.0;
        foreach ($invoiceRows as $inv) {
            $bid = (int) $inv['id'];
            $rem = (float) $inv['remaining'];
            $batchPay = (float) ($paidByBatchId[$bid] ?? 0.0);
            $sumLineOpen += max(0.0, $rem - $batchPay);
        }

        $afterReturns = max(0.0, $sumLineOpen - $totalReturns);

        return max(0.0, $afterReturns - $orphanTotal);
    }

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

        $supplier = Supplier::create($validator->validated());

        return response()->json($supplier, 201);
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
     * Payment rows for supplier KPI / ledger: canonical id, vendor-morph rows, normalized name
     * aliases (legacy orphans), and guarded vendor-id rows when another suppliers.id collides.
     */
    private function scopePaymentsForSupplierAccount(
        $query,
        Supplier $supplier,
        int $vendorId,
        SupplierIdentityConsolidationService $identity
    ): void {
        $supplierId = (int) $supplier->id;
        $normalizedAliases = array_values(array_unique(array_filter(array_map(
            fn (string $alias) => $identity->normalizeSupplierName($alias),
            $identity->nameAliasesFor($supplier)
        ))));

        $vendorIdHasSupplierCollision = $vendorId > 0
            && $vendorId !== $supplierId
            && Supplier::query()->whereKey($vendorId)->exists();

        $query->where(function ($q) use ($supplierId, $vendorId, $normalizedAliases, $vendorIdHasSupplierCollision) {
            $q->where('payee_id', $supplierId);

            if ($normalizedAliases !== []) {
                $q->orWhere(function ($q2) use ($normalizedAliases) {
                    foreach ($normalizedAliases as $alias) {
                        $q2->orWhereRaw(
                            "LOWER(REGEXP_REPLACE(TRIM(COALESCE(payee_name, '')), '\\s+', '', 'g')) = ?",
                            [$alias]
                        );
                    }
                });
            }

            if ($vendorId <= 0) {
                return;
            }

            $q->orWhere(function ($q2) use ($vendorId) {
                $q2->where('payee_id', $vendorId)
                    ->where(function ($q3) {
                        $q3->where('payee_type', Vendor::class)
                            ->orWhere('payee_type', 'like', '%Vendor%');
                    });
            });

            $q->orWhere(function ($q2) use ($vendorId, $normalizedAliases, $vendorIdHasSupplierCollision) {
                $q2->where('payee_id', $vendorId)
                    ->where(function ($q3) {
                        $q3->where('payee_type', Supplier::class)
                            ->orWhere('payee_type', 'like', '%Supplier%');
                    });

                if ($vendorIdHasSupplierCollision && $normalizedAliases !== []) {
                    $q2->where(function ($q3) use ($normalizedAliases) {
                        foreach ($normalizedAliases as $alias) {
                            $q3->orWhereRaw(
                                "LOWER(REGEXP_REPLACE(TRIM(COALESCE(payee_name, '')), '\\s+', '', 'g')) = ?",
                                [$alias]
                            );
                        }
                    });
                }
            });
        })->where(function ($q) {
            $q->where('payee_type', Vendor::class)
                ->orWhere('payee_type', Supplier::class)
                ->orWhere('payee_type', 'like', '%Vendor%')
                ->orWhere('payee_type', 'like', '%Supplier%');
        });
    }

    /**
     * Accounting view for supplier: KPIs + invoices + payments + ledger.
     */
    public function accountSummary(Request $request, $id)
    {
        $supplier = Supplier::findOrFail($id);
        $vendor = $supplier->resolveLinkedVendor();
        $vendorId = $vendor?->id ? (int) $vendor->id : (int) $supplier->id;

        $startDate = $request->query('start_date');
        $endDate = $request->query('end_date');

        $supplierNameTrim = trim((string) $supplier->name);
        $invoiceQuery = PurchaseBatch::with(['items.sku.offer.masterProduct', 'items.masterProduct'])
            ->where(function ($q) use ($vendorId, $supplier, $supplierNameTrim) {
                $q->where('vendor_id', $vendorId);
                if ($supplierNameTrim !== '') {
                    $q->orWhere('supplier_name_raw', $supplier->name)
                        ->orWhere('supplier_name_raw', $supplierNameTrim)
                        ->orWhereRaw('TRIM(supplier_name_raw) = ?', [$supplierNameTrim]);
                }
            })
            ->where('status', '!=', 'cancelled');

        if ($startDate && $endDate) {
            $invoiceQuery->whereBetween('invoice_date', [$startDate, $endDate]);
        }

        $invoices = $invoiceQuery->orderByDesc('invoice_date')->get();

        $returnsQuery = PurchaseReturn::query()
            ->with(['items'])
            ->where(function ($q) use ($vendorId, $supplier, $supplierNameTrim) {
                $q->where('vendor_id', $vendorId);
                $q->orWhere('supplier_id', (int) $supplier->id);
                if ($supplierNameTrim !== '') {
                    $q->orWhereRaw('TRIM(notes) LIKE ?', ['%'.$supplierNameTrim.'%']);
                }
            });

        if ($startDate && $endDate) {
            $returnsQuery->whereBetween('return_date', [$startDate, $endDate]);
        }

        $returns = $returnsQuery->orderByDesc('return_date')->get();

        $paymentQuery = Payment::query();
        $this->scopePaymentsForSupplierAccount(
            $paymentQuery,
            $supplier,
            $vendorId,
            app(SupplierIdentityConsolidationService::class)
        );
        $paymentQuery->whereIn('status', ['completed', 'pending']);

        if ($startDate && $endDate) {
            $paymentQuery->whereBetween('payment_date', [$startDate, $endDate]);
        }

        $payments = $paymentQuery->orderByDesc('payment_date')->get();

        $invoiceRows = $invoices->map(function ($batch) {
            $invoiceTotal = (float) ($batch->grand_total ?? $batch->subtotal ?? 0);
            $meta = $this->parsePaymentMeta($batch->notes);
            $resolved = $this->resolvePurchaseInvoicePaidRemaining($batch, $invoiceTotal);
            $resolvedPaid = (float) $resolved['paid'];
            $resolvedRemaining = (float) $resolved['remaining'];
            $resolvedStatus = PurchaseImportService::resolvePaymentMetaStatus(
                (string) ($batch->status ?? ''),
                $resolvedPaid,
                $resolvedRemaining,
                $meta['type'] ?? null
            );

            $lineItems = $batch->items->map(function ($item) {
                return [
                    'id' => $item->id,
                    'product_name' => $item->sku?->offer?->masterProduct?->internal_name
                        ?? $item->masterProduct?->internal_name
                        ?? $item->raw_description
                        ?? $item->sku?->sku,
                    'sku_code' => $item->sku?->sku ?? null,
                    'quantity' => (float) $item->quantity,
                    'unit_price' => (float) $item->unit_price,
                    'total_price' => (float) $item->total_price,
                ];
            })->values();

            return [
                'id' => $batch->id,
                'invoice_number' => $batch->invoice_number ?: $batch->batch_number,
                'date' => optional($batch->invoice_date)->toDateString() ?: optional($batch->created_at)->toDateString(),
                'total' => $invoiceTotal,
                'paid' => round($resolvedPaid, 2),
                'remaining' => round($resolvedRemaining, 2),
                'status' => $resolvedStatus,
                'items' => $lineItems,
            ];
        })->values();

        $paymentRows = $payments->map(function ($payment) {
            return [
                'id' => $payment->id,
                'date' => optional($payment->payment_date)->toDateString(),
                'amount' => (float) $payment->amount,
                'method' => $payment->payment_method,
                'reference' => $payment->payment_number ?: $payment->reference_id,
                'status' => $payment->status,
                'notes' => $payment->notes,
            ];
        })->values();

        $totalPurchases = (float) $invoiceRows->sum('total');
        $totalReturns = (float) $returns->sum(fn ($r) => (float) ($r->grand_total ?? 0));
        // KPI: do not add invoice [PAYMENT] / received totals + batch-linked Payment rows twice.
        $totalPaid = $this->computeDedupedTotalPaid($invoiceRows, $payments);
        // Open AP: avoid subtracting the full payment sum from global remaining (double-count vs batch-linked rows).
        $outstanding = $this->computeOutstandingFromInvoiceLines($invoiceRows, $payments, $totalReturns);
        // When no invoice window / no batches, fall back to supplier.balance (legacy).
        if ($totalPurchases <= 0 && $totalPaid <= 0 && $invoiceRows->isEmpty()) {
            $outstanding = (float) ($supplier->balance ?? 0);
        }

        $ledgerRows = collect();
        foreach ($invoiceRows as $inv) {
            $ledgerRows->push([
                'date' => $inv['date'],
                'description' => 'Purchase Invoice #'.$inv['invoice_number'],
                'debit' => $inv['total'],
                'credit' => 0.0,
                'source' => 'invoice',
                'source_id' => $inv['id'],
            ]);
        }
        foreach ($returns as $ret) {
            $ledgerRows->push([
                'date' => optional($ret->return_date)->toDateString() ?: optional($ret->created_at)->toDateString(),
                'description' => 'Purchase Return #'.($ret->return_number ?: $ret->id),
                'debit' => 0.0,
                'credit' => (float) ($ret->grand_total ?? 0),
                'source' => 'purchase_return',
                'source_id' => $ret->id,
            ]);
        }
        foreach ($paymentRows as $pay) {
            if ($pay['status'] !== 'cancelled') {
                $ledgerRows->push([
                    'date' => $pay['date'],
                    'description' => $this->supplierPaymentLedgerDescription(
                        (string) $supplier->name,
                        $pay['reference'] ?? null
                    ),
                    'debit' => 0.0,
                    'credit' => $pay['amount'],
                    'source' => 'payment',
                    'source_id' => $pay['id'],
                ]);
            }
        }

        $running = 0.0;
        $ledger = $ledgerRows
            ->sortBy(fn ($x) => $x['date'] ?? '0000-00-00')
            ->values()
            ->map(function ($row) use (&$running) {
                $running += ((float) $row['debit'] - (float) $row['credit']);
                $row['balance'] = round($running, 2);

                return $row;
            })
            ->values();

        $invoiceDates = $invoiceRows->pluck('date')->filter()->map(fn ($d) => Carbon::parse($d));
        $paymentDates = $paymentRows->where('status', 'completed')->pluck('date')->filter()->map(fn ($d) => Carbon::parse($d));
        $avgPaymentDays = 0;
        if ($invoiceDates->isNotEmpty() && $paymentDates->isNotEmpty()) {
            $days = [];
            foreach ($invoiceDates as $invDate) {
                $nextPayment = $paymentDates->first(fn ($pDate) => $pDate->greaterThanOrEqualTo($invDate));
                if ($nextPayment) {
                    $days[] = $invDate->diffInDays($nextPayment);
                }
            }
            if (! empty($days)) {
                $avgPaymentDays = round(array_sum($days) / count($days), 2);
            }
        }

        return response()->json([
            'supplier' => $supplier,
            'summary' => [
                'total_purchases' => round($totalPurchases, 2),
                'total_paid' => round($totalPaid, 2),
                'outstanding' => round($outstanding, 2),
                'invoice_count' => (int) $invoiceRows->count(),
                'avg_payment_days' => $avgPaymentDays,
            ],
            'invoices' => $invoiceRows,
            'payments' => $paymentRows,
            'returns' => $returns,
            'ledger' => $ledger,
        ]);
    }

    private function supplierPaymentLedgerDescription(string $supplierName, mixed $reference): string
    {
        $name = trim($supplierName) !== '' ? trim($supplierName) : 'المورد';
        $ref = trim((string) ($reference ?? ''));

        return 'سداد نقدي إلى '.$name.($ref !== '' ? ' — #'.$ref : '');
    }
}
