<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Application\Services\SubscriptionCheckoutService;
use App\Domain\Models\SubscriptionPayment;
use App\Http\Controllers\Controller;
use App\Infrastructure\External\PaymobHmacVerifier;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * Paymob's server-to-server "transaction processed" callback. Verified by
 * HMAC (query param `hmac`), never by session/CSRF — see
 * bootstrap/app.php's validateCsrfTokens(except: ['webhooks/paymob']).
 */
class PaymobWebhookController extends Controller
{
    public function __construct(
        private readonly SubscriptionCheckoutService $checkout,
        private readonly PaymobHmacVerifier $hmac,
    ) {}

    public function __invoke(Request $request): JsonResponse
    {
        $obj = $request->input('obj', []);
        if (! is_array($obj)) {
            $obj = [];
        }
        $providedHmac = (string) $request->query('hmac', '');

        if (! $this->hmac->verify($obj, $providedHmac)) {
            Log::warning('Paymob webhook: HMAC verification failed', ['merchant_order_id' => $obj['order']['merchant_order_id'] ?? null]);
            abort(403, 'Invalid signature.');
        }

        $merchantOrderId = $obj['order']['merchant_order_id'] ?? null;
        $success = filter_var($obj['success'] ?? false, FILTER_VALIDATE_BOOLEAN);

        if (! $merchantOrderId) {
            return response()->json(['received' => true]);
        }

        $payment = SubscriptionPayment::query()->where('gateway_reference', $merchantOrderId)->first();
        if (! $payment || $payment->status !== 'pending') {
            return response()->json(['received' => true]);
        }

        if ($success) {
            $payment->update(['status' => 'paid']);
            $this->checkout->activateFromPayment($payment);
        } else {
            $payment->update(['status' => 'failed']);
            $userId = $payment->meta['user_id'] ?? null;
            if ($userId && $user = User::find($userId)) {
                $this->checkout->downgradeToFree($user);
            }
        }

        return response()->json(['received' => true]);
    }
}
