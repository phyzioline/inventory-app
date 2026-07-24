<?php

namespace App\Infrastructure\Observers;

use App\Domain\Models\Wms\MasterProduct;

/**
 * The monolith's PlatformIdentifierService (Modules\Ecommerce) assigned a
 * cross-channel "MP id" here. That is an Ecommerce catalog concern that
 * does not exist in this standalone extraction — removed per the
 * Inventory extraction decision to drop Ecommerce integration entirely.
 * The observer registration is kept as a no-op extension point so a local
 * MP-id scheme can be reintroduced here if this app ever needs one.
 */
class MasterProductIdentifierObserver
{
    public function saving(MasterProduct $masterProduct): void
    {
        // Intentionally empty — see class docblock.
    }
}
