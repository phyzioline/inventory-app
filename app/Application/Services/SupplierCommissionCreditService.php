<?php

declare(strict_types=1);

namespace App\Application\Services;

use App\Domain\Models\Wms\Supplier;
use App\Domain\Models\Wms\SupplierAccountCredit;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Non-cash supplier credit (commission / price difference) that reduces accounts payable
 * without stock movement and without treasury cash flow.
 */
class SupplierCommissionCreditService
{
    /**
     * @param  array{amount: float|int|string, reason?: string, notes?: ?string, credit_date?: ?string, reference?: ?string}  $input
     */
    public function post(Supplier $supplier, array $input): SupplierAccountCredit
    {
        $amount = round((float) ($input['amount'] ?? 0), 2);
        if ($amount < 0.01) {
            throw ValidationException::withMessages([
                'amount' => ['Amount must be at least 0.01.'],
            ]);
        }

        $reason = (string) ($input['reason'] ?? SupplierAccountCredit::REASON_COMMISSION);
        if (! in_array($reason, [
            SupplierAccountCredit::REASON_COMMISSION,
            SupplierAccountCredit::REASON_PRICE_DIFFERENCE,
            SupplierAccountCredit::REASON_OTHER,
        ], true)) {
            throw ValidationException::withMessages([
                'reason' => ['Invalid credit reason.'],
            ]);
        }

        $date = (string) ($input['credit_date'] ?? now()->toDateString());
        $notes = isset($input['notes']) ? trim((string) $input['notes']) : null;
        if ($notes === '') {
            $notes = null;
        }

        return DB::transaction(function () use ($supplier, $amount, $reason, $date, $notes, $input) {
            $credit = SupplierAccountCredit::query()->create([
                'user_id' => Auth::id(),
                'supplier_id' => $supplier->id,
                'amount' => $amount,
                'credit_date' => $date,
                'reason' => $reason,
                'notes' => $notes,
                'reference' => isset($input['reference']) ? trim((string) $input['reference']) : null,
            ]);

            // Keep legacy supplier.balance in sync for screens that still fall back to it.
            $supplier->balance = round((float) ($supplier->balance ?? 0) - $amount, 2);
            $supplier->save();

            $linkedVendor = $supplier->resolveLinkedVendor();
            if ($linkedVendor) {
                $linkedVendor->updateBalance($amount, 'subtract');
            }

            app(InventoryAuditLogService::class)->record(
                'supplier.commission_credit',
                Supplier::class,
                (int) $supplier->id,
                [
                    'credit_id' => $credit->id,
                    'amount' => $amount,
                    'reason' => $reason,
                    'credit_date' => $date,
                    'notes' => $notes,
                ],
            );

            return $credit;
        });
    }
}
