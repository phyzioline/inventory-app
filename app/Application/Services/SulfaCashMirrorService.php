<?php

declare(strict_types=1);

namespace App\Application\Services;

use Illuminate\Support\Facades\DB;
use App\Domain\Models\Wms\Expense;
use App\Domain\Models\Wms\Receipt;
use App\Domain\Models\Wms\TreasurySulfa;

/**
 * Mirrors sulfa borrow/repay into inv_receipts / inv_expenses so cash-flow & receipts list match the treasury.
 */
class SulfaCashMirrorService
{
    public function syncBorrowReceipt(TreasurySulfa $sulfa): Receipt
    {
        return DB::transaction(function () use ($sulfa) {
            $uid = (int) $sulfa->user_id;
            $ledger = app(FinanceAccountLedgerService::class);
            $ledger->ensureDefaultAccountsForUser($uid);
            $financeAccountId = $ledger->resolveFinanceAccountId(null, 'cash', $uid);

            $receipt = Receipt::query()
                ->where('user_id', $uid)
                ->where('reference_type', TreasurySulfa::class)
                ->where('reference_id', $sulfa->id)
                ->first();

            $attrs = [
                'type' => 'Sulfa financing',
                'category' => 'sulfa',
                'amount' => (float) $sulfa->principal_amount,
                'description' => 'سُلفة — '.($sulfa->lender_name ?? ''),
                'receipt_date' => $sulfa->borrowed_on?->toDateString() ?? now()->toDateString(),
                'payment_method' => 'cash',
                'finance_account_id' => $financeAccountId,
                'payer_name' => (string) ($sulfa->lender_name ?? ''),
                'user_id' => $uid,
                'reference_type' => TreasurySulfa::class,
                'reference_id' => $sulfa->id,
            ];

            if (! $receipt) {
                $attrs['receipt_number'] = $this->generateNextReceiptNumber();
                $receipt = Receipt::create($attrs);
            } else {
                $receipt->update($attrs);
            }

            return $receipt->fresh();
        });
    }

    public function createRepayExpense(TreasurySulfa $sulfa, float $pay, string $paidOn, ?string $memo): Expense
    {
        return DB::transaction(function () use ($sulfa, $pay, $paidOn, $memo) {
            $uid = (int) $sulfa->user_id;
            $ledger = app(FinanceAccountLedgerService::class);
            $ledger->ensureDefaultAccountsForUser($uid);
            $financeAccountId = $ledger->resolveFinanceAccountId(null, 'cash', $uid);

            return Expense::create([
                'expense_number' => $this->generateNextSulfaRepayExpenseNumber(),
                'type' => 'sulfa_repayment',
                'category' => 'sulfa_repayment',
                'amount' => round($pay, 2),
                'description' => $memo ?: ('سداد سُلفة — '.($sulfa->lender_name ?? '')),
                'expense_date' => $paidOn,
                'reference_type' => TreasurySulfa::class,
                'reference_id' => $sulfa->id,
                'user_id' => $uid,
                'payment_method' => 'cash',
                'finance_account_id' => $financeAccountId,
                'vendor_name' => (string) ($sulfa->lender_name ?? ''),
            ]);
        });
    }

    private function generateNextReceiptNumber(): string
    {
        $prefix = 'REC-';
        $last = (string) Receipt::whereNotNull('receipt_number')
            ->where('receipt_number', 'like', $prefix.'%')
            ->orderByDesc('id')
            ->value('receipt_number');

        $lastNum = (int) preg_replace('/\D+/', '', $last ?: '');
        $next = $lastNum + 1;
        $candidate = $prefix.str_pad((string) $next, 3, '0', STR_PAD_LEFT);

        while (Receipt::where('receipt_number', $candidate)->exists()) {
            $next++;
            $candidate = $prefix.str_pad((string) $next, 3, '0', STR_PAD_LEFT);
        }

        return $candidate;
    }

    private function generateNextSulfaRepayExpenseNumber(): string
    {
        $prefix = 'EXP-SUL-';
        $last = (string) Expense::whereNotNull('expense_number')
            ->where('expense_number', 'like', $prefix.'%')
            ->orderByDesc('id')
            ->value('expense_number');

        $lastNum = (int) preg_replace('/\D+/', '', $last ?: '');
        $next = $lastNum + 1;
        $candidate = $prefix.str_pad((string) $next, 4, '0', STR_PAD_LEFT);

        while (Expense::where('expense_number', $candidate)->exists()) {
            $next++;
            $candidate = $prefix.str_pad((string) $next, 4, '0', STR_PAD_LEFT);
        }

        return $candidate;
    }
}
