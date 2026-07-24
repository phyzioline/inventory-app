<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\MasterProduct;

/**
 * @extends Factory<InventoryOffer>
 */
class InventoryOfferFactory extends Factory
{
    protected $model = InventoryOffer::class;

    public function definition(): array
    {
        return [
            'master_product_id' => MasterProduct::factory(),
            'name' => $this->faker->words(2, true),
            'type' => 'single',
        ];
    }
}
