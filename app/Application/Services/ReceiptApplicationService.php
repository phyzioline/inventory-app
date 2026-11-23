<?php

declare(strict_types=1);

namespace App\Application\Services;

use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\Receipt;
use App\Domain\Models\Wms\Settlement;
use App\Infrastructure\Support\InventoryMorphTypes;

class ReceiptApplicationService
{
    /**
     * @param  array<string, mixed>  $input  Validated request fields including link keys
     */
    public function create(array $input): Receipt
    {
        return DB::transaction(function () use ($input) {
            $orderId = isset($input['linked_inventory_order_id']) ? (int) $input['linked_inventory_order_id'] : null;
            if ($orderId <= 0) {
                $orderId = null;
            }

            $settlementId = isset($input['linked_settlement_id']) ? (int) $input['linked_settlement_id'] : null;
            if ($settlementId <= 0) {
                $settlementId = null;
            }

            $reportId = isset($input['linked_settlement_report_id']) ? trim((string) $input['linked_settlement_report_id']) : '';

            if ($orderId && ($settlementId || $reportId !== '')) {
                throw ValidationException::withMessages([
                    'linked_inventory_order_id' => ['A receipt cannot be linked to both an order and a settlement.'],
                ]);
            }

            if ($reportId !== '') {
                if ($settlementId) {
                    throw ValidationException::withMessages([
                        'linked_settlement_id' => ['Use either settlement id or settlement report id, not both.'],
                    ]);
                }
                $settlement = Settlement::query()->where('report_id', $reportId)->first();
                if (! $settlement) {
                    throw ValidationException::withMessages([
                        'linked_settlement_report_id' => ['No settlement found with this report id.'],
                    ]);
                }
                $settlementId = (int) $settlement->id;
            }

            if ($settlementId && Receipt::query()
                ->whereIn('reference_type', InventoryMorphTypes::settlementReferenceTypes())
                ->where('reference_id', $settlementId)
                ->exists()) {
                throw ValidationException::withMessages([
                    'linked_settlement_id' => ['A receipt is already linked to this settlement (usually created automatically when uploading the payment sheet). Duplicate blocked.'],
                ]);
            }

            $category = (string) ($input['category'] ?? 'general');
            $type = $this->mapCategoryToType($category);

            $referenceType = null;
            $referenceId = null;
            if ($orderId) {
                $referenceType = InventoryOrder::class;
                $referenceId = $orderId;
            } elseif ($settlementId) {
                $referenceType = Settlement::class;
                $referenceId = $settlementId;
            }

            $amount = (float) $input['amount'];
            $applyToOrder = (bool) ($input['apply_payment_to_order'] ?? true);

            if ($orderId && $applyToOrder) {
                $this->applyAmountToInventoryOrder($orderId, $amount);
            }

            $userId = (int) ($input['user_id'] ?? Auth::id() ?? 0);
            $ledger = app(FinanceAccountLedgerService::class);
            $ledger->ensureDefaultAccountsForUser($userId);
            $financeAccountId = $ledger->resolveFinanceAccountId(
                isset($input['finance_account_id']) ? (int) $input['finance_account_id'] : null,
                isset($input['payment_method']) ? (string) $input['payment_method'] : null,
                $userId
            );

            return Receipt::create([
                'receipt_number' => $input['receipt_number'] ?? null,
                'type' => $type,
                'category' => $category,
                'amount' => $amount,
                'description' => $input['description'] ?? null,
                'receipt_date' => $input['receipt_date'],
                'payment_method' => $input['payment_method'] ?? null,
                'finance_account_id' => $financeAccountId,
                'reference_type' => $referenceType,
                'reference_id' => $referenceId,
                'external_reference' => $input['external_reference'] ?? null,
                'warehouse_id' => $input['warehouse_id'] ?? null,
                'payer_name' => $input['payer_name'] ?? null,
                'user_id' => $input['user_id'] ?? null,
            ]);
        });
    }

    public function generateNextReceiptNumber(): string
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

    private function mapCategoryToType(string $category): string
    {
        return match ($category) {
            'customer_collection' => 'Customer Payment',
            'channel_collection' => 'Channel Collection',
            'compensation' => 'Compensation',
            'capital' => 'Capital Injection',
            'sulfa' => 'Sulfa financing',
            default => 'Other',
        };
    }

    private function applyAmountToInventoryOrder(int $orderId, float $amount): void
    {
        if ($amount <= 0) {
            return;
        }

        $order = InventoryOrder::query()->whereKey($orderId)->firstOrFail();

        $total = (float) $order->total_amount;
        if ($total <= 0) {
            throw ValidationException::withMessages([
                'amount' => ['This order has no billable total.'],
            ]);
        }

        $paid = (float) ($order->paid_amount ?? 0);
        $remaining = max(0.0, round($total - $paid, 2));

        if (round($amount, 2) - $remaining > 0.000001) {
            throw ValidationException::withMessages([
                'amount' => ['Receipt amount exceeds the order remaining balance.'],
            ]);
        }

        $newPaid = round($paid + $amount, 2);
        $newRemaining = round(max(0.0, $total - $newPaid), 2);

        $order->paid_amount = $newPaid;
        $order->remaining_amount = $newRemaining;

        if ($newRemaining <= 0.0001) {
            $order->financial_status = 'charged';
            $order->settlement_status = 'settled';
            $status = (string) ($order->status ?? '');
            if ($status === 'pending' || $status === 'processing') {
                $order->status = 'sold';
            }
        } else {
            $order->financial_status = 'pending';
            $order->settlement_status = 'pending';
        }

        $order->save();
    }

    /**
     * The one auto receipt of a payment sheet: the sheet's transfer total, matched by morph so a
     * pre-linked manual receipt is upgraded instead of duplicated.
     */
    public function upsertForSettlement(Settlement $settlement): void
    {
        $settlement = $settlement->fresh() ?? $settlement;

        $amount = (float) ($settlement->total_amount ?? 0);
        if ($amount <= 0) {
            return;
        }

        $settlement->loadMissing('channel');
        $channelName = (string) ($settlement->channel->name ?? 'Channel');
        $reportId = (string) ($settlement->report_id ?? ('SET-'.$settlement->id));
        $date = $settlement->end_date ?: $settlement->start_date ?: now();
        $warehouseId = InventoryLocation::query()
            ->where('channel_id', (int) $settlement->channel_id)
            ->value('id');

        $payload = [
            'type' => 'settlement',
            'category' => 'channel_collection',
            'amount' => $amount,
            'description' => "Auto receipt from payment sheet settlement #{$reportId}",
            'receipt_date' => $date,
            'payment_method' => 'bank_transfer',
            'payer_name' => $channelName,
            'external_reference' => $reportId,
            'warehouse_id' => $warehouseId,
            'user_id' => $settlement->user_id ?: Auth::id(),
            'receipt_number' => 'SET-'.$settlement->id,
        ];

        // Match by morph only so a pre-linked manual receipt is upgraded instead of duplicating rows.
        // Receipts migrated from the monolith carry the legacy class name: matching only the current
        // one booked a second receipt on re-upload (5 sheets, 91.6k EGP, 2026-08-06).
        $existing = Receipt::withoutGlobalScopes()
            ->whereIn('reference_type', InventoryMorphTypes::settlementReferenceTypes())
            ->where('reference_id', $settlement->id)
            ->orderBy('id')
            ->first();

        $payload['reference_type'] = Settlement::class;
        $payload['reference_id'] = $settlement->id;

        if ($existing) {
            $existing->update($payload);
        } else {
            Receipt::create($payload);
        }
    }
}
