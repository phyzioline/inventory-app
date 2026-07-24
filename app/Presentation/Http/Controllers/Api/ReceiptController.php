<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\Rule;
use App\Application\Services\FinanceAccountLedgerService;
use App\Application\Services\ReceiptApplicationService;
use App\Domain\Models\Wms\Receipt;

class ReceiptController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index(Request $request)
    {
        $query = Receipt::with(['user', 'reference']);

        if ($request->has('search')) {
            $search = $request->search;
            $query->where(function ($q) use ($search) {
                $q->where('receipt_number', 'like', "%{$search}%")
                    ->orWhere('payer_name', 'like', "%{$search}%")
                    ->orWhere('description', 'like', "%{$search}%")
                    ->orWhere('external_reference', 'like', "%{$search}%");
            });
        }

        if ($request->has('warehouse_id') && $request->warehouse_id !== 'all') {
            $query->where('warehouse_id', $request->warehouse_id);
        }

        if ($request->filled('start_date')) {
            $query->whereDate('receipt_date', '>=', $request->start_date);
        }
        if ($request->filled('end_date')) {
            $query->whereDate('receipt_date', '<=', $request->end_date);
        }

        $perPage = min(500, max(1, (int) $request->input('per_page', 50)));

        $receipts = $query->orderBy('receipt_date', 'desc')->paginate($perPage);

        return response()->json($receipts);
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'category' => 'nullable|string|in:customer_collection,channel_collection,compensation,general,capital,sulfa',
            'type' => 'nullable|string|max:64',
            'amount' => 'required|numeric|min:0.01',
            'description' => 'nullable|string',
            'receipt_date' => 'required|date',
            'payment_method' => 'nullable|string',
            'reference_type' => 'nullable|string',
            'reference_id' => 'nullable|integer',
            'receipt_number' => 'nullable|string',
            'warehouse_id' => 'nullable|exists:inventory_locations,id',
            'payer_name' => 'nullable|string',
            'external_reference' => 'nullable|string|max:191',
            'linked_inventory_order_id' => 'nullable|integer|exists:inventory_orders,id',
            'linked_settlement_id' => 'nullable|integer|exists:settlements,id',
            'linked_settlement_report_id' => 'nullable|string|max:191',
            'apply_payment_to_order' => 'nullable|boolean',
            'finance_account_id' => [
                'nullable',
                'integer',
                Rule::exists('inv_finance_accounts', 'id')->where('user_id', (int) Auth::id()),
            ],
        ]);

        if (($validated['warehouse_id'] ?? null) === '') {
            $validated['warehouse_id'] = null;
        }

        if (empty($validated['category'] ?? null)) {
            $validated['category'] = match (trim((string) ($validated['type'] ?? ''))) {
                'Customer Payment' => 'customer_collection',
                'Channel Collection' => 'channel_collection',
                'Compensation' => 'compensation',
                default => 'general',
            };
        }

        unset($validated['type'], $validated['reference_type'], $validated['reference_id']);

        $validated['user_id'] = Auth::id();

        if (empty($validated['receipt_number'])) {
            $validated['receipt_number'] = $this->generateNextReceiptNumber();
        }

        $receipt = app(ReceiptApplicationService::class)->create($validated);

        return response()->json($receipt->load(['user', 'reference']), 201);
    }

    /**
     * Display the specified resource.
     */
    public function show($id)
    {
        $receipt = Receipt::with(['user', 'reference'])->findOrFail($id);

        return response()->json($receipt);
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, $id)
    {
        $receipt = Receipt::findOrFail($id);

        $validated = $request->validate([
            'type' => 'sometimes|string',
            'category' => 'sometimes|string|in:customer_collection,channel_collection,compensation,general,capital,sulfa',
            'amount' => 'sometimes|numeric',
            'description' => 'nullable|string',
            'receipt_date' => 'sometimes|date',
            'payment_method' => 'nullable|string',
            'receipt_number' => 'nullable|string',
            'warehouse_id' => 'nullable|exists:inventory_locations,id',
            'payer_name' => 'nullable|string',
            'external_reference' => 'nullable|string|max:191',
            'finance_account_id' => [
                'nullable',
                'integer',
                Rule::exists('inv_finance_accounts', 'id')->where('user_id', (int) Auth::id()),
            ],
        ]);

        if (array_key_exists('finance_account_id', $validated) || array_key_exists('payment_method', $validated)) {
            $ledger = app(FinanceAccountLedgerService::class);
            $ledger->ensureDefaultAccountsForUser((int) Auth::id());
            $explicit = array_key_exists('finance_account_id', $validated)
                ? ($validated['finance_account_id'] !== null ? (int) $validated['finance_account_id'] : null)
                : null;
            $validated['finance_account_id'] = $ledger->resolveFinanceAccountId(
                $explicit,
                (string) ($validated['payment_method'] ?? $receipt->payment_method ?? ''),
                (int) Auth::id()
            );
        }

        $receipt->update($validated);

        return response()->json($receipt);
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy($id)
    {
        $receipt = Receipt::findOrFail($id);
        $receipt->delete();

        return response()->json(['message' => 'Receipt deleted successfully.']);
    }

    private function generateNextReceiptNumber(): string
    {
        $prefix = 'REC-';
        $last = (string) Receipt::whereNotNull('receipt_number')
            ->where('receipt_number', 'like', $prefix.'%')
            ->orderByDesc('id')
            ->value('receipt_number');

        $lastNum = (int) preg_replace('/\D+/', '', $last ?: '');
        $next = $lastNum + 1;
        $candidate = $prefix.str_pad((string) $next, 3, '0', STR_PAD_LEFT);

        while (Receipt::where('receipt_number', $candidate)->exists()) {
            $next++;
            $candidate = $prefix.str_pad((string) $next, 3, '0', STR_PAD_LEFT);
        }

        return $candidate;
    }
}
