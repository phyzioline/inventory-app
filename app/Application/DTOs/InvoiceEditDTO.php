<?php

namespace App\Application\DTOs;

/**
 * Immutable input object for the InvoiceEditService.
 * No HTTP dependencies — safe to construct from any context.
 *
 * @property InvoiceItemDTO[] $items Empty array = no item changes (payment-only edit)
 */
readonly class InvoiceEditDTO
{
    /**
     * @param  InvoiceItemDTO[]  $items
     */
    public function __construct(
        public int $orderId,
        public array $items,
        public ?float $paidAmount,
        public ?string $paymentType,
        public ?float $taxAmount,
        public ?float $discountAmount,
        public ?string $reason,
        public int $userId,
    ) {}
}
