<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use App\Application\Services\InventoryReturnImportService;
use App\Application\Services\InventoryReturnListingService;
use App\Application\Services\InventoryReturnMutationService;

class ReturnController extends Controller
{
    public function __construct(
        private InventoryReturnListingService $listing,
        private InventoryReturnMutationService $mutations,
        private InventoryReturnImportService $returnImports,
    ) {}

    public function index(Request $request)
    {
        return response()->json($this->listing->paginate($request));
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'inventory_order_id' => 'required|exists:inventory_orders,id',
            'platform_return_id' => 'nullable|string',
            'sku_code' => 'nullable|string|max:100',
            'return_quantity' => 'nullable|integer|min:1',
            'reason' => 'required|string',
            'disposition' => 'required|in:sellable,damaged,unsellable',
            'return_location' => 'nullable|string|max:100',
            'return_status' => 'nullable|string|max:100',
            'last_update_date' => 'nullable|date',
            'channel' => 'nullable|string|max:100',
            'financial_deduction' => 'nullable|numeric|min:0',
            'extra_shipping_fee' => 'nullable|numeric|min:0',
            'inventory_status' => 'nullable|string|max:100',
            'refund_amount' => 'nullable|numeric|min:0',
            'refund_method' => 'nullable|string|in:credit_note,cash,bank_transfer',
            'external_status' => 'nullable|string|max:255',
        ]);

        $result = $this->mutations->upsertFromValidated($validated, (int) auth()->id());

        if ($result['ignored']) {
            return response()->json([
                'message' => 'Older return update ignored',
                'return' => $result['return'],
            ], 200);
        }

        return response()->json($result['return'], 201);
    }

    public function process($id)
    {
        try {
            $this->mutations->process((int) $id);

            return response()->json(['message' => 'Return processed and inventory updated']);
        } catch (ValidationException $e) {
            $messages = $e->errors();
            $status = isset($messages['status']) ? 400 : 500;

            return response()->json(['message' => $messages[array_key_first($messages)][0] ?? 'Error'], $status);
        }
    }

    public function receive($id)
    {
        $return = $this->mutations->receive((int) $id);

        return response()->json([
            'message' => 'Return received',
            'return' => $return,
        ]);
    }

    public function show($id)
    {
        return response()->json($this->mutations->findWithLoss((int) $id));
    }

    public function update(Request $request, $id)
    {
        $validated = $request->validate([
            'status' => 'sometimes|string|in:pending,in_transit,approved,rejected,completed',
            'reason' => 'nullable|string',
            'disposition' => 'sometimes|in:sellable,damaged,unsellable',
            'refund_amount' => 'nullable|numeric|min:0',
            'refund_method' => 'nullable|string|in:credit_note,cash,bank_transfer',
            'external_status' => 'nullable|string|max:255',
            'return_location' => 'nullable|string|max:100',
            'return_status' => 'nullable|string|max:100',
            'last_update_date' => 'nullable|date',
            'channel' => 'nullable|string|max:100',
            'financial_deduction' => 'nullable|numeric|min:0',
            'extra_shipping_fee' => 'nullable|numeric|min:0',
            'inventory_status' => 'nullable|string|max:100',
        ]);

        $result = $this->mutations->updateFromValidated((int) $id, $validated);

        if ($result['invalid_transition']) {
            return response()->json([
                'message' => "Invalid return status transition from '{$result['from']}' to '{$result['to']}'",
            ], 422);
        }

        if ($result['ignored']) {
            return response()->json([
                'message' => 'Older return update ignored',
                'return' => $result['return'],
            ], 200);
        }

        return response()->json([
            'message' => 'Return updated successfully',
            'return' => $result['return'],
        ]);
    }

    public function import(Request $request)
    {
        return $this->returnImports->importFromRequest($request);
    }

    public function importInventoryLedger(Request $request)
    {
        return $this->returnImports->importLedgerFromRequest($request);
    }
}
