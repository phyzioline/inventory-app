<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryOrder;

/**
 * @extends Factory<InventoryOrder>
 */
class InventoryOrderFactory extends Factory
{
    protected $model = InventoryOrder::class;

    public function definition(): array
    {
        return [
            'platform_order_id' => $this->faker->unique()->bothify('###-#######-#######'),
            'channel_id' => Channel::factory(),
            'status' => 'pending',
            'order_date' => now(),
            'currency' => 'EGP',
            'total_amount' => $this->faker->randomFloat(2, 50, 1000),
        ];
    }
}
