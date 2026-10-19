<?php

declare(strict_types=1);

namespace App\Application\Services;

use App\Domain\Models\Wms\InventoryAuditLog;
use App\Domain\Models\Wms\Payment;
use App\Domain\Models\Wms\PurchaseBatch;
use App\Domain\Models\Wms\Vendor;
use App\Domain\ValueObjects\PurchasePaymentMeta;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Voids treasury payments that were posted for money nobody entered as paid.
 *
 * Until 2026-10-19, receiving a purchase invoice marked "cash" posted an AUTO_PURCHASE_BATCH
 * payment for the whole invoice total, even when the user had entered paid=0 or a partial amount.
 * Treasury then showed cash leaving that never left.
 *
 * Ledger rules: the original payment is never edited or deleted. It is marked cancelled (so treasury,
 * cash flow and supplier statements stop counting it) and, when the user did enter a paid amount, a
 * replacement AUTO_PURCHASE_BATCH payment is posted for exactly that amount. Each correction writes an
 * InventoryAuditLog entry with the original rows. Re-running is safe: corrected batches no longer show
 * an excess.
 *
 * When the owner confirms a supplier's cash invoices really were paid in full (e.g. paid before the goods
 * arrived), {@see confirmPaidInFull()} records that on the invoice instead: the `[PAYMENT]` line becomes
 * paid = invoice total, the payment rows stay as they are, and the original notes go to the audit log.
 * That audit entry is the owner's evidence: confirmed invoices are never listed as excess again, even
 * when the payment is above the invoice total (lines edited down after the cash was paid).
 */
class AssumedPurchasePaymentCorrectionService
{
    public const AUDIT_ACTION = 'purchases.assumed_cash_payment_voided';

    public const AUDIT_ACTION_PAID_IN_FULL = 'purchases.cash_invoice_confirmed_paid_in_full';

    /**
     * @param  array<int, string>  $payees  only these supplier (payee) names; empty = all
     * @return Collection<int, array{batch_id: int, invoice: string, payee: string, total: float, entered_paid: float, auto_paid: float, excess: float, payment_ids: array<int, int>}>
     */
    public function findExcess(int $userId, array $payees = []): Collection
    {
        $payees = array_values(array_filter(array_map(fn ($name) => trim((string) $name), $payees), fn ($name) => $name !== ''));

        $autoByBatch = Payment::withoutGlobalScopes()
            ->where('user_id', $userId)
            ->where('status', 'completed')
            ->where('notes', 'like', '%AUTO_PURCHASE_BATCH:%')
            ->get()
            ->groupBy(fn (Payment $p) => $this->batchIdOf($p))
            ->forget(0);

        if ($autoByBatch->isEmpty()) {
            return collect();
        }

        $confirmedBatchIds = InventoryAuditLog::query()
            ->where('action', self::AUDIT_ACTION_PAID_IN_FULL)
            ->where('subject_type', PurchaseBatch::class)
            ->whereIn('subject_id', $autoByBatch->keys()->all())
            ->pluck('subject_id')
            ->all();

        return PurchaseBatch::withoutGlobalScopes()
            ->where('user_id', $userId)
            ->whereIn('id', $autoByBatch->keys()->all())
            ->whereNotIn('id', $confirmedBatchIds)
            ->where('status', '!=', 'cancelled')
            ->orderBy('id')
            ->get()
            ->filter(fn (PurchaseBatch $batch) => PurchasePaymentMeta::fromNotes($batch->notes)->type === 'cash')
            ->map(function (PurchaseBatch $batch) use ($autoByBatch) {
                $payments = $autoByBatch->get($batch->id);
                $total = (float) ($batch->grand_total ?? $batch->subtotal ?? 0);
                $entered = PurchasePaymentMeta::fromNotes($batch->notes)->paidAgainst($total);
                $auto = round((float) $payments->sum('amount'), 2);

                return [
                    'batch_id' => (int) $batch->id,
                    'invoice' => (string) ($batch->invoice_number ?: $batch->batch_number),
                    'payee' => (string) ($payments->first()->payee_name ?? ''),
                    'total' => round($total, 2),
                    'entered_paid' => round($entered, 2),
                    'auto_paid' => $auto,
                    'excess' => round($auto - $entered, 2),
                    'payment_ids' => $payments->pluck('id')->map(fn ($id) => (int) $id)->all(),
                ];
            })
            ->filter(fn (array $row) => $row['excess'] > 0.009)
            ->filter(fn (array $row) => $payees === [] || in_array($row['payee'], $payees, true))
            ->values();
    }

    /**
     * Record that the owner confirmed these cash invoices were paid in full: paid = invoice total.
     * Payment rows are not touched, including a payment above the invoice total; the notes change only
     * where the entered paid was below the total. Every confirmed invoice gets an audit entry.
     *
     * @param  Collection<int, array<string, mixed>>  $rows  from {@see findExcess()}
     * @return array{batches: int, amount_confirmed: float}
     */
    public function confirmPaidInFull(int $userId, Collection $rows): array
    {
        $result = ['batches' => 0, 'amount_confirmed' => 0.0];

        foreach ($rows as $row) {
            DB::transaction(function () use ($userId, $row, &$result) {
                $batch = PurchaseBatch::withoutGlobalScopes()
                    ->where('user_id', $userId)
                    ->whereKey($row['batch_id'])
                    ->lockForUpdate()
                    ->first();
                if (! $batch) {
                    return;
                }

                $total = (float) ($batch->grand_total ?? $batch->subtotal ?? 0);
                $meta = PurchasePaymentMeta::fromNotes($batch->notes);
                if ($meta->type !== 'cash' || $total <= 0.009) {
                    return;
                }

                $enteredPaid = $meta->paidAgainst($total);
                $originalNotes = (string) ($batch->notes ?? '');
                if ($enteredPaid < $total - 0.009) {
                    $status = PurchaseImportService::resolvePaymentMetaStatus((string) ($batch->status ?? ''), $total, 0.0, 'cash');
                    $batch->update([
                        'notes' => PurchasePaymentMeta::writeToNotes($originalNotes, 'cash', $total, 0.0, $status),
                    ]);
                }

                app(InventoryAuditLogService::class)->record(self::AUDIT_ACTION_PAID_IN_FULL, PurchaseBatch::class, (int) $batch->id, [
                    'invoice_total' => round($total, 2),
                    'previous_entered_paid' => round($enteredPaid, 2),
                    'auto_paid' => $row['auto_paid'],
                    'paid_above_invoice_total' => round(max(0.0, $row['auto_paid'] - $total), 2),
                    'payment_ids' => $row['payment_ids'],
                    'original_notes' => $originalNotes,
                    'new_notes' => $batch->notes,
                ]);

                $result['batches']++;
                $result['amount_confirmed'] += $total - $enteredPaid;
            });
        }

        $result['amount_confirmed'] = round($result['amount_confirmed'], 2);

        return $result;
    }

    /**
     * @param  Collection<int, array<string, mixed>>  $rows  from {@see findExcess()}
     * @return array{batches: int, voided_payments: int, replacement_payments: int, voided_amount: float, excess_removed: float}
     */
    public function apply(int $userId, Collection $rows): array
    {
        $result = ['batches' => 0, 'voided_payments' => 0, 'replacement_payments' => 0, 'voided_amount' => 0.0, 'excess_removed' => 0.0];

        foreach ($rows as $row) {
            DB::transaction(function () use ($userId, $row, &$result) {
                $originals = Payment::withoutGlobalScopes()
                    ->whereIn('id', $row['payment_ids'])
                    ->where('status', 'completed')
                    ->lockForUpdate()
                    ->get();
                if ($originals->isEmpty()) {
                    return;
                }

                $snapshot = $originals->map(fn (Payment $p) => $p->only([
                    'id', 'payment_number', 'payee_type', 'payee_id', 'payee_name', 'amount', 'payment_method',
                    'finance_account_id', 'payment_date', 'reference_type', 'reference_id', 'status', 'notes', 'warehouse_id',
                ]))->values()->all();

                foreach ($originals as $payment) {
                    $payment->update([
                        'status' => 'cancelled',
                        'notes' => trim((string) $payment->notes.' | VOID: assumed full cash payment, entered paid '.number_format($row['entered_paid'], 2, '.', '')),
                    ]);
                }

                $replacement = null;
                if ($row['entered_paid'] > 0.009) {
                    $first = $originals->first();
                    $replacement = Payment::withoutGlobalScopes()->create([
                        'payment_number' => $first->payment_number.'-R',
                        'payee_type' => $first->payee_type,
                        'payee_id' => $first->payee_id,
                        'payee_name' => $first->payee_name,
                        'warehouse_id' => $first->warehouse_id,
                        'finance_account_id' => $first->finance_account_id,
                        'amount' => $row['entered_paid'],
                        'payment_method' => $first->payment_method,
                        'payment_date' => $first->payment_date,
                        'reference_type' => $first->reference_type,
                        'reference_id' => $first->reference_id,
                        'status' => 'completed',
                        'notes' => 'AUTO_PURCHASE_BATCH:'.$row['batch_id'].' '.$row['invoice'].' (entered paid, replaces #'.$originals->pluck('id')->implode(',#').')',
                        'user_id' => $userId,
                    ]);
                }

                app(InventoryAuditLogService::class)->record(self::AUDIT_ACTION, PurchaseBatch::class, $row['batch_id'], [
                    'invoice_total' => $row['total'],
                    'entered_paid' => $row['entered_paid'],
                    'voided_amount' => $row['auto_paid'],
                    'original_payments' => $snapshot,
                    'replacement_payment_id' => $replacement?->id,
                ]);

                $result['batches']++;
                $result['voided_payments'] += $originals->count();
                $result['replacement_payments'] += $replacement ? 1 : 0;
                $result['voided_amount'] += (float) $originals->sum('amount');
                $result['excess_removed'] += (float) $originals->sum('amount') - (float) ($replacement?->amount ?? 0);
            });
        }

        $result['voided_amount'] = round($result['voided_amount'], 2);
        $result['excess_removed'] = round($result['excess_removed'], 2);

        return $result;
    }

    /**
     * Received cash invoices of the named suppliers whose treasury payments add up to less than the
     * invoice total (often nothing was ever posted). Used only for owner-confirmed suppliers: the
     * shortfall is real cash that left on the invoice date and treasury must show it.
     *
     * @param  array<int, string>  $payees  supplier (vendor) names; required — empty returns nothing
     * @return Collection<int, array{batch_id: int, invoice: string, payee: string, date: ?string, total: float, entered_paid: float, posted: float, shortfall: float}>
     */
    public function findUnpostedPaidInFull(int $userId, array $payees): Collection
    {
        $payees = array_values(array_filter(array_map(fn ($name) => trim((string) $name), $payees), fn ($name) => $name !== ''));
        if ($payees === []) {
            return collect();
        }

        $vendors = Vendor::withoutGlobalScopes()
            ->where('user_id', $userId)
            ->get(['id', 'name'])
            ->filter(fn (Vendor $v) => in_array(trim((string) $v->name), $payees, true))
            ->keyBy('id');
        if ($vendors->isEmpty()) {
            return collect();
        }

        return PurchaseBatch::withoutGlobalScopes()
            ->where('user_id', $userId)
            ->whereIn('vendor_id', $vendors->keys()->all())
            ->where('status', 'received')
            ->orderBy('id')
            ->get()
            ->filter(fn (PurchaseBatch $batch) => PurchasePaymentMeta::fromNotes($batch->notes)->type === 'cash')
            ->map(function (PurchaseBatch $batch) use ($userId, $vendors) {
                $total = (float) ($batch->grand_total ?? $batch->subtotal ?? 0);
                $posted = $this->postedForBatch($userId, (int) $batch->id);

                return [
                    'batch_id' => (int) $batch->id,
                    'invoice' => (string) ($batch->invoice_number ?: $batch->batch_number),
                    'payee' => trim((string) $vendors->get($batch->vendor_id)?->name),
                    'date' => $batch->invoice_date?->toDateString(),
                    'total' => round($total, 2),
                    'entered_paid' => round(PurchasePaymentMeta::fromNotes($batch->notes)->paidAgainst($total), 2),
                    'posted' => $posted,
                    'shortfall' => round($total - $posted, 2),
                ];
            })
            // Only invoices still open on the supplier account. One already entered as paid but missing
            // from treasury is a different question (paid some other way?) and is never posted here.
            ->filter(fn (array $row) => $row['total'] > 0.009
                && $row['shortfall'] > 0.009
                && $row['entered_paid'] < $row['total'] - 0.009)
            ->values();
    }

    /**
     * Owner confirmed these cash invoices were paid in full: post the missing treasury payment
     * (total − already posted) dated on the invoice date and set paid = invoice total on the invoice.
     * Existing payments are never touched. Each invoice gets an audit entry; re-running finds nothing.
     *
     * @param  Collection<int, array<string, mixed>>  $rows  from {@see findUnpostedPaidInFull()}
     * @return array{batches: int, amount_posted: float, payment_ids: array<int, int>}
     */
    public function postMissingPaidInFull(int $userId, Collection $rows): array
    {
        $result = ['batches' => 0, 'amount_posted' => 0.0, 'payment_ids' => []];
        $purchases = app(PurchaseImportService::class);

        foreach ($rows as $row) {
            DB::transaction(function () use ($userId, $row, $purchases, &$result) {
                $batch = PurchaseBatch::withoutGlobalScopes()
                    ->where('user_id', $userId)
                    ->whereKey($row['batch_id'])
                    ->lockForUpdate()
                    ->first();
                if (! $batch || (string) $batch->status !== 'received') {
                    return;
                }
                $meta = PurchasePaymentMeta::fromNotes($batch->notes);
                $vendor = Vendor::withoutGlobalScopes()->find((int) $batch->vendor_id);
                if ($meta->type !== 'cash' || ! $vendor) {
                    return;
                }

                $total = (float) ($batch->grand_total ?? $batch->subtotal ?? 0);
                $postedBefore = $this->postedForBatch($userId, (int) $batch->id);
                $shortfall = round($total - $postedBefore, 2);
                if ($total <= 0.009 || $shortfall <= 0.009) {
                    return;
                }

                $originalNotes = (string) ($batch->notes ?? '');
                $status = PurchaseImportService::resolvePaymentMetaStatus((string) $batch->status, $total, 0.0, 'cash');
                $batch->update([
                    'notes' => PurchasePaymentMeta::writeToNotes($originalNotes, 'cash', $total, 0.0, $status),
                ]);
                $payment = $purchases->postCashPurchasePayment($batch, $vendor, $shortfall, '(owner confirmed paid in full)');

                app(InventoryAuditLogService::class)->record(self::AUDIT_ACTION_PAID_IN_FULL, PurchaseBatch::class, (int) $batch->id, [
                    'invoice_total' => round($total, 2),
                    'previous_entered_paid' => round($meta->paidAgainst($total), 2),
                    'posted_before' => $postedBefore,
                    'posted_payment_id' => (int) $payment->id,
                    'posted_amount' => $shortfall,
                    'payment_date' => $payment->payment_date?->toDateString() ?? (string) $payment->payment_date,
                    'original_notes' => $originalNotes,
                    'new_notes' => $batch->notes,
                ]);

                $result['batches']++;
                $result['amount_posted'] += $shortfall;
                $result['payment_ids'][] = (int) $payment->id;
            });
        }

        $result['amount_posted'] = round($result['amount_posted'], 2);

        return $result;
    }

    /**
     * Completed treasury payments for one purchase invoice: its AUTO_PURCHASE_BATCH rows plus any
     * payment that references the batch directly.
     */
    private function postedForBatch(int $userId, int $batchId): float
    {
        return round((float) Payment::withoutGlobalScopes()
            ->where('user_id', $userId)
            ->where('status', 'completed')
            ->where(function ($q) use ($batchId) {
                $q->where('notes', 'like', '%AUTO_PURCHASE_BATCH:'.$batchId.'%')
                    ->orWhere(fn ($q2) => $q2->where('reference_type', PurchaseBatch::class)->where('reference_id', $batchId));
            })
            ->get()
            ->filter(fn (Payment $p) => $this->batchIdOf($p) === $batchId
                || ((string) $p->reference_type === PurchaseBatch::class && (int) $p->reference_id === $batchId))
            ->sum('amount'), 2);
    }

    private function batchIdOf(Payment $payment): int
    {
        if (preg_match('/AUTO_PURCHASE_BATCH:(\d+)/', (string) $payment->notes, $m)) {
            return (int) $m[1];
        }

        return 0;
    }
}
