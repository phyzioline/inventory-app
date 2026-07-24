<?php

namespace App\Infrastructure\Observers;

use App\Domain\Models\Wms\Vendor;
use App\Infrastructure\External\MonolithCrmWebhookClient;

class VendorObserver
{
    public function created(Vendor $vendor): void
    {
        $this->dispatchSync($vendor, 'created');
    }

    public function updated(Vendor $vendor): void
    {
        if ($vendor->wasChanged(['name', 'phone', 'email', 'address'])) {
            $this->dispatchSync($vendor, 'updated');
        }
    }

    protected function dispatchSync(Vendor $vendor, string $event): void
    {
        app(MonolithCrmWebhookClient::class)->syncVendor($vendor, $event);
    }
}
