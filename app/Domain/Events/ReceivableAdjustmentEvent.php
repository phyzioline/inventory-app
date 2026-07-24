<?php

namespace App\Domain\Events;

use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;
use App\Domain\Models\Wms\InventoryOrder;

/**
 * Fired when an invoice edit changes the customer's outstanding (remaining) balance.
 * Listeners can update customer AR balance, trigger dunning logic, etc.
 */
class ReceivableAdjustmentEvent
{
    use Dispatchable, SerializesModels;

    public function __construct(
        public readonly InventoryOrder $order,
        public readonly float $previousRemaining,
        public readonly float $newRemaining,
    ) {}
}
