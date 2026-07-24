<?php

declare(strict_types=1);

namespace App\Application\Services;

use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\Auth;
use App\Domain\Models\Wms\CapitalSource;
use App\Domain\Models\Wms\Payment;
use App\Presentation\Http\Controllers\Api\CashFlowSummaryController;

/**
 * شروط الخزنة (inventory treasury):
 *
 * **وارد (يزيد الرصيد):** كل سجلات `inv_receipts` لمستخدم الـ tenant — منها تلقائياً مقبوض «رأس المال» عند إنشاء/تعديل مصدر رأس مال، ومقبوضات المبيعات/التسويات/اليدوي.
 *
 * **صادر (ينقص الرصيد):** مجموع `inv_payments` بحالات completed + pending + confirmed (مع مراعاة صفوف المرايا AUTO_PURCHASE_BATCH)، + كل `inv_expenses`، + جزء «تسوية المشتريات الضمنية» من فواتير `PurchaseBatch` بنفس منطق `CashFlowSummaryController`.
 *
 * **المتاح للصرف:** `إجمالي المقبوضات − إجمالي الصادر` (نفس `estimated_balance`؛ قد يكون سالبًا في العرض).
 *
 * **قبل أي صرف جديد:** مبلغ المدفوع/المصروف ≤ المتاح (والمسارات التي تنشئ `inv_payments` خارج `PaymentController` يجب أن تستدعي `assertPaymentAllowedForUser`).
 */
class TreasurySpendGuard
{
    public function ensureCapitalRegisteredForUser(int $userId): void
    {
        if ($userId <= 0) {
            return;
        }

        if (! CapitalSource::withoutGlobalScopes()->where('user_id', $userId)->exists()) {
            throw new HttpResponseException(response()->json([
                'message' => 'يجب تسجيل مصدر رأس مال أولاً قبل تسجيل مدفوعات أو مصروفات. / Add at least one capital source before payments or expenses.',
            ], 422));
        }
    }

    public function ensureCapitalRegistered(): void
    {
        if (! Auth::check()) {
            return;
        }
        $this->ensureCapitalRegisteredForUser((int) Auth::id());
    }

    public function availableCashForUser(int $userId): float
    {
        if ($userId <= 0) {
            return 0.0;
        }
        $stats = app(CashFlowSummaryController::class)->getCoreStatsForUser($userId);

        return round((float) ($stats['total_receipts'] ?? 0) - (float) ($stats['total_outflow'] ?? 0), 2);
    }

    public function availableCash(): float
    {
        if (! Auth::check()) {
            return 0.0;
        }

        return $this->availableCashForUser((int) Auth::id());
    }

    public function assertPaymentAllowedForUser(int $userId, float $amount): void
    {
        $avail = $this->availableCashForUser($userId);
        if ($amount > $avail + 0.00001) {
            throw new HttpResponseException(response()->json([
                'message' => 'لا يوجد رصيد كافٍ في الخزنة لهذا الدفع. المتاح: '.number_format($avail, 2).' ج.م. / No sufficient treasury balance for this payment. Available: '.number_format($avail, 2).' EGP',
                'available' => $avail,
            ], 422));
        }
    }

    /**
     * @param  float  $amount  New payment amount (pending or completed both count in outflow)
     */
    public function assertPaymentAllowed(float $amount): void
    {
        if (! Auth::check()) {
            return;
        }
        $this->assertPaymentAllowedForUser((int) Auth::id(), $amount);
    }

    public function assertExpenseAllowed(float $amount): void
    {
        if (! Auth::check()) {
            return;
        }
        $avail = $this->availableCashForUser((int) Auth::id());
        if ($amount > $avail + 0.00001) {
            throw new HttpResponseException(response()->json([
                'message' => 'لا يوجد رصيد كافٍ في الخزنة لهذا المصروف. المتاح: '.number_format($avail, 2).' ج.م. / No sufficient treasury balance for this expense. Available: '.number_format($avail, 2).' EGP',
                'available' => $avail,
            ], 422));
        }
    }

    /**
     * When increasing amount on an already-completed payment, outflow already includes the old amount.
     */
    public function assertCompletedPaymentIncreaseAllowed(Payment $payment, float $newAmount): void
    {
        $uid = (int) $payment->user_id;
        if (! in_array((string) $payment->status, ['completed', 'confirmed'], true)) {
            return;
        }
        $old = (float) $payment->amount;
        if ($newAmount <= $old + 0.00001) {
            return;
        }
        $avail = $this->availableCashForUser($uid);
        $delta = $newAmount - $old;
        if ($delta > $avail + 0.00001) {
            throw new HttpResponseException(response()->json([
                'message' => 'رصيد الخزنة لا يسمح بزيادة مبلغ هذا الدفع. المتاح للزيادة: '.number_format($avail, 2).' ج.م. / Insufficient headroom for payment increase.',
                'available' => $avail,
            ], 422));
        }
    }

    public function assertExpenseIncreaseAllowed(float $oldAmount, float $newAmount, int $expenseOwnerUserId): void
    {
        if ($newAmount <= $oldAmount + 0.00001) {
            return;
        }
        $delta = $newAmount - $oldAmount;
        $avail = $this->availableCashForUser($expenseOwnerUserId);
        if ($delta > $avail + 0.00001) {
            throw new HttpResponseException(response()->json([
                'message' => 'رصيد الخزنة لا يسمح بزيادة هذا المصروف. / Insufficient balance to increase this expense.',
            ], 422));
        }
    }
}
