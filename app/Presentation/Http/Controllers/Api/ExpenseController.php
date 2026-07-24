<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\Rule;
use App\Application\Services\FinanceAccountLedgerService;
use App\Application\Services\TreasurySpendGuard;
use App\Domain\Models\Wms\Expense;

class ExpenseController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index(Request $request)
    {
        $query = Expense::with(['user', 'reference']);

        // Search text
        if ($request->has('search')) {
            $search = $request->search;
            $query->where(function ($q) use ($search) {
                $q->where('description', 'like', "%{$search}%")
                    ->orWhere('vendor_name', 'like', "%{$search}%")
                    ->orWhere('expense_number', 'like', "%{$search}%");
            });
        }

        // Filters
        if ($request->has('category') && $request->category !== 'all') {
            $query->where('category', $request->category);
        }
        if ($request->has('warehouse_id') && $request->warehouse_id !== 'all') {
            $query->where('warehouse_id', $request->warehouse_id);
        }
        if ($request->has('start_date')) {
            $query->whereDate('expense_date', '>=', $request->start_date);
        }
        if ($request->has('end_date')) {
            $query->whereDate('expense_date', '<=', $request->end_date);
        }

        $perPage = min(500, max(1, (int) $request->input('per_page', 100)));

        $expenses = $query->orderBy('expense_date', 'desc')->paginate($perPage);

        return response()->json($expenses);
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'category' => 'required|string',
            'amount' => 'required|numeric|min:0',
            'description' => 'nullable|string',
            'expense_date' => 'required|date',
            'warehouse_id' => 'nullable|exists:inventory_locations,id',
            'payment_method' => 'nullable|string',
            'vendor_name' => 'nullable|string',
            'expense_number' => 'nullable|string',
            'reference_type' => 'nullable|string',
            'reference_id' => 'nullable|integer',
            'finance_account_id' => [
                'nullable',
                'integer',
                Rule::exists('inv_finance_accounts', 'id')->where('user_id', (int) Auth::id()),
            ],
        ]);

        // Map category to type for backward compatibility if needed, but we added category column
        $validated['type'] = $validated['category'];
        $validated['user_id'] = Auth::id();
        if (empty($validated['expense_number'])) {
            $validated['expense_number'] = $this->generateNextExpenseNumber();
        }

        $ledger = app(FinanceAccountLedgerService::class);
        $ledger->ensureDefaultAccountsForUser((int) Auth::id());
        $validated['finance_account_id'] = $ledger->resolveFinanceAccountId(
            isset($validated['finance_account_id']) ? (int) $validated['finance_account_id'] : null,
            (string) ($validated['payment_method'] ?? ''),
            (int) Auth::id()
        );

        app(TreasurySpendGuard::class)->assertExpenseAllowed((float) $validated['amount']);

        $expense = Expense::create($validated);
        $expense->load(['user', 'reference']);

        return response()->json($expense, 201);
    }

    /**
     * Display the specified resource.
     */
    public function show($id)
    {
        $expense = Expense::with(['user', 'reference'])->findOrFail($id);

        return response()->json($expense);
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, $id)
    {
        $expense = Expense::findOrFail($id);

        $validated = $request->validate([
            'category' => 'sometimes|string',
            'amount' => 'sometimes|numeric',
            'description' => 'nullable|string',
            'expense_date' => 'sometimes|date',
            'warehouse_id' => 'nullable|exists:inventory_locations,id',
            'payment_method' => 'nullable|string',
            'vendor_name' => 'nullable|string',
            'expense_number' => 'nullable|string',
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
                (string) ($validated['payment_method'] ?? $expense->payment_method ?? ''),
                (int) Auth::id()
            );
        }

        if (array_key_exists('amount', $validated) && (float) $validated['amount'] > (float) $expense->amount + 0.00001) {
            app(TreasurySpendGuard::class)->assertExpenseIncreaseAllowed((float) $expense->amount, (float) $validated['amount'], (int) $expense->user_id);
        }

        $expense->update($validated);

        return response()->json($expense);
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy($id)
    {
        $expense = Expense::findOrFail($id);
        $expense->delete();

        return response()->json(['message' => 'Expense deleted successfully.']);
    }

    private function generateNextExpenseNumber(): string
    {
        $prefix = 'EXP-';
        $last = (string) Expense::whereNotNull('expense_number')
            ->where('expense_number', 'like', $prefix.'%')
            ->orderByDesc('id')
            ->value('expense_number');

        $lastNum = (int) preg_replace('/\D+/', '', $last ?: '');
        $next = $lastNum + 1;
        $candidate = $prefix.str_pad((string) $next, 3, '0', STR_PAD_LEFT);

        while (Expense::where('expense_number', $candidate)->exists()) {
            $next++;
            $candidate = $prefix.str_pad((string) $next, 3, '0', STR_PAD_LEFT);
        }

        return $candidate;
    }
}
