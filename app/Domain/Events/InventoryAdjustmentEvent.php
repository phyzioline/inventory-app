<?php

namespace App\Domain\Events;

use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;
use App\Domain\Models\Wms\InventoryOrder;

/**
 * Fired when an invoice edit causes stock quantities to change.
 * Listeners can log, notify, or re-index accordingly.
 *
 * $skuDeltas: [sku_id => delta_qty] — positive = more OUT, negative = stock returned IN
 */
class InventoryAdjustmentEvent
{
    use Dispatchable, SerializesModels;

    public function __construct(
        public readonly InventoryOrder $order,
        public readonly array $skuDeltas,
        public readonly string $reason = 'invoice_edit',
    ) {}
}
