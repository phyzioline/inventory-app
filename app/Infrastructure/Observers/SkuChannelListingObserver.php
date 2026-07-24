<?php

namespace App\Infrastructure\Observers;

use App\Domain\Models\Wms\Sku;

/**
 * The monolith's PlatformIdentifierService (Modules\Ecommerce) assigned a
 * cross-channel marketplace listing id here. That is an Ecommerce catalog
 * concern that does not exist in this standalone extraction — removed
 * per the Inventory extraction decision to drop Ecommerce integration
 * entirely. The observer registration is kept as a no-op extension point
 * so channel-listing-id assignment can be reintroduced locally if this app
 * ever needs its own identifier scheme.
 */
class SkuChannelListingObserver
{
    public function creating(Sku $sku): void
    {
        // Intentionally empty — see class docblock.
    }
}
