<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use App\Application\Services\SulfaCashMirrorService;
use App\Application\Services\TreasuryLedgerService;
use App\Domain\Models\Wms\Receipt;
use App\Domain\Models\Wms\TreasuryCashTransaction;
use App\Domain\Models\Wms\TreasurySulfa;
use Throwable;

class TreasurySulfaController extends Controller
{
    public function summary(TreasuryLedgerService $ledger): JsonResponse
    {
        $uid = (int) Auth::id();
        $account = $ledger->getOrCreateDefaultTreasuryAccount($uid);
        $aid = (int) $account->id;

        $borrowIn = (float) Receipt::query()
            ->where('user_id', $uid)
            ->where('reference_type', TreasurySulfa::class)
            ->sum('amount');

        $repayOut = (float) TreasuryCashTransaction::where('user_id', $uid)
            ->where('treasury_account_id', $aid)
            ->where('direction', 'out')
            ->where('tx_type', TreasuryLedgerService::TX_SULFA_REPAY)
            ->sum('amount');

        $outstanding = (float) TreasurySulfa::where('user_id', $uid)
            ->where('status', 'open')
            ->get()
            ->sum(fn (TreasurySulfa $s) => max(0.0, (float) $s->principal_amount - (float) $s->amount_paid));

        return response()->json([
            'treasury_account_id' => $aid,
            'ledger_balance' => $ledger->ledgerBalance($aid, $uid),
            'sulfa_borrow_total' => round($borrowIn, 2),
            'sulfa_repay_total' => round($repayOut, 2),
            'sulfa_outstanding_principal' => round($outstanding, 2),
            'open_sulfas_count' => TreasurySulfa::where('user_id', $uid)->where('status', 'open')->count(),
        ]);
    }

    public function index(Request $request): JsonResponse
    {
        $perPage = min(200, max(1, (int) $request->input('per_page', 50)));
        $rows = TreasurySulfa::query()
            ->orderByDesc('borrowed_on')
            ->orderByDesc('id')
            ->paginate($perPage);

        return response()->json($rows);
    }

    public function store(Request $request, TreasuryLedgerService $ledger, SulfaCashMirrorService $mirror): JsonResponse
    {
        $validated = $request->validate([
            'lender_name' => 'required|string|max:255',
            'principal_amount' => 'required|numeric|min:0.01',
            'borrowed_on' => 'required|date',
            'due_on' => 'nullable|date',
            'notes' => 'nullable|string|max:2000',
        ]);

        try {
            $sulfa = DB::transaction(function () use ($validated, $ledger, $mirror) {
                $account = $ledger->getOrCreateDefaultTreasuryAccount();
                $principal = round((float) $validated['principal_amount'], 2);

                $row = TreasurySulfa::create([
                    'user_id' => (int) Auth::id(),
                    'treasury_account_id' => (int) $account->id,
                    'lender_name' => $validated['lender_name'],
                    'principal_amount' => $principal,
                    'amount_paid' => 0,
                    'status' => 'open',
                    'borrowed_on' => $validated['borrowed_on'],
                    'due_on' => $validated['due_on'] ?? null,
                    'notes' => $validated['notes'] ?? null,
                ]);

                $ledger->record(
                    (int) $account->id,
                    'in',
                    $principal,
                    TreasuryLedgerService::TX_SULFA_BORROW,
                    (string) $validated['borrowed_on'],
                    (int) $row->id,
                    TreasurySulfa::class,
                    (int) $row->id,
                    'Sulfa borrowed',
                );

                $mirror->syncBorrowReceipt($row->fresh());

                return $row;
            });
        } catch (Throwable $e) {
            return response()->json([
                'message' => config('app.debug') ? $e->getMessage() : __('Could not create sulfa.'),
            ], 422);
        }

        return response()->json($sulfa->fresh(), 201);
    }

    public function repay(Request $request, int $id, TreasuryLedgerService $ledger, SulfaCashMirrorService $mirror): JsonResponse
    {
        $sulfa = TreasurySulfa::findOrFail($id);

        $validated = $request->validate([
            'amount' => 'required|numeric|min:0.01',
            'paid_on' => 'required|date',
            'memo' => 'nullable|string|max:500',
        ]);

        if ($sulfa->status !== 'open') {
            return response()->json(['message' => __('This sulfa is not open for repayment.')], 422);
        }

        $remaining = max(0.0, (float) $sulfa->principal_amount - (float) $sulfa->amount_paid);
        $pay = round((float) $validated['amount'], 2);
        if ($pay > $remaining + 0.0001) {
            return response()->json([
                'message' => __('Amount exceeds remaining principal.'),
                'remaining_principal' => round($remaining, 2),
            ], 422);
        }

        try {
            app(\App\Application\Services\TreasurySpendGuard::class)->assertExpenseAllowed($pay);

            DB::transaction(function () use ($sulfa, $pay, $validated, $ledger, $mirror) {
                $ledger->record(
                    (int) $sulfa->treasury_account_id,
                    'out',
                    $pay,
                    TreasuryLedgerService::TX_SULFA_REPAY,
                    (string) $validated['paid_on'],
                    (int) $sulfa->id,
                    TreasurySulfa::class,
                    (int) $sulfa->id,
                    $validated['memo'] ?? 'Sulfa repayment',
                );

                $mirror->createRepayExpense(
                    $sulfa,
                    $pay,
                    (string) $validated['paid_on'],
                    $validated['memo'] ?? null,
                );

                $newPaid = round((float) $sulfa->amount_paid + $pay, 2);
                $sulfa->amount_paid = $newPaid;
                if ($newPaid + 0.0001 >= (float) $sulfa->principal_amount) {
                    $sulfa->status = 'settled';
                }
                $sulfa->save();
            });
        } catch (Throwable $e) {
            return response()->json([
                'message' => config('app.debug') ? $e->getMessage() : __('Could not record repayment.'),
            ], 422);
        }

        return response()->json($sulfa->fresh());
    }
}
