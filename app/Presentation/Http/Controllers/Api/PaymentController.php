<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use App\Application\Services\FinanceAccountLedgerService;
use App\Application\Services\TreasurySpendGuard;
use App\Domain\Models\Wms\Payment;
use App\Domain\Models\Wms\Supplier;
use App\Domain\Models\Wms\Vendor;

class PaymentController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index(Request $request)
    {
        $query = Payment::with(['user', 'payee']);

        if ($request->has('search')) {
            $search = $request->search;
            $query->where(function ($q) use ($search) {
                $q->where('payment_number', 'like', "%{$search}%")
                    ->orWhere('payee_name', 'like', "%{$search}%")
                    ->orWhere('notes', 'like', "%{$search}%");
            });
        }

        if ($request->has('warehouse_id') && $request->warehouse_id !== 'all') {
            $query->where('warehouse_id', $request->warehouse_id);
        }

        $perPage = min(500, max(1, (int) $request->input('per_page', 50)));

        $payments = $query->orderBy('payment_date', 'desc')->paginate($perPage);

        return response()->json($payments);
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'payee_type' => 'nullable|string', // App\Domain\Models\Wms\Vendor or Supplier
            'payee_id' => 'nullable|integer',
            'supplier_id' => 'nullable|integer',
            'amount' => 'required|numeric|min:0',
            'payment_method' => 'required|string',
            'payment_date' => 'required|date',
            'status' => 'nullable|in:pending,completed,cancelled,confirmed',
            'notes' => 'nullable|string',
            'description' => 'nullable|string',
            'payment_number' => 'nullable|string',
            'warehouse_id' => 'nullable|exists:inventory_locations,id',
            'payee_name' => 'nullable|string',
            'finance_account_id' => [
                'nullable',
                'integer',
                Rule::exists('inv_finance_accounts', 'id')->where('user_id', (int) Auth::id()),
            ],
        ]);

        $validated['payee_id'] = $validated['payee_id'] ?? $validated['supplier_id'] ?? null;
        if (! $validated['payee_id']) {
            return response()->json(['message' => 'Payee is required'], 422);
        }
        $validated['payee_type'] = $validated['payee_type'] ?? \App\Domain\Models\Wms\Supplier::class;
        $validated['status'] = $validated['status'] ?? 'pending';
        if (empty($validated['notes']) && ! empty($validated['description'])) {
            $validated['notes'] = $validated['description'];
        }
        unset($validated['supplier_id'], $validated['description']);

        $validated['user_id'] = Auth::id();
        if (empty($validated['payment_number'])) {
            $validated['payment_number'] = $this->generateNextPaymentNumber();
        }

        $ledger = app(FinanceAccountLedgerService::class);
        $ledger->ensureDefaultAccountsForUser((int) Auth::id());
        $validated['finance_account_id'] = $ledger->resolveFinanceAccountId(
            isset($validated['finance_account_id']) ? (int) $validated['finance_account_id'] : null,
            (string) ($validated['payment_method'] ?? ''),
            (int) Auth::id()
        );

        if (($validated['status'] ?? 'pending') !== 'cancelled') {
            app(TreasurySpendGuard::class)->assertPaymentAllowed((float) $validated['amount']);
        }

        DB::beginTransaction();
        try {
            $payment = Payment::create($validated);

            // If payment is settled (completed or legacy confirmed), update supplier/vendor balance immediately.
            if (in_array((string) $payment->status, ['completed', 'confirmed'], true)) {
                if ($payment->payee_type === Supplier::class || str_contains((string) $payment->payee_type, 'Supplier')) {
                    $supplier = Supplier::find($payment->payee_id);
                    if ($supplier) {
                        $supplier->balance = (float) $supplier->balance - (float) $payment->amount;
                        $supplier->save();
                        $linkedVendor = $supplier->resolveLinkedVendor();
                        if ($linkedVendor) {
                            $linkedVendor->updateBalance((float) $payment->amount, 'subtract');
                        }
                    }
                } elseif ($payment->payee_type === Vendor::class || str_contains((string) $payment->payee_type, 'Vendor')) {
                    $vendor = Vendor::find($payment->payee_id);
                    if ($vendor) {
                        // Reduce balance (we paid them)
                        $vendor->updateBalance($payment->amount, 'subtract');
                    }
                }
            }

            DB::commit();

            return response()->json($payment, 201);
        } catch (\Exception $e) {
            DB::rollBack();

            return response()->json(['message' => 'Payment failed', 'error' => $e->getMessage()], 500);
        }
    }

    /**
     * Display the specified resource.
     */
    public function show($id)
    {
        $payment = Payment::with(['user', 'payee'])->findOrFail($id);

        return response()->json($payment);
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, $id)
    {
        $payment = Payment::findOrFail($id);

        $validated = $request->validate([
            'amount' => 'sometimes|numeric',
            'status' => 'sometimes|in:pending,completed,cancelled,confirmed',
            'notes' => 'nullable|string',
            'description' => 'nullable|string',
            'payment_method' => 'sometimes|string',
            'finance_account_id' => [
                'nullable',
                'integer',
                Rule::exists('inv_finance_accounts', 'id')->where('user_id', (int) Auth::id()),
            ],
        ]);

        if (empty($validated['notes']) && ! empty($validated['description'])) {
            $validated['notes'] = $validated['description'];
        }
        unset($validated['description']);

        if (array_key_exists('finance_account_id', $validated) || array_key_exists('payment_method', $validated)) {
            $ledger = app(FinanceAccountLedgerService::class);
            $ledger->ensureDefaultAccountsForUser((int) Auth::id());
            $explicit = array_key_exists('finance_account_id', $validated)
                ? ($validated['finance_account_id'] !== null ? (int) $validated['finance_account_id'] : null)
                : null;
            $validated['finance_account_id'] = $ledger->resolveFinanceAccountId(
                $explicit,
                (string) ($validated['payment_method'] ?? $payment->payment_method ?? ''),
                (int) Auth::id()
            );
        }

        if (in_array((string) $payment->status, ['completed', 'confirmed'], true) && array_key_exists('amount', $validated)) {
            app(TreasurySpendGuard::class)->assertCompletedPaymentIncreaseAllowed(
                $payment,
                (float) ($validated['amount'] ?? $payment->amount)
            );
        }

        DB::beginTransaction();
        try {
            // Handle status change impact on balance
            $oldStatus = $payment->status;
            $newStatus = $validated['status'] ?? $oldStatus;

            // Only apply when transitioning pending -> settled (completed or confirmed).
            if ($oldStatus === 'pending' && in_array((string) $newStatus, ['completed', 'confirmed'], true)) {
                if ($payment->payee_type === Supplier::class || str_contains((string) $payment->payee_type, 'Supplier')) {
                    $supplier = Supplier::find($payment->payee_id);
                    if ($supplier) {
                        $amount = $validated['amount'] ?? $payment->amount;
                        $supplier->balance = (float) $supplier->balance - (float) $amount;
                        $supplier->save();
                        $linkedVendor = $supplier->resolveLinkedVendor();
                        if ($linkedVendor) {
                            $linkedVendor->updateBalance((float) $amount, 'subtract');
                        }
                    }
                } elseif ($payment->payee_type === Vendor::class || str_contains((string) $payment->payee_type, 'Vendor')) {
                    $vendor = Vendor::find($payment->payee_id);
                    if ($vendor) {
                        $amount = $validated['amount'] ?? $payment->amount;
                        $vendor->updateBalance($amount, 'subtract');
                    }
                }
            }

            $payment->update($validated);

            DB::commit();

            return response()->json($payment);
        } catch (\Exception $e) {
            DB::rollBack();

            return response()->json(['message' => 'Update failed', 'error' => $e->getMessage()], 500);
        }
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy($id)
    {
        // Generally payments shouldn't be deleted if completed, but for now allow soft delete pattern
        // or just strict delete.
        $payment = Payment::findOrFail($id);

        if (in_array((string) $payment->status, ['completed', 'confirmed'], true)) {
            return response()->json(['message' => 'Cannot delete completed payments. Cancel them instead.'], 403);
        }

        $payment->delete();

        return response()->json(['message' => 'Payment deleted successfully.']);
    }

    private function generateNextPaymentNumber(): string
    {
        $prefix = 'PAY-';
        $last = (string) Payment::whereNotNull('payment_number')
            ->where('payment_number', 'like', $prefix.'%')
            ->orderByDesc('id')
            ->value('payment_number');

        $lastNum = (int) preg_replace('/\D+/', '', $last ?: '');
        $next = $lastNum + 1;
        $candidate = $prefix.str_pad((string) $next, 3, '0', STR_PAD_LEFT);

        while (Payment::where('payment_number', $candidate)->exists()) {
            $next++;
            $candidate = $prefix.str_pad((string) $next, 3, '0', STR_PAD_LEFT);
        }

        return $candidate;
    }
}
