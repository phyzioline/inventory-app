<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;
use App\Domain\Models\Wms\Channel;

/**
 * @extends Factory<Channel>
 */
class ChannelFactory extends Factory
{
    protected $model = Channel::class;

    public function definition(): array
    {
        return [
            'name' => $this->faker->company(),
            'type' => $this->faker->randomElement(['merchant', 'store']),
            'slug' => $this->faker->unique()->slug(),
            'is_active' => true,
            'credentials' => null,
        ];
    }
}
