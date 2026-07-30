<?php

namespace App\Infrastructure\External;

/**
 * Paymob transaction-processed callback HMAC (sha512).
 * Field order must match Paymob docs — fails closed when secret/hmac missing.
 */
final class PaymobHmacVerifier
{
    public const HMAC_FIELDS = [
        'amount_cents', 'created_at', 'currency', 'error_occured',
        'has_parent_transaction', 'id', 'integration_id', 'is_3d_secure',
        'is_auth', 'is_capture', 'is_refunded', 'is_standalone_payment',
        'is_voided', 'order.id', 'owner', 'pending',
        'source_data.pan', 'source_data.sub_type', 'source_data.type', 'success',
    ];

    public function verify(array $obj, string $providedHmac, ?string $secret = null): bool
    {
        $secret = $secret ?? (string) config('services.paymob.hmac_secret', '');
        if ($secret === '' || $providedHmac === '') {
            return false;
        }

        $concatenated = '';
        foreach (self::HMAC_FIELDS as $field) {
            $value = data_get($obj, $field);
            $concatenated .= match (true) {
                is_bool($value) => $value ? 'true' : 'false',
                $value === null => '',
                default => (string) $value,
            };
        }

        $expected = hash_hmac('sha512', $concatenated, $secret);

        return hash_equals($expected, $providedHmac);
    }

    /**
     * @param  array<string, mixed>  $obj
     */
    public function sign(array $obj, ?string $secret = null): string
    {
        $secret = $secret ?? (string) config('services.paymob.hmac_secret', '');
        $concatenated = '';
        foreach (self::HMAC_FIELDS as $field) {
            $value = data_get($obj, $field);
            $concatenated .= match (true) {
                is_bool($value) => $value ? 'true' : 'false',
                $value === null => '',
                default => (string) $value,
            };
        }

        return hash_hmac('sha512', $concatenated, $secret);
    }
}
