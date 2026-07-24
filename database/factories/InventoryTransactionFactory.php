<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\Sku;

/**
 * @extends Factory<InventoryTransaction>
 */
class InventoryTransactionFactory extends Factory
{
    protected $model = InventoryTransaction::class;

    public function definition(): array
    {
        return [
            'sku_id' => Sku::factory(),
            'location_id' => InventoryLocation::factory(),
            'type' => $this->faker->randomElement(['IN', 'OUT', 'TRANSFER', 'ADJUSTMENT']),
            'quantity' => $this->faker->numberBetween(1, 20),
        ];
    }
}
