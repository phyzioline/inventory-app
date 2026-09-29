<?php

namespace App\Application\Services;

/**
 * Unified settlement line taxonomy for payment sheets (Amazon XML, Noon/Jumia CSV, …).
 * Sign alone never decides refund vs fee — negative commission is still a fee.
 */
class SettlementLineClassifier
{
    public const ORDER_PRINCIPAL = 'order_principal';

    public const ORDER_SHIPPING = 'order_shipping';

    public const PLATFORM_FEE = 'platform_fee';

    public const SHIPPING_FEE = 'shipping_fee';

    public const PROMOTION = 'promotion';

    public const REFUND_PRINCIPAL = 'refund_principal';

    public const REFUND_FEE = 'refund_fee';

    public const ADVERTISING = 'advertising';

    public const DISBURSAL = 'disbursal';

    public const WITHHOLDING = 'withholding';

    public const OTHER = 'other';

    /**
     * @param  array{transaction_type?: string, description?: string, transaction_status?: string, amount?: float|int|string|null, fee_amount?: float|int|string|null, raw_data?: array|null}  $line
     */
    public function classify(array $line): string
    {
        $type = strtolower(trim((string) ($line['transaction_type'] ?? '')));
        $desc = strtolower(trim((string) ($line['description'] ?? '')));
        $status = strtolower(trim((string) ($line['transaction_status'] ?? 'released')));
        $raw = is_array($line['raw_data'] ?? null) ? $line['raw_data'] : [];
        $source = strtolower(trim((string) ($raw['source'] ?? '')));

        if (in_array($status, ['deferred', 'pending', 'reversed'], true)) {
            return self::WITHHOLDING;
        }

        if ($type === 'advertising' || str_starts_with($desc, 'advertising:') || $source === 'advertising') {
            return self::ADVERTISING;
        }

        if (
            str_contains($type, 'payment disbursal')
            || str_contains($type, 'balance_transfer')
            || str_contains($type, 'balance transfer')
            || $type === 'payment'
            || str_contains($desc, 'payment disbursal')
        ) {
            return self::DISBURSAL;
        }

        if (str_starts_with($desc, 'refundprice:') || str_starts_with($desc, 'refund price:')) {
            return self::REFUND_PRINCIPAL;
        }
        if (
            str_starts_with($desc, 'refundfee:')
            || str_starts_with($desc, 'refund fee:')
            || str_starts_with($desc, 'refundpromotion:')
        ) {
            return self::REFUND_FEE;
        }

        if (
            str_contains($type, 'refund')
            || str_contains($type, 'return')
            || str_contains($desc, 'refundprice')
            || str_contains($desc, 'refund principal')
            || (str_contains($desc, 'refund') && ! str_contains($desc, 'itemfee'))
            || str_contains($desc, 'استرداد')
            || str_contains($desc, 'مرتجع')
            || str_contains($desc, 'استرجاع')
        ) {
            if (str_contains($desc, 'fee') || str_contains($desc, 'commission') || str_contains($desc, 'promotion')) {
                return self::REFUND_FEE;
            }

            return self::REFUND_PRINCIPAL;
        }

        if (str_starts_with($desc, 'promotion:') || str_contains($desc, 'coupon')) {
            return self::PROMOTION;
        }

        if (
            str_contains($desc, 'shippinghb')
            || str_contains($desc, 'shippingchargeback')
            || str_contains($desc, 'itemfee: shipping')
            || str_contains($desc, 'shipping fee')
            || ($type === 'shipping fee' || str_contains($type, 'shipping fee'))
        ) {
            return self::SHIPPING_FEE;
        }

        if (str_starts_with($desc, 'itemfee:') || str_contains($desc, 'commission') || str_contains($desc, 'fba')) {
            return self::PLATFORM_FEE;
        }

        if (str_starts_with($desc, 'itemprice:')) {
            if (str_contains($desc, 'shipping')) {
                return self::ORDER_SHIPPING;
            }

            return self::ORDER_PRINCIPAL;
        }

        if (
            str_contains($type, 'othertransaction')
            || str_contains($type, 'storage fee')
            || str_contains($type, 'commission')
            || str_contains($type, 'adjustment')
            || str_contains($desc, 'fee')
        ) {
            return self::PLATFORM_FEE;
        }

        if (str_contains($type, 'order') || $type === '') {
            $amount = (float) ($line['amount'] ?? 0);
            if ($amount > 0) {
                return self::ORDER_PRINCIPAL;
            }
        }

        return self::OTHER;
    }

    /**
     * Summary KPI bucket for a classified line.
     *
     * @return 'pending'|'revenue'|'refund'|'shipping_fee'|'platform_fee'|'advertising'|'disbursal'|'other'
     */
    public function summaryBucket(string $lineKind): string
    {
        return match ($lineKind) {
            self::WITHHOLDING => 'pending',
            self::ORDER_PRINCIPAL, self::ORDER_SHIPPING => 'revenue',
            self::REFUND_PRINCIPAL, self::REFUND_FEE => 'refund',
            self::SHIPPING_FEE => 'shipping_fee',
            self::PLATFORM_FEE, self::PROMOTION => 'platform_fee',
            self::ADVERTISING => 'advertising',
            self::DISBURSAL => 'disbursal',
            default => 'other',
        };
    }
}
