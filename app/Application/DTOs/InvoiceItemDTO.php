<?php

namespace App\Application\DTOs;

readonly class InvoiceItemDTO
{
    public function __construct(
        public ?int $skuId,
        public float $quantity,
        public float $unitPrice,
    ) {}
}
