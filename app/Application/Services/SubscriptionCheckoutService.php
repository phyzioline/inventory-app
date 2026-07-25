<?php

namespace App\Application\Services;

use App\Domain\Models\Subscription;
use App\Domain\Models\SubscriptionPayment;
use App\Domain\Models\SubscriptionPlan;
use App\Infrastructure\External\PaymobCheckoutClient;
use App\Models\User;

class SubscriptionCheckoutService
{
    public function __construct(
        private readonly PaymobCheckoutClient $paymob,
    ) {}

    /**
     * @return array{checkout_url: string}
     */
    public function initiateUpgrade(User $user, SubscriptionPlan $plan, string $billingCycle): array
    {
        if ($plan->plan_code === 'free') {
            throw new \InvalidArgumentException('Free plan does not require checkout.');
        }

        $amount = $billingCycle === 'yearly' ? (float) $plan->price_yearly : (float) $plan->price_monthly;
        $merchantOrderId = 'INV-SUB-'.$user->id.'-'.time();

        $subscription = Subscription::query()
            ->where('user_id', $user->id)
            ->latest('id')
            ->first();

        $payment = SubscriptionPayment::create([
            'subscription_id' => $subscription?->id,
            'amount' => $amount,
            'currency' => 'EGP',
            'gateway' => 'paymob',
            'gateway_reference' => $merchantOrderId,
            'status' => 'pending',
            'meta' => [
                'plan_id' => $plan->id,
                'plan_code' => $plan->plan_code,
                'billing_cycle' => $billingCycle,
                'user_id' => $user->id,
            ],
        ]);

        $intention = $this->paymob->createIntention(
            user: $user,
            amountMajorUnits: (int) round($amount),
            merchantOrderId: $merchantOrderId,
            itemName: $plan->name.' subscription',
        );

        return ['checkout_url' => $intention['checkout_url']];
    }

    /**
     * Called by PaymobWebhookController on a confirmed payment. Activates or
     * extends the tenant's subscription onto the paid plan.
     */
    public function activateFromPayment(SubscriptionPayment $payment): ?Subscription
    {
        $meta = $payment->meta ?? [];
        $userId = $meta['user_id'] ?? null;
        $planId = $meta['plan_id'] ?? null;

        if (! $userId || ! $planId) {
            return null;
        }

        $billingCycle = $meta['billing_cycle'] ?? 'monthly';
        $endsAt = $billingCycle === 'yearly' ? now()->addYear() : now()->addMonth();

        $subscription = Subscription::query()->where('user_id', $userId)->latest('id')->first();

        if ($subscription) {
            $subscription->update([
                'plan_id' => $planId,
                'status' => 'active',
                'billing_cycle' => $billingCycle,
                'amount' => $payment->amount,
                'starts_at' => now(),
                'ends_at' => $endsAt,
            ]);

            return $subscription->fresh();
        }

        return Subscription::create([
            'user_id' => $userId,
            'plan_id' => $planId,
            'status' => 'active',
            'billing_cycle' => $billingCycle,
            'amount' => $payment->amount,
            'starts_at' => now(),
            'ends_at' => $endsAt,
        ]);
    }

    /**
     * Called by PaymobWebhookController on a failed payment. The tenant never
     * ends up with zero plan — falls back to whatever they had (their
     * existing subscription row is simply left untouched here; if none
     * exists, downgradeToFree() should be called separately).
     */
    public function downgradeToFree(User $user): void
    {
        $freePlan = SubscriptionPlan::query()->where('plan_code', 'free')->first();
        if (! $freePlan) {
            return;
        }

        $subscription = Subscription::query()->where('user_id', $user->id)->latest('id')->first();

        if ($subscription) {
            $subscription->update(['plan_id' => $freePlan->id, 'status' => 'active', 'ends_at' => null]);

            return;
        }

        Subscription::create([
            'user_id' => $user->id,
            'plan_id' => $freePlan->id,
            'status' => 'active',
            'starts_at' => now(),
        ]);
    }
}
