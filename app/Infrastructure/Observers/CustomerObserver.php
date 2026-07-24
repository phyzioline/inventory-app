<?php

namespace App\Infrastructure\Observers;

use App\Domain\Models\Wms\Customer;
use App\Infrastructure\External\MonolithCrmWebhookClient;

class CustomerObserver
{
    public function created(Customer $customer): void
    {
        $this->dispatchSync($customer, 'created');
    }

    public function updated(Customer $customer): void
    {
        if ($customer->wasChanged(['name', 'phone', 'email', 'tax_id', 'address'])) {
            $this->dispatchSync($customer, 'updated');
        }
    }

    protected function dispatchSync(Customer $customer, string $event): void
    {
        app(MonolithCrmWebhookClient::class)->syncCustomer($customer, $event);
    }
}
