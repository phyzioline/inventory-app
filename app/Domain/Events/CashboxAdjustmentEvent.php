<?php

namespace App\Domain\Events;

use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;
use App\Domain\Models\Wms\InventoryOrder;

/**
 * Fired when an invoice edit changes the paid amount on a sales order.
 * Positive delta = more cash received (receipt created).
 * Negative delta = payment reversal (reversal receipt created).
 */
class CashboxAdjustmentEvent
{
    use Dispatchable, SerializesModels;

    public function __construct(
        public readonly InventoryOrder $order,
        public readonly float $previousPaid,
        public readonly float $newPaid,
        public readonly float $delta,
        public readonly string $paymentMethod,
    ) {}
}
