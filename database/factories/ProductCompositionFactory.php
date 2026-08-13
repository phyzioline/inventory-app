<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\ProductComposition;

/**
 * @extends Factory<ProductComposition>
 */
class ProductCompositionFactory extends Factory
{
    protected $model = ProductComposition::class;

    public function definition(): array
    {
        return [
            'parent_offer_id' => InventoryOffer::factory(),
            'component_offer_id' => InventoryOffer::factory(),
            'quantity_per' => $this->faker->numberBetween(2, 6),
        ];
    }
}
