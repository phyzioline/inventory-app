<?php

namespace App\Infrastructure\Support;

use App\Domain\Models\Wms\InventoryOrder;

final class InventoryMorphTypes
{
    /** @var list<string> */
    private const LEGACY_INVENTORY_ORDER_TYPES = [
        'App\Models\Inventory\InventoryOrder',
    ];

    /**
     * @return list<string>
     */
    public static function inventoryOrderReferenceTypes(): array
    {
        return array_values(array_unique([
            InventoryOrder::class,
            ...self::LEGACY_INVENTORY_ORDER_TYPES,
        ]));
    }
}
