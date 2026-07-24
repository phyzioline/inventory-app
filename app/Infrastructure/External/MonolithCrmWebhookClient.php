<?php

namespace App\Infrastructure\External;

use App\Domain\Models\Wms\Customer;
use App\Domain\Models\Wms\Vendor;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Outbound replacement for the monolith's in-process CRM sync
 * (Modules\CRM\...\SyncContactToCrmJob / ContactSyncEngine).
 *
 * This standalone app no longer shares a database or queue with the
 * monolith, so contact sync becomes a best-effort webhook call instead of a
 * queued job dispatch. The monolith-side receiver endpoint is out of scope
 * here (owned by the monolith repo) — this client only fires the request.
 *
 * Failures are logged and swallowed: a CRM outage must never block a
 * customer/vendor create or update in this app.
 */
final class MonolithCrmWebhookClient
{
    public function syncCustomer(Customer $customer, string $event): void
    {
        $this->send([
            'entity_type' => 'inventory_customer',
            'id' => (int) $customer->id,
            'name' => $customer->name,
            'phone' => $customer->phone,
            'email' => $customer->email,
            'tax_id' => $customer->tax_id,
            'address' => $customer->address,
            'event' => $event,
        ]);
    }

    public function syncVendor(Vendor $vendor, string $event): void
    {
        $this->send([
            'entity_type' => 'inventory_vendor',
            'id' => (int) $vendor->id,
            'name' => $vendor->name,
            'phone' => $vendor->phone,
            'email' => $vendor->email,
            'tax_id' => null,
            'address' => $vendor->address,
            'event' => $event,
        ]);
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function send(array $payload): void
    {
        $url = (string) config('services.monolith.crm_webhook_url', '');
        if ($url === '') {
            return;
        }

        try {
            Http::timeout(5)
                ->withHeaders([
                    'X-Webhook-Secret' => (string) config('services.monolith.webhook_secret', ''),
                ])
                ->post($url, $payload);
        } catch (\Throwable $e) {
            Log::warning('Monolith CRM webhook sync failed', [
                'entity_type' => $payload['entity_type'] ?? null,
                'entity_id' => $payload['id'] ?? null,
                'event' => $payload['event'] ?? null,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
