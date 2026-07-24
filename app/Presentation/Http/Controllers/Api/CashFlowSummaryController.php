<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use App\Application\Services\FinanceAccountLedgerService;
use App\Domain\Models\Wms\CapitalSource;
use App\Domain\Models\Wms\Expense;
use App\Domain\Models\Wms\Payment;
use App\Domain\Models\Wms\PurchaseBatch;
use App\Domain\Models\Wms\Receipt;
use Throwable;

/**
 * Full cash-flow aggregates for the Bank Accounts dashboard (not paginated list totals).
 *
 * Treasury rules (inventory finance):
 * - Inflow pool: sum(inv_receipts.amount) for the user — includes capital injection receipts, sales/settlements, manual receipts.
 * - Outflow pool: sum(inv_expenses) + sum(inv_payments) completed/confirmed (same KPI as Payments screen; no separate purchase-settlement add-on to avoid double counting).
 * - Spendable cash: total_receipts − total_outflow (also exposed as estimated_balance).
 * - Outbound writes (payments, expenses, auto cash purchase mirror) must pass TreasurySpendGuard against that position.
 * - Cash vs bank KPI split for payments: null/blank/cash → cash lane; all other methods → bank lane (same default-account semantics as the ledger).
 */
class CashFlowSummaryController extends Controller
{
    private function rowDate(?string $dateAttr, $model, string $fallbackColumn = 'created_at'): string
    {
        $v = $dateAttr !== null ? $model->{$dateAttr} : null;
        if ($v instanceof CarbonInterface) {
            return $v->toDateString();
        }
        if (is_string($v) && $v !== '') {
            try {
                return \Carbon\Carbon::parse($v)->toDateString();
            } catch (Throwable) {
                // fall through
            }
        }
        $fb = $model->{$fallbackColumn} ?? null;
        if ($fb instanceof CarbonInterface) {
            return $fb->toDateString();
        }

        return '';
    }

    private function parseBatchPaymentMeta(?string $rawNotes): array
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
            'type' => isset($typeMatch[1]) ? strtolower((string) $typeMatch[1]) : '',
            'status' => isset($statusMatch[1]) ? strtolower((string) $statusMatch[1]) : '',
        ];
    }

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

    /** Payments linked to purchase invoices (PurchaseBatch). */
    private function wherePaymentReferencesPurchaseBatch(Builder $q): Builder
    {
        return $q->where(function (Builder $w) {
            $w->where('reference_type', PurchaseBatch::class)
                ->orWhere('reference_type', 'PurchaseBatch')
                ->orWhere('reference_type', 'like', '%\\PurchaseBatch');
        })->whereNotNull('reference_id');
    }

    /**
     * Paid amount implied by invoice notes only (no "received = fully paid" fallback — avoids double-count vs Payment rows).
     */
    private function resolveBatchPaidAmountForCashFlow(PurchaseBatch $batch, float $invoiceTotal): float
    {
        if ($invoiceTotal <= 0.00001) {
            return 0.0;
        }
        $meta = $this->parseBatchPaymentMeta((string) ($batch->notes ?? ''));
        if (($meta['type'] ?? '') === 'cash') {
            return $invoiceTotal;
        }
        if ($meta['remaining'] !== null) {
            $remaining = max(0.0, min((float) $meta['remaining'], $invoiceTotal));

            return max(0.0, $invoiceTotal - $remaining);
        }
        if ($meta['paid'] !== null) {
            return max(0.0, min((float) $meta['paid'], $invoiceTotal));
        }

        return 0.0;
    }

    /**
     * Payment rows that count as cash outflow (must stay in sync with {@see buildCoreCashStatsForUser()}).
     * Includes legacy rows with null/blank status (same default as the Payments UI KPI).
     *
     * @return list<string>
     */
    private function cashFlowPaymentOutflowStatuses(): array
    {
        return ['completed', 'pending', 'confirmed', 'paid'];
    }

    /**
     * Payments that are settled enough to net against implied purchase-batch cash (exclude pending).
     *
     * @return list<string>
     */
    private function cashFlowPaymentLinkedToBatchStatuses(): array
    {
        return ['completed', 'confirmed', 'paid'];
    }

    /** Same rules as the Payments KPI: known statuses + null/blank (UI defaults null to completed). */
    private function applyPaymentOutflowStatusFilter(Builder $q): Builder
    {
        $statuses = $this->cashFlowPaymentOutflowStatuses();

        return $q->where(function (Builder $w) use ($statuses) {
            $w->whereIn('status', $statuses)
                ->orWhereNull('status')
                ->orWhereRaw("TRIM(COALESCE(status, '')) = ''");
        });
    }

    /** Matches Payments page KPI cards (completed + confirmed; null/blank → completed in UI). */
    private function applyPaymentCompletedForKpiFilter(Builder $q): Builder
    {
        return $q->where(function (Builder $w) {
            $w->whereIn('status', ['completed', 'confirmed'])
                ->orWhereNull('status')
                ->orWhereRaw("TRIM(COALESCE(status, '')) = ''");
        });
    }

    private function applyPaymentLinkedToBatchStatusFilter(Builder $q): Builder
    {
        $statuses = $this->cashFlowPaymentLinkedToBatchStatuses();

        return $q->where(function (Builder $w) use ($statuses) {
            $w->whereIn('status', $statuses)
                ->orWhereNull('status')
                ->orWhereRaw("TRIM(COALESCE(status, '')) = ''");
        });
    }

    private function loadCompletedPaymentsSumByPurchaseBatchId(?int $forUserId = null): array
    {
        $by = [];
        $base = $forUserId === null
            ? Payment::query()
            : Payment::withoutGlobalScopes()->where('user_id', $forUserId);
        $q = $this->applyPaymentLinkedToBatchStatusFilter($base)
            ->whereNotNull('reference_id');
        $rows = $q->get(['reference_type', 'reference_id', 'amount']);

        foreach ($rows as $p) {
            if (! $this->paymentReferencesPurchaseBatch($p->reference_type)) {
                continue;
            }
            $bid = (int) $p->reference_id;
            if ($bid <= 0) {
                continue;
            }
            $by[$bid] = ($by[$bid] ?? 0.0) + (float) $p->amount;
        }

        return $by;
    }

    private function paymentQueryExcludingAutoPurchaseMirror(?int $forUserId = null): Builder
    {
        $q = $forUserId === null
            ? Payment::query()
            : Payment::withoutGlobalScopes()->where('user_id', $forUserId);

        return $q->where(function ($sub) {
            $sub->whereNull('notes')
                ->orWhere('notes', 'not like', '%AUTO_PURCHASE_BATCH:%');
        });
    }

    /**
     * Cash vs non-cash split for payment rows (aligned with receipts/expenses and
     * {@see FinanceAccountLedgerService::resolveDefaultAccountIdForPaymentMethod}: null/blank → cash).
     */
    private function wherePaymentCountsAsCashForCashBankSplit(Builder $q): Builder
    {
        return $q->where(function (Builder $w) {
            $w->whereNull('payment_method')
                ->orWhereRaw("TRIM(COALESCE(payment_method, '')) = ''")
                ->orWhereRaw('LOWER(TRIM(payment_method)) = ?', ['cash']);
        });
    }

    public function overview(): JsonResponse
    {
        try {
            return $this->buildOverviewResponse();
        } catch (Throwable $e) {
            Log::error('finance.cash-flow-overview', [
                'message' => $e->getMessage(),
                'file' => $e->getFile(),
                'line' => $e->getLine(),
            ]);

            return response()->json([
                'message' => config('app.debug') ? $e->getMessage() : __('Cash flow summary could not be computed.'),
            ], 500);
        }
    }

    /**
     * Core cash-flow stats only (no movements, no ledger) — same numbers as overview.stats for treasury widgets.
     */
    public function stats(): JsonResponse
    {
        try {
            $stats = $this->getCoreStats();
            $estimatedBalance = round((float) ($stats['total_receipts'] ?? 0) - (float) ($stats['total_outflow'] ?? 0), 2);

            return response()->json([
                'stats' => array_merge($stats, [
                    'estimated_balance' => $estimatedBalance,
                ]),
            ]);
        } catch (Throwable $e) {
            Log::error('finance.cash-flow-stats', [
                'message' => $e->getMessage(),
                'file' => $e->getFile(),
                'line' => $e->getLine(),
            ]);

            return response()->json([
                'message' => config('app.debug') ? $e->getMessage() : __('Cash flow summary could not be computed.'),
            ], 500);
        }
    }

    /**
     * Core aggregates for the authenticated user (same rules as the cash-flow overview).
     *
     * @return array<string, float>
     */
    public function getCoreStats(): array
    {
        if (! Auth::check()) {
            return $this->getCoreStatsEmptyShape();
        }

        $c = $this->buildCoreCashStats();
        $netCashFlow = $c['total_receipts'] - $c['total_outflow'];

        return [
            'total_capital' => round($c['total_capital'], 2),
            'total_receipts' => round($c['total_receipts'], 2),
            'total_payments' => round($c['total_payments'], 2),
            'total_expenses' => round($c['total_expenses'], 2),
            'total_outflow' => round($c['total_outflow'], 2),
            'net_cash_flow' => round($netCashFlow, 2),
            'purchase_paid_total' => round($c['purchase_paid_total'], 2),
            'bank_in' => round($c['bank_receipts'], 2),
            'bank_out' => round($c['bank_out_total'], 2),
            'cash_in' => round($c['cash_receipts'], 2),
            'cash_out' => round($c['cash_out_total'], 2),
            'purchase_paid_cash' => round($c['purchase_paid_cash'], 2),
            'purchase_paid_non_cash' => round($c['purchase_paid_non_cash'], 2),
        ];
    }

    /**
     * Same aggregates as {@see getCoreStats()} for a specific user (no Auth scope required).
     *
     * @return array<string, float>
     */
    public function getCoreStatsForUser(int $userId): array
    {
        if ($userId <= 0) {
            return $this->getCoreStatsEmptyShape();
        }

        $c = $this->buildCoreCashStatsForUser($userId);
        $netCashFlow = $c['total_receipts'] - $c['total_outflow'];

        return [
            'total_capital' => round($c['total_capital'], 2),
            'total_receipts' => round($c['total_receipts'], 2),
            'total_payments' => round($c['total_payments'], 2),
            'total_expenses' => round($c['total_expenses'], 2),
            'total_outflow' => round($c['total_outflow'], 2),
            'net_cash_flow' => round($netCashFlow, 2),
            'purchase_paid_total' => round($c['purchase_paid_total'], 2),
            'bank_in' => round($c['bank_receipts'], 2),
            'bank_out' => round($c['bank_out_total'], 2),
            'cash_in' => round($c['cash_receipts'], 2),
            'cash_out' => round($c['cash_out_total'], 2),
            'purchase_paid_cash' => round($c['purchase_paid_cash'], 2),
            'purchase_paid_non_cash' => round($c['purchase_paid_non_cash'], 2),
        ];
    }

    /**
     * @return array<string, float>
     */
    private function getCoreStatsEmptyShape(): array
    {
        return [
            'total_capital' => 0.0,
            'total_receipts' => 0.0,
            'total_payments' => 0.0,
            'total_expenses' => 0.0,
            'total_outflow' => 0.0,
            'net_cash_flow' => 0.0,
            'purchase_paid_total' => 0.0,
            'bank_in' => 0.0,
            'bank_out' => 0.0,
            'cash_in' => 0.0,
            'cash_out' => 0.0,
            'purchase_paid_cash' => 0.0,
            'purchase_paid_non_cash' => 0.0,
        ];
    }

    /**
     * @return array{
     *   total_capital: float,
     *   total_receipts: float,
     *   total_payments: float,
     *   total_expenses: float,
     *   total_outflow: float,
     *   purchase_paid_total: float,
     *   purchase_paid_cash: float,
     *   purchase_paid_non_cash: float,
     *   bank_receipts: float,
     *   bank_payments: float,
     *   bank_expenses: float,
     *   bank_out_total: float,
     *   cash_receipts: float,
     *   cash_payments: float,
     *   cash_expenses: float,
     *   cash_out_total: float
     * }
     */
    private function buildCoreCashStats(): array
    {
        if (! Auth::check()) {
            return $this->emptyCoreCashStatsRaw();
        }

        return $this->buildCoreCashStatsForUser((int) Auth::id());
    }

    /**
     * @return array{
     *   total_capital: float,
     *   total_receipts: float,
     *   total_payments: float,
     *   total_expenses: float,
     *   total_outflow: float,
     *   purchase_paid_total: float,
     *   purchase_paid_cash: float,
     *   purchase_paid_non_cash: float,
     *   bank_receipts: float,
     *   bank_payments: float,
     *   bank_expenses: float,
     *   bank_out_total: float,
     *   cash_receipts: float,
     *   cash_payments: float,
     *   cash_expenses: float,
     *   cash_out_total: float
     * }
     */
    private function emptyCoreCashStatsRaw(): array
    {
        return [
            'total_capital' => 0.0,
            'total_receipts' => 0.0,
            'total_payments' => 0.0,
            'total_expenses' => 0.0,
            'total_outflow' => 0.0,
            'purchase_paid_total' => 0.0,
            'purchase_paid_cash' => 0.0,
            'purchase_paid_non_cash' => 0.0,
            'bank_receipts' => 0.0,
            'bank_payments' => 0.0,
            'bank_expenses' => 0.0,
            'bank_out_total' => 0.0,
            'cash_receipts' => 0.0,
            'cash_payments' => 0.0,
            'cash_expenses' => 0.0,
            'cash_out_total' => 0.0,
        ];
    }

    /**
     * @return array{
     *   total_capital: float,
     *   total_receipts: float,
     *   total_payments: float,
     *   total_expenses: float,
     *   total_outflow: float,
     *   purchase_paid_total: float,
     *   purchase_paid_cash: float,
     *   purchase_paid_non_cash: float,
     *   bank_receipts: float,
     *   bank_payments: float,
     *   bank_expenses: float,
     *   bank_out_total: float,
     *   cash_receipts: float,
     *   cash_payments: float,
     *   cash_expenses: float,
     *   cash_out_total: float
     * }
     */
    private function buildCoreCashStatsForUser(int $userId): array
    {
        $totalCapital = (float) (CapitalSource::withoutGlobalScopes()->where('user_id', $userId)->sum('amount') ?? 0);
        $totalReceipts = (float) (Receipt::withoutGlobalScopes()->where('user_id', $userId)->sum('amount') ?? 0);

        // Same rows as Payments screen KPI (all completed/confirmed; incl. AUTO_PURCHASE_BATCH mirrors).
        $paymentsKpiAgg = fn () => $this->applyPaymentCompletedForKpiFilter(
            Payment::withoutGlobalScopes()->where('user_id', $userId)
        );
        $totalPaymentsAll = (float) ($paymentsKpiAgg()->sum('amount') ?? 0);
        $totalPayments = max(0.0, round($totalPaymentsAll, 2));

        $totalExpenses = (float) (Expense::withoutGlobalScopes()->where('user_id', $userId)->sum('amount') ?? 0);

        $bankMethods = ['bank_transfer', 'check', 'online', 'card'];

        $bankReceipts = (float) (Receipt::withoutGlobalScopes()->where('user_id', $userId)->where('payment_method', 'bank_transfer')->sum('amount') ?? 0);
        $cashPaymentsAll = (float) ($this->wherePaymentCountsAsCashForCashBankSplit($paymentsKpiAgg())->sum('amount') ?? 0);
        $bankPayments = max(0.0, round($totalPayments - $cashPaymentsAll, 2));
        $bankExpenses = (float) (Expense::withoutGlobalScopes()->where('user_id', $userId)->whereIn('payment_method', $bankMethods)->sum('amount') ?? 0);

        $cashReceipts = (float) (Receipt::withoutGlobalScopes()->where('user_id', $userId)->where(function ($q) {
            $q->whereNull('payment_method')
                ->orWhere('payment_method', 'cash')
                ->orWhere('payment_method', 'Cash');
        })->sum('amount') ?? 0);
        $cashExpenses = (float) (Expense::withoutGlobalScopes()->where('user_id', $userId)->where(function ($q) {
            $q->whereNull('payment_method')
                ->orWhere('payment_method', 'cash')
                ->orWhere('payment_method', 'Cash');
        })->sum('amount') ?? 0);

        $purchasePaymentsKpi = (float) ($this->wherePaymentReferencesPurchaseBatch($paymentsKpiAgg())->sum('amount') ?? 0);
        $cashPurchasePayments = (float) ($this->wherePaymentCountsAsCashForCashBankSplit(
            $this->wherePaymentReferencesPurchaseBatch($paymentsKpiAgg())
        )->sum('amount') ?? 0);

        // Informational only (not added to total_outflow — already inside total_payments).
        $purchasePaidCash = max(0.0, (float) $cashPurchasePayments);
        $purchasePaidNonCash = max(0.0, round($purchasePaymentsKpi - $cashPurchasePayments, 2));

        $batches = PurchaseBatch::withoutGlobalScopes()
            ->where('user_id', $userId)
            ->where('status', '!=', 'cancelled')
            ->orderByDesc('updated_at')
            ->limit(500)
            ->get(['id', 'invoice_number', 'batch_number', 'notes', 'status', 'grand_total', 'subtotal', 'invoice_date', 'created_at', 'updated_at']);

        $linkedByBatch = $this->loadCompletedPaymentsSumByPurchaseBatchId($userId);

        foreach ($batches as $batch) {
            $invoiceTotal = (float) ($batch->grand_total ?? $batch->subtotal ?? 0);
            $meta = $this->parseBatchPaymentMeta((string) ($batch->notes ?? ''));
            $metaPaid = $this->resolveBatchPaidAmountForCashFlow($batch, $invoiceTotal);
            $linked = (float) ($linkedByBatch[(int) $batch->id] ?? 0.0);
            $implied = max(0.0, min($invoiceTotal, $metaPaid) - $linked);
            if ($implied <= 0.00001) {
                continue;
            }
            $type = $meta['type'] ?: 'credit';
            if ($type === 'cash') {
                $purchasePaidCash += $implied;
            } else {
                $purchasePaidNonCash += $implied;
            }
        }

        $purchasePaidTotal = $purchasePaidCash + $purchasePaidNonCash;
        $cashOutTotal = $cashPaymentsAll + $cashExpenses;
        $bankOutTotal = $bankPayments + $bankExpenses;
        $totalOutflow = $totalPayments + $totalExpenses;

        return [
            'total_capital' => $totalCapital,
            'total_receipts' => $totalReceipts,
            'total_payments' => $totalPayments,
            'total_expenses' => $totalExpenses,
            'total_outflow' => $totalOutflow,
            'purchase_paid_total' => $purchasePaidTotal,
            'purchase_paid_cash' => $purchasePaidCash,
            'purchase_paid_non_cash' => $purchasePaidNonCash,
            'bank_receipts' => $bankReceipts,
            'bank_payments' => $bankPayments,
            'bank_expenses' => $bankExpenses,
            'bank_out_total' => $bankOutTotal,
            'cash_receipts' => $cashReceipts,
            'cash_payments' => $cashPaymentsAll,
            'cash_expenses' => $cashExpenses,
            'cash_out_total' => $cashOutTotal,
        ];
    }

    private function buildOverviewResponse(): JsonResponse
    {
        $stats = $this->getCoreStats();
        $estimatedBalance = round((float) ($stats['total_receipts'] ?? 0) - (float) ($stats['total_outflow'] ?? 0), 2);

        try {
            $movements = $this->buildRecentMovements();
        } catch (Throwable $e) {
            Log::warning('finance.cash-flow-overview.movements_failed', [
                'message' => $e->getMessage(),
                'file' => $e->getFile(),
                'line' => $e->getLine(),
            ]);
            $movements = [];
        }

        $ledgerAccounts = [];
        if (Auth::check()) {
            $ledger = app(FinanceAccountLedgerService::class);
            $ledger->runForCurrentRequest();
            $ledgerAccounts = $ledger->ledgerBalancesForUser((int) Auth::id());
        }

        return response()->json([
            'stats' => array_merge($stats, [
                'estimated_balance' => $estimatedBalance,
            ]),
            'movements' => $movements,
            'ledger_accounts' => $ledgerAccounts,
            'ledger_excludes_implicit_purchase_settlements' => true,
        ]);
    }

    /**
     * @return list<array{id: string|int, date: string, type: string, description: string, method: string, amount: float, reference: string|null}>
     */
    private function buildRecentMovements(): array
    {
        $all = [];

        $receipts = Receipt::query()->orderByDesc('receipt_date')->orderByDesc('id')->limit(40)->get();
        foreach ($receipts as $r) {
            $all[] = [
                'id' => $r->id,
                'date' => $this->rowDate('receipt_date', $r) ?: $this->rowDate('created_at', $r),
                'type' => 'receipt',
                'description' => $r->payer_name ?: $r->description ?: 'Receipt',
                'method' => $r->payment_method ?: 'cash',
                'amount' => (float) $r->amount,
                'reference' => $r->receipt_number,
                'finance_account_id' => $r->finance_account_id !== null ? (int) $r->finance_account_id : null,
            ];
        }

        $payments = $this->applyPaymentOutflowStatusFilter(
            $this->paymentQueryExcludingAutoPurchaseMirror()
        )->orderByDesc('payment_date')->orderByDesc('id')->limit(40)->get();
        foreach ($payments as $p) {
            $all[] = [
                'id' => $p->id,
                'date' => $this->rowDate('payment_date', $p) ?: $this->rowDate('created_at', $p),
                'type' => 'payment',
                'description' => $p->description ?: $p->payee_name ?: 'Payment',
                'method' => $p->payment_method ?: 'cash',
                'amount' => -(float) $p->amount,
                'reference' => $p->payment_number,
                'finance_account_id' => $p->finance_account_id !== null ? (int) $p->finance_account_id : null,
            ];
        }

        $expenses = Expense::query()->orderByDesc('expense_date')->orderByDesc('id')->limit(40)->get();
        foreach ($expenses as $e) {
            $cat = $e->getAttribute('category');
            $all[] = [
                'id' => $e->id,
                'date' => $this->rowDate('expense_date', $e) ?: $this->rowDate('created_at', $e),
                'type' => 'expense',
                'description' => trim(($cat ? $cat.': ' : '').($e->description ?: $e->vendor_name ?: 'Expense')),
                'method' => $e->payment_method ?: 'cash',
                'amount' => -(float) $e->amount,
                'reference' => $e->expense_number,
                'finance_account_id' => $e->finance_account_id !== null ? (int) $e->finance_account_id : null,
            ];
        }

        $batches = PurchaseBatch::query()
            ->where('status', '!=', 'cancelled')
            ->orderByDesc('updated_at')
            ->limit(80)
            ->get(['id', 'invoice_number', 'batch_number', 'notes', 'status', 'grand_total', 'subtotal', 'invoice_date', 'created_at']);

        $linkedByBatch = $this->loadCompletedPaymentsSumByPurchaseBatchId();

        foreach ($batches as $batch) {
            $invoiceTotal = (float) ($batch->grand_total ?? $batch->subtotal ?? 0);
            $meta = $this->parseBatchPaymentMeta((string) ($batch->notes ?? ''));
            $metaPaid = $this->resolveBatchPaidAmountForCashFlow($batch, $invoiceTotal);
            $linked = (float) ($linkedByBatch[(int) $batch->id] ?? 0.0);
            $implied = max(0.0, min($invoiceTotal, $metaPaid) - $linked);
            if ($implied <= 0.00001) {
                continue;
            }
            $payType = $meta['type'] ?: 'credit';
            $method = $payType === 'cash' ? 'cash' : 'bank_transfer';
            $ref = $batch->invoice_number ?: $batch->batch_number;
            $all[] = [
                'id' => 'purchase-batch-'.$batch->id,
                'date' => $this->rowDate('invoice_date', $batch) ?: $this->rowDate('created_at', $batch),
                'type' => 'purchase_paid',
                'description' => '',
                'method' => $method,
                'amount' => -$implied,
                'reference' => $ref,
                'finance_account_id' => null,
            ];
        }

        usort($all, function ($a, $b) {
            return strcmp((string) ($b['date'] ?? ''), (string) ($a['date'] ?? ''));
        });

        return array_slice($all, 0, 50);
    }
}
