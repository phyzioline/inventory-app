<?php

declare(strict_types=1);

namespace App\Domain\ValueObjects;

/**
 * Ledger-only settlement methods that must never move treasury cash/bank totals.
 */
final class NonCashSettlementMethod
{
    public const SET_OFF = 'set_off';

    /** @return list<string> */
    public static function all(): array
    {
        return [self::SET_OFF];
    }

    public static function isNonCash(?string $method): bool
    {
        $m = strtolower(trim((string) $method));

        return $m !== '' && in_array($m, self::all(), true);
    }
}
