<?php

declare(strict_types=1);

namespace App\Domain\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Broadcast-only event with scalar payload — do NOT use SerializesModels.
 * That trait left $userId uninitialized when the queued broadcast was restored,
 * causing failed_jobs: "Typed property ...::$userId must not be accessed before initialization".
 */
final class StockUpdated implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets;

    public function __construct(
        public readonly int $productId,
        public readonly int $warehouseId,
        public readonly int $newQuantity,
        public readonly string $type,
        public readonly int $userId = 0,
    ) {}

    public function broadcastOn(): array
    {
        if ($this->userId <= 0) {
            return [];
        }

        return [new PrivateChannel('inventory.user.'.$this->userId)];
    }

    public function broadcastAs(): string
    {
        return 'stock.updated';
    }

    /**
     * @return array<string, int|string>
     */
    public function broadcastWith(): array
    {
        return [
            'product_id' => $this->productId,
            'warehouse_id' => $this->warehouseId,
            'quantity' => $this->newQuantity,
            'type' => $this->type,
        ];
    }
}
