<?php

namespace App\Infrastructure\External;

use App\Models\User;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Paymob Unified Intention API. Mirrors the monolith's
 * Modules\Revenue\app\Infrastructure\External\PaymobCheckoutClient.php
 * (same endpoint/payload shape), with this app's own merchant credentials
 * — see .env.example's PAYMOB_* keys. Do NOT reuse the monolith's Paymob
 * account for this app.
 */
class PaymobCheckoutClient
{
    /**
     * @return array{client_secret: string, checkout_url: string}
     */
    public function createIntention(
        User $user,
        int $amountMajorUnits,
        string $merchantOrderId,
        string $itemName,
    ): array {
        $secretKey = config('services.paymob.secret_key');
        $publicKey = config('services.paymob.public_key');
        $integrationId = (int) config('services.paymob.integration_id');

        if (empty($secretKey) || empty($publicKey) || $integrationId <= 0) {
            throw new \RuntimeException('Payment gateway is not configured.');
        }

        $amountPiastres = max(100, $amountMajorUnits * 100);

        $payload = [
            'amount' => $amountPiastres,
            'currency' => 'EGP',
            'payment_methods' => [$integrationId],
            'items' => [[
                'name' => Str::limit($itemName, 127),
                'amount' => $amountPiastres,
                'description' => 'Phyzioline Inventory subscription',
                'quantity' => 1,
            ]],
            'billing_data' => [
                'apartment' => 'NA',
                'first_name' => $user->name,
                'last_name' => '.',
                'street' => 'NA',
                'building' => 'NA',
                'phone_number' => '01000000000',
                'city' => 'Cairo',
                'country' => 'EG',
                'email' => $user->email,
                'floor' => 'NA',
                'state' => 'Cairo',
            ],
            'customer' => [
                'first_name' => $user->name,
                'last_name' => '.',
                'email' => $user->email,
            ],
            'merchant_order_id' => $merchantOrderId,
        ];

        if ($notificationUrl = config('services.paymob.notification_url')) {
            $payload['notification_url'] = $notificationUrl;
        }
        if ($returnUrl = config('services.paymob.return_url')) {
            $payload['return_url'] = $returnUrl;
        }

        $response = Http::timeout(30)
            ->withHeaders(['Authorization' => 'Token '.$secretKey])
            ->post('https://accept.paymob.com/v1/intention/', $payload);

        if (! $response->successful()) {
            Log::error('Paymob intention failed', ['body' => $response->body(), 'merchant_order_id' => $merchantOrderId]);
            throw new \RuntimeException('Payment could not be started.');
        }

        $clientSecret = $response->json('client_secret');
        if (! $clientSecret) {
            throw new \RuntimeException('Payment could not be started.');
        }

        $checkoutUrl = 'https://accept.paymob.com/unifiedcheckout/?publicKey='
            .urlencode($publicKey).'&clientSecret='.urlencode($clientSecret);

        return ['client_secret' => $clientSecret, 'checkout_url' => $checkoutUrl];
    }
}
