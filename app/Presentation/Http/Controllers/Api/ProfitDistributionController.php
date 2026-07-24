<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use App\Domain\Models\Wms\CapitalSource;
use App\Domain\Models\Wms\ProfitDistribution;

class ProfitDistributionController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index()
    {
        $distributions = ProfitDistribution::with(['capitalSource'])
            ->orderBy('period_end', 'desc')
            ->paginate(50);

        return response()->json($distributions);
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'period_start' => 'required|date',
            'period_end' => 'required|date',
            'total_profit' => 'required|numeric|min:0',
        ]);

        // Calculate distributions for all capital sources
        $sources = CapitalSource::all();
        $distributions = [];

        foreach ($sources as $source) {
            $percentage = $source->getOwnershipPercentage();
            if ($percentage > 0) {
                $amount = ($validated['total_profit'] * $percentage) / 100;

                $distributions[] = ProfitDistribution::create([
                    'capital_source_id' => $source->id,
                    'amount' => $amount,
                    'period_start' => $validated['period_start'],
                    'period_end' => $validated['period_end'],
                    'status' => 'pending',
                ]);
            }
        }

        return response()->json([
            'message' => 'Distributions calculated',
            'count' => count($distributions),
            'distributions' => $distributions,
        ], 201);
    }

    /**
     * Mark distribution as paid.
     */
    public function markPaid($id)
    {
        $distribution = ProfitDistribution::findOrFail($id);
        $distribution->markAsPaid();

        return response()->json(['message' => 'Marked as paid']);
    }

    /**
     * Display the specified resource.
     */
    public function show($id)
    {
        return response()->json(ProfitDistribution::with('capitalSource')->findOrFail($id));
    }
}
