<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryOrderItem;

/**
 * @extends Factory<InventoryOrderItem>
 */
class InventoryOrderItemFactory extends Factory
{
    protected $model = InventoryOrderItem::class;

    public function definition(): array
    {
        $quantity = $this->faker->numberBetween(1, 5);
        $unitPrice = $this->faker->randomFloat(2, 10, 200);

        return [
            'inventory_order_id' => InventoryOrder::factory(),
            'sku_code' => strtoupper($this->faker->bothify('SKU-####??')),
            'product_name' => $this->faker->words(3, true),
            'quantity' => $quantity,
            'unit_price' => $unitPrice,
            'total_price' => $quantity * $unitPrice,
        ];
    }
}
