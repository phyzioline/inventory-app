<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;
use App\Domain\Models\Wms\MasterProduct;

/**
 * @extends Factory<MasterProduct>
 */
class MasterProductFactory extends Factory
{
    protected $model = MasterProduct::class;

    public function definition(): array
    {
        return [
            'internal_name' => $this->faker->words(3, true),
            'category' => $this->faker->word(),
            'is_active' => true,
        ];
    }
}
