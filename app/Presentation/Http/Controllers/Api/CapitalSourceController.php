<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use App\Application\Services\CapitalReceiptWriter;
use App\Domain\Models\Wms\CapitalSource;

class CapitalSourceController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index()
    {
        $sources = CapitalSource::withSum('profitDistributions as total_distributed', 'amount')
            ->withSum('withdrawals as total_withdrawn', 'amount')
            ->get();

        // Append calculated fields
        $sources->each(function ($source) {
            $source->net_position = $source->getNetPosition();
            $source->ownership_percentage = $source->getOwnershipPercentage();
        });

        return response()->json($sources);
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        \Log::info('CapitalSource Store Request:', $request->all());

        try {
            $validated = $request->validate([
                'name' => 'required|string|max:255',
                'type' => 'required|string|max:100',
                'amount' => 'required|numeric|min:0',
                'ownership_percentage' => 'nullable|numeric|min:0|max:100',
                'receipt_date' => 'nullable|date',
            ]);

            // Automatically assign user_id
            if ($request->user()) {
                $validated['user_id'] = $request->user()->id;
            }

            $receiptDate = $validated['receipt_date'] ?? null;
            unset($validated['receipt_date']);

            $source = DB::transaction(function () use ($validated, $receiptDate) {
                $source = CapitalSource::create($validated);
                app(CapitalReceiptWriter::class)->syncFromSource($source, $receiptDate);

                return $source;
            });

            return response()->json($source, 201);
        } catch (\Illuminate\Validation\ValidationException $e) {
            \Log::error('CapitalSource Validation Error:', $e->errors());

            return response()->json(['errors' => $e->errors()], 422);
        } catch (\Exception $e) {
            \Log::error('CapitalSource Creation Error: '.$e->getMessage());

            return response()->json(['message' => 'Error creating capital source', 'error' => $e->getMessage()], 500);
        }
    }

    /**
     * Display the specified resource.
     */
    public function show($id)
    {
        $source = CapitalSource::with(['profitDistributions', 'withdrawals'])->findOrFail($id);
        $source->net_position = $source->getNetPosition();
        $source->ownership_percentage = $source->getOwnershipPercentage();

        return response()->json($source);
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, $id)
    {
        $source = CapitalSource::findOrFail($id);

        $validated = $request->validate([
            'name' => 'sometimes|string|max:255',
            'type' => 'sometimes|string|max:100',
            'amount' => 'sometimes|numeric|min:0',
            'ownership_percentage' => 'sometimes|numeric|min:0|max:100',
            'receipt_date' => 'nullable|date',
        ]);

        $receiptDate = $validated['receipt_date'] ?? null;
        unset($validated['receipt_date']);

        DB::transaction(function () use ($source, $validated, $receiptDate) {
            $source->update($validated);
            $source->refresh();
            app(CapitalReceiptWriter::class)->syncFromSource($source, $receiptDate);
        });

        return response()->json($source->fresh());
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy($id)
    {
        $source = CapitalSource::findOrFail($id);

        // Prevent delete if has relations
        if ($source->profitDistributions()->exists() || $source->withdrawals()->exists()) {
            return response()->json(['message' => 'Cannot delete capital source with history.'], 409);
        }

        DB::transaction(function () use ($source) {
            app(CapitalReceiptWriter::class)->deleteForSource($source);
            $source->delete();
        });

        return response()->json(['message' => 'Capital source deleted successfully.']);
    }
}
