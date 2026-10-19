<?php

namespace App\Domain\ValueObjects;

/**
 * The `[PAYMENT] type=…; paid=…; remaining=…; status=…` line stored in a purchase batch's notes.
 *
 * Single reader for every screen that needs "how much of this purchase invoice is paid".
 * The paid figure is evidence only: what the user entered. `type=cash` is the payment method,
 * never proof that the whole invoice was paid — a cash invoice with paid=0 is fully open.
 */
final class PurchasePaymentMeta
{
    public function __construct(
        public readonly ?string $type,
        public readonly ?float $paid,
        public readonly ?float $remaining,
        public readonly ?string $status,
    ) {}

    public static function fromNotes(?string $notes): self
    {
        $line = collect(preg_split('/\r\n|\r|\n/', (string) ($notes ?? '')))
            ->first(fn ($entry) => str_starts_with(trim((string) $entry), '[PAYMENT]')) ?? '';

        preg_match('/paid=([0-9]+(?:\.[0-9]+)?)/i', $line, $paidMatch);
        preg_match('/remaining=([0-9]+(?:\.[0-9]+)?)/i', $line, $remainingMatch);
        preg_match('/type=(cash|credit)/i', $line, $typeMatch);
        preg_match('/status=([a-z_]+)/i', $line, $statusMatch);

        return new self(
            type: isset($typeMatch[1]) ? strtolower($typeMatch[1]) : null,
            paid: isset($paidMatch[1]) ? (float) $paidMatch[1] : null,
            remaining: isset($remainingMatch[1]) ? (float) $remainingMatch[1] : null,
            status: isset($statusMatch[1]) ? strtolower($statusMatch[1]) : null,
        );
    }

    /**
     * $notes with its `[PAYMENT]` line replaced (or appended) by one for the given figures.
     */
    public static function writeToNotes(?string $notes, string $type, float $paid, float $remaining, string $status): string
    {
        $base = collect(preg_split('/\r\n|\r|\n/', (string) ($notes ?? '')))
            ->filter(fn ($line) => ! str_starts_with(trim((string) $line), '[PAYMENT]'))
            ->implode("\n");
        $line = sprintf(
            '[PAYMENT] type=%s; paid=%s; remaining=%s; status=%s',
            $type,
            number_format($paid, 2, '.', ''),
            number_format($remaining, 2, '.', ''),
            $status
        );

        return trim(implode("\n", array_filter([trim($base), $line], fn ($entry) => trim((string) $entry) !== '')));
    }

    /**
     * Amount actually paid against an invoice of $total. No meta, or no entered amount, means 0.
     */
    public function paidAgainst(float $total): float
    {
        if ($total <= 0.00001) {
            return 0.0;
        }
        if ($this->remaining !== null) {
            return max(0.0, $total - min(max(0.0, $this->remaining), $total));
        }
        if ($this->paid !== null) {
            return min(max(0.0, $this->paid), $total);
        }

        return 0.0;
    }

    public function remainingAgainst(float $total): float
    {
        return max(0.0, $total - $this->paidAgainst($total));
    }

    /**
     * @return array{paid: ?float, remaining: ?float, type: ?string, status: ?string}
     */
    public function toArray(): array
    {
        return [
            'paid' => $this->paid,
            'remaining' => $this->remaining,
            'type' => $this->type,
            'status' => $this->status,
        ];
    }
}
