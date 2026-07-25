<?php

declare(strict_types=1);

namespace App\Presentation\Http\Controllers\Api;

use App\Application\Services\SubscriptionCheckoutService;
use App\Domain\Models\Subscription;
use App\Domain\Models\SubscriptionPlan;
use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class SubscriptionController extends Controller
{
    public function __construct(
        private readonly SubscriptionCheckoutService $checkout,
    ) {}

    public function plans()
    {
        return response()->json(
            SubscriptionPlan::query()->where('is_active', true)->orderBy('sort_order')->get()
        );
    }

    public function current()
    {
        $subscription = Subscription::with('plan')
            ->where('user_id', Auth::id())
            ->latest('id')
            ->first();

        return response()->json($subscription);
    }

    public function upgrade(Request $request)
    {
        $data = $request->validate([
            'plan_code' => ['required', 'string', 'exists:subscription_plans,plan_code'],
            'billing_cycle' => ['required', 'in:monthly,yearly'],
        ]);

        $plan = SubscriptionPlan::query()->where('plan_code', $data['plan_code'])->firstOrFail();

        try {
            return response()->json(
                $this->checkout->initiateUpgrade(Auth::user(), $plan, $data['billing_cycle'])
            );
        } catch (\Throwable $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }
    }

    public function cancel()
    {
        $this->checkout->downgradeToFree(Auth::user());

        return response()->json(['success' => true]);
    }
}
