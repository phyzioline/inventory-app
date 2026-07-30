<?php

use App\Domain\Models\Subscription;
use App\Domain\Models\SubscriptionPayment;
use App\Domain\Models\SubscriptionPlan;
use App\Infrastructure\External\PaymobHmacVerifier;
use App\Models\User;
use Illuminate\Support\Facades\Config;

function makePendingPaymobPayment(string $gatewayReference): SubscriptionPayment
{
    $user = User::factory()->create();
    $plan = SubscriptionPlan::query()->first();
    if (! $plan) {
        $plan = SubscriptionPlan::query()->create([
            'name' => 'Pro',
            'plan_code' => 'pro-test-'.uniqid(),
            'price_monthly' => 100,
            'price_yearly' => 1000,
            'is_active' => true,
        ]);
    }

    $subscription = Subscription::query()->create([
        'user_id' => $user->id,
        'plan_id' => $plan->id,
        'status' => 'active',
        'billing_cycle' => 'monthly',
        'amount' => 100,
        'starts_at' => now(),
    ]);

    return SubscriptionPayment::query()->create([
        'subscription_id' => $subscription->id,
        'amount' => 100,
        'currency' => 'EGP',
        'gateway' => 'paymob',
        'gateway_reference' => $gatewayReference,
        'status' => 'pending',
        'meta' => [
            'user_id' => $user->id,
            'plan_id' => $plan->id,
            'billing_cycle' => 'monthly',
        ],
    ]);
}

/**
 * @return array<string, mixed>
 */
function samplePaymobObj(string $merchantOrderId, bool $success = true): array
{
    return [
        'amount_cents' => 10000,
        'created_at' => '2026-07-30T12:00:00',
        'currency' => 'EGP',
        'error_occured' => false,
        'has_parent_transaction' => false,
        'id' => 12345,
        'integration_id' => 99,
        'is_3d_secure' => false,
        'is_auth' => false,
        'is_capture' => false,
        'is_refunded' => false,
        'is_standalone_payment' => true,
        'is_voided' => false,
        'order' => [
            'id' => 555,
            'merchant_order_id' => $merchantOrderId,
        ],
        'owner' => 1,
        'pending' => false,
        'source_data' => [
            'pan' => '1234',
            'sub_type' => 'MasterCard',
            'type' => 'card',
        ],
        'success' => $success,
    ];
}

it('rejects paymob webhook with missing hmac', function () {
    Config::set('services.paymob.hmac_secret', 'test-secret-key');

    $this->postJson('/webhooks/paymob', [
        'obj' => ['success' => true, 'order' => ['merchant_order_id' => 'ord-1']],
    ])->assertForbidden();
});

it('rejects paymob webhook with invalid hmac', function () {
    Config::set('services.paymob.hmac_secret', 'test-secret-key');

    $this->postJson('/webhooks/paymob?hmac=deadbeef', [
        'obj' => samplePaymobObj('ord-bad'),
    ])->assertForbidden();
});

it('accepts paymob webhook with valid hmac and marks payment paid', function () {
    Config::set('services.paymob.hmac_secret', 'test-secret-key');

    $payment = makePendingPaymobPayment('moid-valid-1');
    $obj = samplePaymobObj('moid-valid-1', true);
    $hmac = app(PaymobHmacVerifier::class)->sign($obj, 'test-secret-key');

    $this->postJson('/webhooks/paymob?hmac='.$hmac, ['obj' => $obj])
        ->assertOk()
        ->assertJson(['received' => true]);

    expect($payment->fresh()->status)->toBe('paid');
});

it('acks already-processed payment without error', function () {
    Config::set('services.paymob.hmac_secret', 'test-secret-key');

    $payment = makePendingPaymobPayment('moid-done');
    $payment->update(['status' => 'paid']);

    $obj = samplePaymobObj('moid-done', true);
    $hmac = app(PaymobHmacVerifier::class)->sign($obj, 'test-secret-key');

    $this->postJson('/webhooks/paymob?hmac='.$hmac, ['obj' => $obj])
        ->assertOk()
        ->assertJson(['received' => true]);

    expect($payment->fresh()->status)->toBe('paid');
});
