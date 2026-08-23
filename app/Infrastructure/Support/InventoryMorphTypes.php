<?php

namespace App\Infrastructure\Support;

use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\Settlement;

/**
 * Receipts/expenses migrated from the phyzioline monolith (laravel-phyzio, which used the
 * `Modules\Inventory\...` namespace) kept their original polymorphic `reference_type` strings.
 * Any `reference_type` match against a current `::class` constant must also check these legacy
 * aliases or it will silently treat migrated rows as unlinked.
 */
final class InventoryMorphTypes
{
    /** @var list<string> */
    private const LEGACY_INVENTORY_ORDER_TYPES = [
        'App\Models\Inventory\InventoryOrder',
        'Modules\Inventory\app\Domain\Models\Wms\InventoryOrder',
    ];

    /** @var list<string> */
    private const LEGACY_SETTLEMENT_TYPES = [
        'Modules\Inventory\app\Domain\Models\Wms\Settlement',
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

    /**
     * @return list<string>
     */
    public static function settlementReferenceTypes(): array
    {
        return array_values(array_unique([
            Settlement::class,
            ...self::LEGACY_SETTLEMENT_TYPES,
        ]));
    }
}
