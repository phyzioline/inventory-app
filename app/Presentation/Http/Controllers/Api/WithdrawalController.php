<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use App\Domain\Models\Wms\Withdrawal;

class WithdrawalController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index()
    {
        $withdrawals = Withdrawal::with(['capitalSource'])
            ->orderBy('created_at', 'desc')
            ->paginate(50);

        return response()->json($withdrawals);
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'capital_source_id' => 'required|exists:capital_sources,id',
            'amount' => 'required|numeric|min:0',
            'reason' => 'required|string',
        ]);

        $validated['status'] = 'pending';

        $withdrawal = Withdrawal::create($validated);

        return response()->json($withdrawal, 201);
    }

    /**
     * Approve withdrawal.
     */
    public function approve($id)
    {
        $withdrawal = Withdrawal::findOrFail($id);
        $this->authorize('approve-withdrawal', $withdrawal);
        if ($withdrawal->status !== 'pending') {
            return response()->json(['message' => 'Can only approve pending withdrawals'], 400);
        }

        $withdrawal->approve();

        return response()->json(['message' => 'Withdrawal approved']);
    }

    /**
     * Complete withdrawal (paid out).
     */
    public function complete($id)
    {
        $withdrawal = Withdrawal::findOrFail($id);
        if ($withdrawal->status !== 'approved') {
            return response()->json(['message' => 'Withdrawal must be approved first'], 400);
        }

        $withdrawal->complete();

        return response()->json(['message' => 'Withdrawal completed']);
    }

    /**
     * Display the specified resource.
     */
    public function show($id)
    {
        return response()->json(Withdrawal::with('capitalSource')->findOrFail($id));
    }
}
