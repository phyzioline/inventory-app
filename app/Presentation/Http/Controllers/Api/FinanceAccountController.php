<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use App\Application\Services\FinanceAccountLedgerService;
use App\Domain\Models\Wms\FinanceAccount;

class FinanceAccountController extends Controller
{
    public function index(): JsonResponse
    {
        $uid = (int) Auth::id();
        app(FinanceAccountLedgerService::class)->ensureDefaultAccountsForUser($uid);

        $rows = FinanceAccount::query()
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();

        return response()->json($rows);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:191',
            'account_type' => 'required|string|in:cash,bank,wallet',
            'opening_balance' => 'nullable|numeric',
            'currency' => 'nullable|string|max:8',
            'sort_order' => 'nullable|integer|min:0|max:65535',
        ]);

        $validated['user_id'] = Auth::id();
        $validated['opening_balance'] = $validated['opening_balance'] ?? 0;
        $validated['currency'] = $validated['currency'] ?? 'EGP';
        $validated['sort_order'] = $validated['sort_order'] ?? 100;

        $account = FinanceAccount::create($validated);

        return response()->json($account, 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $account = FinanceAccount::whereKey($id)->firstOrFail();

        $validated = $request->validate([
            'name' => 'sometimes|string|max:191',
            'opening_balance' => 'sometimes|numeric',
            'sort_order' => 'sometimes|integer|min:0|max:65535',
        ]);

        $account->update($validated);

        return response()->json($account);
    }
}
