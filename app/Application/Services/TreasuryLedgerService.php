<?php

namespace App\Application\Services;

use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use App\Domain\Models\Wms\TreasuryAccount;
use App\Domain\Models\Wms\TreasuryCashTransaction;

class TreasuryLedgerService
{
    public const TX_SULFA_BORROW = 'sulfa_borrow';

    public const TX_SULFA_REPAY = 'sulfa_repay';

    public function getOrCreateDefaultTreasuryAccount(?int $userId = null): TreasuryAccount
    {
        $uid = $userId ?? (int) Auth::id();
        $existing = TreasuryAccount::where('user_id', $uid)->where('is_default', true)->first();
        if ($existing) {
            return $existing;
        }

        return DB::transaction(function () use ($uid) {
            TreasuryAccount::where('user_id', $uid)->update(['is_default' => false]);

            return TreasuryAccount::create([
                'user_id' => $uid,
                'name' => 'Main cashbox',
                'currency' => 'EGP',
                'is_default' => true,
            ]);
        });
    }

    /**
     * @param  'in'|'out'  $direction
     */
    public function record(
        int $treasuryAccountId,
        string $direction,
        float $amount,
        string $txType,
        string $occurredOn,
        ?int $sulfaId = null,
        ?string $referenceType = null,
        ?int $referenceId = null,
        ?string $memo = null,
        ?int $userId = null,
    ): TreasuryCashTransaction {
        if (! in_array($direction, ['in', 'out'], true)) {
            throw new \InvalidArgumentException('direction must be in|out');
        }
        if ($amount <= 0.00001) {
            throw new \InvalidArgumentException('amount must be positive');
        }
        $uid = $userId ?? (int) Auth::id();

        return TreasuryCashTransaction::create([
            'user_id' => $uid,
            'treasury_account_id' => $treasuryAccountId,
            'direction' => $direction,
            'amount' => round($amount, 2),
            'tx_type' => $txType,
            'reference_type' => $referenceType,
            'reference_id' => $referenceId,
            'sulfa_id' => $sulfaId,
            'memo' => $memo,
            'occurred_on' => $occurredOn,
        ]);
    }

    public function ledgerBalance(int $treasuryAccountId, ?int $userId = null): float
    {
        $uid = $userId ?? (int) Auth::id();
        $in = (float) TreasuryCashTransaction::where('user_id', $uid)
            ->where('treasury_account_id', $treasuryAccountId)
            ->where('direction', 'in')
            ->sum('amount');
        $out = (float) TreasuryCashTransaction::where('user_id', $uid)
            ->where('treasury_account_id', $treasuryAccountId)
            ->where('direction', 'out')
            ->sum('amount');

        return round($in - $out, 2);
    }
}
