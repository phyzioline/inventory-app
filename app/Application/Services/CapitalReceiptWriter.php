<?php

declare(strict_types=1);

namespace App\Application\Services;

use Illuminate\Support\Facades\DB;
use App\Domain\Models\Wms\CapitalSource;
use App\Domain\Models\Wms\Receipt;

/**
 * Keeps capital sources aligned with cash receipts so treasury (receipts − outflow) closes.
 */
class CapitalReceiptWriter
{
    public function syncFromSource(CapitalSource $source, ?string $receiptDate = null): Receipt
    {
        return DB::transaction(function () use ($source, $receiptDate) {
            $uid = (int) $source->user_id;
            $ledger = app(FinanceAccountLedgerService::class);
            $ledger->ensureDefaultAccountsForUser($uid);
            $financeAccountId = $ledger->resolveFinanceAccountId(null, 'cash', $uid);

            $receipt = Receipt::query()
                ->where('user_id', $uid)
                ->where('reference_type', CapitalSource::class)
                ->where('reference_id', $source->id)
                ->first();

            $attrs = [
                'type' => 'Capital Injection',
                'category' => 'capital',
                'amount' => (float) $source->amount,
                'description' => 'رأس مال — '.$source->name,
                'receipt_date' => $receiptDate ?: now()->toDateString(),
                'payment_method' => 'cash',
                'finance_account_id' => $financeAccountId,
                'payer_name' => $source->name,
                'user_id' => $uid,
                'reference_type' => CapitalSource::class,
                'reference_id' => $source->id,
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

    public function deleteForSource(CapitalSource $source): void
    {
        Receipt::query()
            ->where('user_id', $source->user_id)
            ->where('reference_type', CapitalSource::class)
            ->where('reference_id', $source->id)
            ->delete();
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
}
