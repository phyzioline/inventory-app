<?php

namespace App\Http\Middleware;

use App\Domain\Models\Subscription;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryLocation;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * Route-level "can this tenant create one more X" gate. Reads the numeric
 * limit straight from the active subscription's plan->limits JSON (null =
 * unlimited) and does a live COUNT() — no config-override layer or separate
 * entitlement service, unlike the monolith's Clinics equivalent, since this
 * app only has two limit types today. Usage: ->middleware('check.subscription.limit:warehouses')
 */
class CheckSubscriptionLimit
{
    private const COUNTERS = [
        'warehouses' => InventoryLocation::class,
        'channels' => Channel::class,
    ];

    public function handle(Request $request, Closure $next, string $limitType): Response
    {
        $userId = Auth::id();
        if (! $userId || ! isset(self::COUNTERS[$limitType])) {
            return $next($request);
        }

        $subscription = Subscription::query()
            ->where('user_id', $userId)
            ->whereIn('status', ['trial', 'active'])
            ->latest('id')
            ->first();

        $limit = $subscription?->plan?->limit($limitType);

        if ($limit === null) {
            // No active subscription (shouldn't happen — every user gets one on
            // register) or plan has no cap for this key: don't block.
            return $next($request);
        }

        $modelClass = self::COUNTERS[$limitType];
        $current = $modelClass::count();

        if ($current >= $limit) {
            return response()->json([
                'success' => false,
                'message' => "Your plan allows up to {$limit} {$limitType}. Upgrade to add more.",
                'upgrade_required' => true,
            ], 403);
        }

        return $next($request);
    }
}
