<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\Sku;

/**
 * @extends Factory<Sku>
 */
class SkuFactory extends Factory
{
    protected $model = Sku::class;

    public function definition(): array
    {
        return [
            'offer_id' => InventoryOffer::factory(),
            'sku' => strtoupper($this->faker->unique()->bothify('SKU-####??')),
            'marketplace_id' => $this->faker->bothify('B0#########'),
            'cost_price' => $this->faker->randomFloat(2, 5, 100),
            'selling_price' => $this->faker->randomFloat(2, 100, 500),
            'is_active' => true,
        ];
    }
}
