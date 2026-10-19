<?php

declare(strict_types=1);

namespace App\Application\Services;

use App\Domain\Models\Wms\Payment;
use App\Domain\Models\Wms\PurchaseBatch;
use App\Domain\Models\Wms\PurchaseReturn;
use App\Domain\Models\Wms\Receipt;
use App\Domain\Models\Wms\Supplier;
use App\Domain\Models\Wms\Vendor;
use App\Domain\ValueObjects\PurchasePaymentMeta;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * Supplier account (accounts payable) — the single server-side source for the suppliers screen,
 * the supplier statement, the purchase-invoice list's paid column and the correction commands.
 *
 * Balance = purchases − payments − (returns credited − refunds the supplier paid back in cash).
 *
 * Per-invoice paid/remaining: what was entered on the invoice and payments linked to it, then every
 * on-account payment and credit fills the open invoices oldest first ("the cup fills"). Allocation is
 * derived on every read and never stored, so editing or cancelling a payment re-allocates by itself
 * and the account totals do not depend on it.
 */
class SupplierAccountService
{
    public function __construct(
        private readonly SupplierIdentityConsolidationService $identity,
    ) {}

    /**
     * @return array{supplier: Supplier, summary: array<string, float|int>, invoices: Collection, payments: Collection, returns: Collection, refunds: Collection, ledger: Collection}
     */
    public function summarize(Supplier $supplier, ?string $startDate = null, ?string $endDate = null, bool $withItems = true): array
    {
        $vendor = $supplier->resolveLinkedVendor();
        $vendorId = $vendor?->id ? (int) $vendor->id : (int) $supplier->id;
        $hasRange = $startDate && $endDate;

        $supplierNameTrim = trim((string) $supplier->name);
        $invoiceQuery = PurchaseBatch::query()
            ->when($withItems, fn ($q) => $q->with(['items.sku.offer.masterProduct', 'items.masterProduct']))
            ->where(function ($q) use ($vendorId, $supplier, $supplierNameTrim) {
                $q->where('vendor_id', $vendorId);
                if ($supplierNameTrim !== '') {
                    $q->orWhere('supplier_name_raw', $supplier->name)
                        ->orWhere('supplier_name_raw', $supplierNameTrim)
                        ->orWhereRaw('TRIM(supplier_name_raw) = ?', [$supplierNameTrim]);
                }
            })
            ->where('status', '!=', 'cancelled');
        if ($hasRange) {
            $invoiceQuery->whereBetween('invoice_date', [$startDate, $endDate]);
        }
        $invoices = $invoiceQuery->orderByDesc('invoice_date')->get();

        $returnsQuery = PurchaseReturn::query()
            ->when($withItems, fn ($q) => $q->with(['items']))
            ->where(function ($q) use ($vendorId, $supplier, $supplierNameTrim) {
                $q->where('vendor_id', $vendorId);
                $q->orWhere('supplier_id', (int) $supplier->id);
                if ($supplierNameTrim !== '') {
                    $q->orWhereRaw('TRIM(notes) LIKE ?', ['%'.$supplierNameTrim.'%']);
                }
            });
        if ($hasRange) {
            $returnsQuery->whereBetween('return_date', [$startDate, $endDate]);
        }
        $returns = $returnsQuery->orderByDesc('return_date')->get();

        // Cash/bank the supplier paid back for a return: it uses up that return's credit.
        $refunds = $returns->isEmpty()
            ? collect()
            : Receipt::query()
                ->where('reference_type', PurchaseReturn::class)
                ->whereIn('reference_id', $returns->pluck('id')->all())
                ->get();

        $paymentQuery = Payment::query();
        $this->scopePaymentsForSupplierAccount($paymentQuery, $supplier, $vendorId);
        $paymentQuery->whereIn('status', ['completed', 'pending']);
        if ($hasRange) {
            $paymentQuery->whereBetween('payment_date', [$startDate, $endDate]);
        }
        $payments = $paymentQuery->orderByDesc('payment_date')->get();

        $batchIdSet = [];
        $cashBatchIds = [];
        foreach ($invoices as $batch) {
            $bid = (int) $batch->id;
            $batchIdSet[$bid] = true;
            if (PurchasePaymentMeta::fromNotes($batch->notes)->type === 'cash') {
                $cashBatchIds[$bid] = true;
            }
        }

        $paymentsForStatement = $payments
            ->filter(fn ($payment) => ! $this->shouldOmitAutoMirrorFromStatement($payment, $batchIdSet, $cashBatchIds))
            ->values();

        $invoiceRows = $invoices->map(function (PurchaseBatch $batch) use ($withItems) {
            $invoiceTotal = (float) ($batch->grand_total ?? $batch->subtotal ?? 0);
            $meta = PurchasePaymentMeta::fromNotes((string) ($batch->notes ?? ''));
            $paid = $meta->paidAgainst($invoiceTotal);
            $remaining = $meta->remainingAgainst($invoiceTotal);

            return [
                'id' => $batch->id,
                'invoice_number' => $batch->invoice_number ?: $batch->batch_number,
                'date' => optional($batch->invoice_date)->toDateString() ?: optional($batch->created_at)->toDateString(),
                'total' => $invoiceTotal,
                'paid' => round($paid, 2),
                'remaining' => round($remaining, 2),
                'status' => PurchaseImportService::resolvePaymentMetaStatus((string) ($batch->status ?? ''), $paid, $remaining, $meta->type),
                'batch_status' => (string) ($batch->status ?? ''),
                'items' => $withItems ? $batch->items->map(fn ($item) => [
                    'id' => $item->id,
                    'product_name' => $item->sku?->offer?->masterProduct?->internal_name
                        ?? $item->masterProduct?->internal_name
                        ?? $item->raw_description
                        ?? $item->sku?->sku,
                    'sku_code' => $item->sku?->sku ?? null,
                    'quantity' => (float) $item->quantity,
                    'unit_price' => (float) $item->unit_price,
                    'total_price' => (float) $item->total_price,
                ])->values() : collect(),
            ];
        })->values();

        $paymentRows = $paymentsForStatement->map(fn ($payment) => [
            'id' => $payment->id,
            'date' => optional($payment->payment_date)->toDateString(),
            'amount' => (float) $payment->amount,
            'method' => $payment->payment_method,
            'reference' => $payment->payment_number ?: $payment->reference_id,
            'status' => $payment->status,
            'notes' => $payment->notes,
        ])->values();

        $totalPurchases = (float) $invoiceRows->sum('total');
        $totalReturns = (float) $returns->sum(fn ($r) => (float) ($r->grand_total ?? 0));
        $totalRefunds = (float) $refunds->sum(fn ($r) => (float) ($r->amount ?? 0));
        $returnCredit = max(0.0, $totalReturns - $totalRefunds);
        $alloc = $this->allocateCompletedPaymentsByBatch($invoiceRows, $payments);
        // KPI: do not add invoice [PAYMENT] / received totals + batch-linked Payment rows twice.
        $totalPaid = $this->computeDedupedTotalPaid($invoiceRows, $alloc);
        // Open AP: avoid subtracting the full payment sum from global remaining (double-count vs batch-linked rows).
        $outstanding = $this->computeOutstandingFromInvoiceLines($invoiceRows, $alloc, $returnCredit);
        // When no invoice window / no batches, fall back to supplier.balance (legacy).
        if ($totalPurchases <= 0 && $totalPaid <= 0 && $invoiceRows->isEmpty()) {
            $outstanding = (float) ($supplier->balance ?? 0);
        }

        $invoiceRows = $this->allocateOldestFirst($invoiceRows, $alloc, $returnCredit);

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
                'description' => (SupplierStatementReconciliationService::isReconciliationNote($ret->reason)
                    ? 'Supplier statement reconciliation #'
                    : 'Purchase Return #').($ret->return_number ?: $ret->id),
                'debit' => 0.0,
                'credit' => (float) ($ret->grand_total ?? 0),
                'source' => 'purchase_return',
                'source_id' => $ret->id,
            ]);
        }
        foreach ($refunds as $refund) {
            $ledgerRows->push([
                'date' => optional($refund->receipt_date)->toDateString(),
                'description' => 'استرداد نقدي من المورد — Supplier refund #'.($refund->external_reference ?: $refund->id),
                'debit' => (float) $refund->amount,
                'credit' => 0.0,
                'source' => 'supplier_refund',
                'source_id' => $refund->id,
            ]);
        }
        foreach ($paymentRows as $pay) {
            if ($pay['status'] !== 'cancelled') {
                $ledgerRows->push([
                    'date' => $pay['date'],
                    'description' => $this->supplierPaymentLedgerDescription((string) $supplier->name, $pay['reference'] ?? null),
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

        return [
            'supplier' => $supplier,
            'summary' => [
                'total_purchases' => round($totalPurchases, 2),
                'total_paid' => round($totalPaid, 2),
                'outstanding' => round($outstanding, 2),
                // Signed: negative = the supplier holds a credit of yours (paid above purchases).
                'net_balance' => round($totalPurchases - $totalPaid - $returnCredit, 2),
                'invoice_count' => (int) $invoiceRows->count(),
                'avg_payment_days' => $avgPaymentDays,
            ],
            'invoices' => $invoiceRows,
            'payments' => $paymentRows,
            'returns' => $returns,
            'refunds' => $refunds,
            'ledger' => $ledger,
        ];
    }

    /**
     * Allocated paid/remaining/status for every non-cancelled purchase invoice of the tenant's suppliers.
     *
     * @param  array<int, int>|null  $vendorIds  only suppliers linked to these vendors (null = all)
     * @return array<int, array{paid: float, remaining: float, status: string}> keyed by purchase batch id
     */
    public function allocatedInvoicePayments(?array $vendorIds = null): array
    {
        $wanted = $vendorIds === null ? null : array_flip(array_map('intval', $vendorIds));
        $map = [];
        foreach (Supplier::query()->orderBy('id')->get() as $supplier) {
            if ($wanted !== null && ! isset($wanted[(int) ($supplier->resolveLinkedVendor()?->id ?? 0)])) {
                continue;
            }
            foreach ($this->summarize($supplier, null, null, false)['invoices'] as $inv) {
                $map[(int) $inv['id']] ??= [
                    'paid' => (float) $inv['paid'],
                    'remaining' => (float) $inv['remaining'],
                    'status' => (string) $inv['status'],
                ];
            }
        }

        return $map;
    }

    /**
     * Fill each invoice's open amount (after what was entered on it and payments linked to it) from the
     * on-account pool — unlinked payments plus return credit — oldest invoice first.
     *
     * @param  array{paid_by_batch: array<int, float>, orphan_total: float}  $alloc
     */
    private function allocateOldestFirst(Collection $invoiceRows, array $alloc, float $returnCredit): Collection
    {
        $pool = round(max(0.0, (float) $alloc['orphan_total']) + max(0.0, $returnCredit), 2);
        $linked = $alloc['paid_by_batch'];

        $order = $invoiceRows
            ->sortBy(fn ($inv) => sprintf('%s-%012d', $inv['date'] ?? '0000-00-00', (int) $inv['id']))
            ->pluck('id')
            ->all();
        $byId = $invoiceRows->keyBy('id');

        foreach ($order as $id) {
            $inv = $byId[$id];
            $total = (float) $inv['total'];
            // Same rule as computeOutstandingFromInvoiceLines(): linked payments reduce what the notes leave open.
            $open = max(0.0, round((float) $inv['remaining'] - (float) ($linked[(int) $id] ?? 0.0), 2));
            $paid = round($total - $open, 2);
            $take = min($open, $pool);
            $pool = round($pool - $take, 2);
            $paid = round($paid + $take, 2);
            $remaining = round(max(0.0, $total - $paid), 2);

            $inv['allocated'] = round($take, 2);
            $inv['paid'] = $paid;
            $inv['remaining'] = $remaining;
            $inv['status'] = PurchaseImportService::resolvePaymentMetaStatus((string) $inv['batch_status'], $paid, $remaining, null);
            $byId[$id] = $inv;
        }

        return $invoiceRows->map(fn ($inv) => $byId[$inv['id']])->values();
    }

    /**
     * Payment rows for supplier KPI / ledger: canonical supplier id, vendor-morph rows and normalized
     * name aliases (legacy orphans).
     */
    private function scopePaymentsForSupplierAccount($query, Supplier $supplier, int $vendorId): void
    {
        $supplierId = (int) $supplier->id;
        $normalizedAliases = array_values(array_unique(array_filter(array_map(
            fn (string $alias) => $this->identity->normalizeSupplierName($alias),
            $this->identity->nameAliasesFor($supplier)
        ))));

        $query->where(function ($q) use ($supplierId, $vendorId, $normalizedAliases) {
            // Supplier and vendor ids are separate sequences: a Vendor payee with the same id is
            // another company (vendor #47 مرتجعات ≠ supplier #47 جرجس). Vendor rows match below via $vendorId.
            $q->where(function ($q2) use ($supplierId) {
                $q2->where('payee_id', $supplierId)
                    ->where(function ($q3) {
                        $q3->where('payee_type', Supplier::class)
                            ->orWhere('payee_type', 'like', '%Supplier%');
                    });
            });

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
            // A Supplier-typed row whose id equals this supplier's vendor id is another (often legacy)
            // supplier — e.g. «جوميا» / «د/ غريب» — and only counts when its name matches (alias clause above).
        })->where(function ($q) {
            $q->where('payee_type', Vendor::class)
                ->orWhere('payee_type', Supplier::class)
                ->orWhere('payee_type', 'like', '%Vendor%')
                ->orWhere('payee_type', 'like', '%Supplier%');
        });
    }

    /**
     * Whether a Finance payment row is explicitly tied to a purchase invoice (batch).
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

        $bid = $this->autoPurchaseBatchId($payment);

        return $bid > 0 && isset($batchIdSet[$bid]);
    }

    private function autoPurchaseBatchId(mixed $payment): int
    {
        $bid = (int) ($payment->reference_id ?? 0);
        if ($bid <= 0 && preg_match('/AUTO_PURCHASE_BATCH:(\d+)/', (string) ($payment->notes ?? ''), $m)) {
            $bid = (int) $m[1];
        }

        return $bid;
    }

    /**
     * Statement/ledger must not treat a credit-invoice AUTO cash-mirror as a real payment.
     * Cash invoices keep the AUTO row — it is the settlement line (KPI already counts cash via [PAYMENT] meta).
     */
    private function shouldOmitAutoMirrorFromStatement(mixed $payment, array $batchIdSet, array $cashBatchIds): bool
    {
        if (! str_contains((string) ($payment->notes ?? ''), 'AUTO_PURCHASE_BATCH:')) {
            return false;
        }

        $bid = $this->autoPurchaseBatchId($payment);
        if ($bid <= 0 || ! isset($batchIdSet[$bid])) {
            return false;
        }

        return ! isset($cashBatchIds[$bid]);
    }

    /**
     * Split completed supplier payments into amounts linked to purchase batches in scope vs orphan (on-account).
     *
     * @return array{paid_by_batch: array<int, float>, orphan_total: float}
     */
    private function allocateCompletedPaymentsByBatch(Collection $invoiceRows, Collection $payments): array
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
     *
     * @param  array{paid_by_batch: array<int, float>, orphan_total: float}  $alloc
     */
    private function computeDedupedTotalPaid(Collection $invoiceRows, array $alloc): float
    {
        $mergedBatchPaid = 0.0;
        foreach ($invoiceRows as $inv) {
            $invTotal = (float) $inv['total'];
            $effective = max((float) $inv['paid'], (float) ($alloc['paid_by_batch'][(int) $inv['id']] ?? 0.0));
            if ($invTotal > 0) {
                $effective = min($invTotal, $effective);
            }
            $mergedBatchPaid += $effective;
        }

        return round($mergedBatchPaid + $alloc['orphan_total'], 2);
    }

    /**
     * Open AP: per-invoice remaining from notes, minus batch-linked payments that are not already
     * reflected in that remaining, then return credit and orphan (on-account) payments.
     *
     * @param  array{paid_by_batch: array<int, float>, orphan_total: float}  $alloc
     */
    private function computeOutstandingFromInvoiceLines(Collection $invoiceRows, array $alloc, float $returnCredit): float
    {
        $sumLineOpen = 0.0;
        foreach ($invoiceRows as $inv) {
            $batchPay = (float) ($alloc['paid_by_batch'][(int) $inv['id']] ?? 0.0);
            $sumLineOpen += max(0.0, (float) $inv['remaining'] - $batchPay);
        }

        $afterReturns = max(0.0, $sumLineOpen - $returnCredit);

        return max(0.0, $afterReturns - $alloc['orphan_total']);
    }

    private function supplierPaymentLedgerDescription(string $supplierName, mixed $reference): string
    {
        $name = trim($supplierName) !== '' ? trim($supplierName) : 'المورد';
        $ref = trim((string) ($reference ?? ''));

        return 'سداد نقدي إلى '.$name.($ref !== '' ? ' — #'.$ref : '');
    }
}
