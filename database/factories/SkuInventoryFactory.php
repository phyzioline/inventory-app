<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;

/**
 * @extends Factory<SkuInventory>
 */
class SkuInventoryFactory extends Factory
{
    protected $model = SkuInventory::class;

    public function definition(): array
    {
        return [
            'sku_id' => Sku::factory(),
            'location_id' => InventoryLocation::factory(),
            'quantity' => $this->faker->numberBetween(0, 100),
            'reserved' => 0,
        ];
    }
}
