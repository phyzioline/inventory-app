<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use App\Application\Services\InventoryAdjustmentService;
use App\Domain\Models\Wms\InventoryAdjustment;

class InventoryAdjustmentController extends Controller
{
    protected $adjustmentService;

    public function __construct(InventoryAdjustmentService $adjustmentService)
    {
        $this->adjustmentService = $adjustmentService;
    }

    public function index(Request $request)
    {
        $adjustments = InventoryAdjustment::with(['sku.offer.masterProduct', 'location', 'user'])
            ->orderBy('created_at', 'desc')
            ->paginate(50);

        return response()->json($adjustments);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'sku_id' => 'required|exists:skus,id',
            'location_id' => 'required|exists:inventory_locations,id',
            'type' => 'required|string|in:DAMAGE,LOST,THEFT,EXPIRED,CORRECTION,RETURN_TO_VENDOR,OPENING_BALANCE,STOCK_IN',
            'quantity' => 'required|numeric|min:0.01',
            'notes' => 'nullable|string',
        ]);

        try {
            $result = $this->adjustmentService->adjust($validated);

            return response()->json($result, 201);
        } catch (\Exception $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }
    }
}
