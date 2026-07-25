<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Application\Services\SubscriptionCheckoutService;
use App\Domain\Models\SubscriptionPayment;
use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * Paymob's server-to-server "transaction processed" callback. Verified by
 * HMAC (query param `hmac`), never by session/CSRF — see
 * bootstrap/app.php's validateCsrfTokens(except: ['webhooks/paymob']).
 *
 * IMPORTANT: the field order below is Paymob's documented HMAC field list
 * for this callback as of when this was written. Confirm it against
 * Paymob's current dashboard/API docs and test against their sandbox before
 * relying on this in production — a wrong field order silently rejects
 * every real payment (fails closed, not open, but still breaks checkout).
 */
class PaymobWebhookController extends Controller
{
    private const HMAC_FIELDS = [
        'amount_cents', 'created_at', 'currency', 'error_occured',
        'has_parent_transaction', 'id', 'integration_id', 'is_3d_secure',
        'is_auth', 'is_capture', 'is_refunded', 'is_standalone_payment',
        'is_voided', 'order.id', 'owner', 'pending',
        'source_data.pan', 'source_data.sub_type', 'source_data.type', 'success',
    ];

    public function __construct(
        private readonly SubscriptionCheckoutService $checkout,
    ) {}

    public function __invoke(Request $request): JsonResponse
    {
        $obj = $request->input('obj', []);
        $providedHmac = (string) $request->query('hmac', '');

        if (! $this->verifyHmac($obj, $providedHmac)) {
            Log::warning('Paymob webhook: HMAC verification failed', ['merchant_order_id' => $obj['order']['merchant_order_id'] ?? null]);
            abort(403, 'Invalid signature.');
        }

        $merchantOrderId = $obj['order']['merchant_order_id'] ?? null;
        $success = (bool) ($obj['success'] ?? false);

        if (! $merchantOrderId) {
            return response()->json(['received' => true]);
        }

        $payment = SubscriptionPayment::query()->where('gateway_reference', $merchantOrderId)->first();
        if (! $payment || $payment->status !== 'pending') {
            // Already processed, or not one of ours — ack without acting (Paymob retries on non-2xx).
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

    /**
     * @param  array<string, mixed>  $obj
     */
    private function verifyHmac(array $obj, string $providedHmac): bool
    {
        $secret = config('services.paymob.hmac_secret');
        if (! $secret || $providedHmac === '') {
            return false;
        }

        $concatenated = '';
        foreach (self::HMAC_FIELDS as $field) {
            $value = data_get($obj, $field);
            $concatenated .= match (true) {
                is_bool($value) => $value ? 'true' : 'false',
                $value === null => '',
                default => (string) $value,
            };
        }

        $expected = hash_hmac('sha512', $concatenated, $secret);

        return hash_equals($expected, $providedHmac);
    }
}
