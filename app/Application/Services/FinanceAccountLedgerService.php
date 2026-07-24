<?php

declare(strict_types=1);

namespace App\Application\Services;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use App\Domain\Models\Wms\Expense;
use App\Domain\Models\Wms\FinanceAccount;
use App\Domain\Models\Wms\Payment;
use App\Domain\Models\Wms\Receipt;

/**
 * Default cash/bank accounts per user and computed book-style balances from linked rows.
 * Purchase-batch implied settlements remain in aggregate cash-flow only until modeled per account.
 */
class FinanceAccountLedgerService
{
    /** @var list<string> */
    public const BANK_PAYMENT_METHODS = ['bank_transfer', 'check', 'online', 'card'];

    public function ensureDefaultAccountsForUser(int $userId): void
    {
        $count = FinanceAccount::withoutGlobalScopes()
            ->where('user_id', $userId)
            ->count();
        if ($count > 0) {
            return;
        }

        $now = now();
        DB::table('inv_finance_accounts')->insert([
            [
                'user_id' => $userId,
                'name' => 'Cash',
                'account_type' => 'cash',
                'opening_balance' => 0,
                'currency' => 'EGP',
                'sort_order' => 0,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'user_id' => $userId,
                'name' => 'Bank',
                'account_type' => 'bank',
                'opening_balance' => 0,
                'currency' => 'EGP',
                'sort_order' => 10,
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ]);
    }

    public function defaultCashAccountId(int $userId): ?int
    {
        return FinanceAccount::withoutGlobalScopes()
            ->where('user_id', $userId)
            ->where('account_type', 'cash')
            ->orderBy('sort_order')
            ->orderBy('id')
            ->value('id');
    }

    public function defaultBankAccountId(int $userId): ?int
    {
        return FinanceAccount::withoutGlobalScopes()
            ->where('user_id', $userId)
            ->where('account_type', 'bank')
            ->orderBy('sort_order')
            ->orderBy('id')
            ->value('id');
    }

    public function defaultWalletAccountId(int $userId): ?int
    {
        $w = FinanceAccount::withoutGlobalScopes()
            ->where('user_id', $userId)
            ->where('account_type', 'wallet')
            ->orderBy('sort_order')
            ->orderBy('id')
            ->value('id');

        return $w ?: $this->defaultBankAccountId($userId);
    }

    /**
     * Map payment_method string to default finance account for the user.
     */
    public function resolveDefaultAccountIdForPaymentMethod(int $userId, ?string $paymentMethod): ?int
    {
        $this->ensureDefaultAccountsForUser($userId);
        $m = strtolower(trim((string) ($paymentMethod ?? '')));

        if ($m === '' || $m === 'cash') {
            return $this->defaultCashAccountId($userId);
        }

        if (in_array($m, self::BANK_PAYMENT_METHODS, true)) {
            return $this->defaultBankAccountId($userId);
        }

        return $this->defaultWalletAccountId($userId);
    }

    /**
     * Validate optional explicit account id belongs to user; otherwise return null.
     */
    public function validateAccountIdForUser(?int $accountId, int $userId): ?int
    {
        if ($accountId === null || $accountId <= 0) {
            return null;
        }

        $ok = FinanceAccount::withoutGlobalScopes()
            ->where('user_id', $userId)
            ->whereKey($accountId)
            ->exists();

        return $ok ? $accountId : null;
    }

    /**
     * Resolve final finance_account_id: explicit if valid, else from payment_method.
     */
    public function resolveFinanceAccountId(?int $requestedAccountId, ?string $paymentMethod, int $userId): ?int
    {
        $explicit = $this->validateAccountIdForUser($requestedAccountId, $userId);
        if ($explicit !== null) {
            return $explicit;
        }

        return $this->resolveDefaultAccountIdForPaymentMethod($userId, $paymentMethod);
    }

    /**
     * Base query for payment outflows linked to accounts — same status rules as {@see CashFlowSummaryController} aggregates.
     */
    public function paymentOutflowBase(int $userId): Builder
    {
        return Payment::withoutGlobalScopes()
            ->where('user_id', $userId)
            ->where(function ($w) {
                $w->whereIn('status', ['completed', 'pending', 'confirmed', 'paid'])
                    ->orWhereNull('status')
                    ->orWhereRaw("TRIM(COALESCE(status, '')) = ''");
            })
            ->where(function ($q) {
                $q->whereNull('notes')
                    ->orWhere('notes', 'not like', '%AUTO_PURCHASE_BATCH:%');
            });
    }

    public function backfillMissingAccountLinks(int $userId): void
    {
        $this->ensureDefaultAccountsForUser($userId);
        if ($this->defaultCashAccountId($userId) === null || $this->defaultBankAccountId($userId) === null) {
            return;
        }

        Receipt::withoutGlobalScopes()
            ->where('user_id', $userId)
            ->whereNull('finance_account_id')
            ->orderBy('id')
            ->each(function (Receipt $r) use ($userId) {
                $id = $this->resolveDefaultAccountIdForPaymentMethod($userId, $r->payment_method);
                if ($id !== null) {
                    $r->finance_account_id = $id;
                    $r->saveQuietly();
                }
            });

        $this->paymentOutflowBase($userId)
            ->whereNull('finance_account_id')
            ->orderBy('id')
            ->each(function (Payment $p) use ($userId) {
                $id = $this->resolveDefaultAccountIdForPaymentMethod($userId, $p->payment_method);
                if ($id !== null) {
                    $p->finance_account_id = $id;
                    $p->saveQuietly();
                }
            });

        Expense::withoutGlobalScopes()
            ->where('user_id', $userId)
            ->whereNull('finance_account_id')
            ->orderBy('id')
            ->each(function (Expense $e) use ($userId) {
                $id = $this->resolveDefaultAccountIdForPaymentMethod($userId, $e->payment_method);
                if ($id !== null) {
                    $e->finance_account_id = $id;
                    $e->saveQuietly();
                }
            });
    }

    /**
     * @return list<array{id: int, name: string, account_type: string, opening_balance: float, receipts_in: float, payments_out: float, expenses_out: float, computed_balance: float}>
     */
    public function ledgerBalancesForUser(int $userId): array
    {
        $this->ensureDefaultAccountsForUser($userId);
        $this->backfillMissingAccountLinks($userId);

        $accounts = FinanceAccount::withoutGlobalScopes()
            ->where('user_id', $userId)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();

        $out = [];
        foreach ($accounts as $acc) {
            $id = (int) $acc->id;
            $receiptsIn = (float) (Receipt::withoutGlobalScopes()->where('user_id', $userId)->where('finance_account_id', $id)->sum('amount') ?? 0);
            $paymentsOut = (float) ($this->paymentOutflowBase($userId)->where('finance_account_id', $id)->sum('amount') ?? 0);
            $expensesOut = (float) (Expense::withoutGlobalScopes()->where('user_id', $userId)->where('finance_account_id', $id)->sum('amount') ?? 0);
            $opening = (float) ($acc->opening_balance ?? 0);
            $computed = round($opening + $receiptsIn - $paymentsOut - $expensesOut, 2);

            $out[] = [
                'id' => $id,
                'name' => (string) $acc->name,
                'account_type' => (string) $acc->account_type,
                'opening_balance' => round($opening, 2),
                'receipts_in' => round($receiptsIn, 2),
                'payments_out' => round($paymentsOut, 2),
                'expenses_out' => round($expensesOut, 2),
                'computed_balance' => $computed,
            ];
        }

        return $out;
    }

    public function runForCurrentRequest(): void
    {
        if (! Auth::check()) {
            return;
        }
        $uid = (int) Auth::id();
        $this->ensureDefaultAccountsForUser($uid);
        $this->backfillMissingAccountLinks($uid);
    }
}
