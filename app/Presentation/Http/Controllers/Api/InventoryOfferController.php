<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use App\Domain\Models\Wms\InventoryOffer;

class InventoryOfferController extends Controller
{
    public function index(Request $request)
    {
        $query = InventoryOffer::with(['masterProduct', 'skus']);

        if ($request->has('master_product_id')) {
            $query->where('master_product_id', $request->master_product_id);
        }

        return response()->json($query->get());
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'master_product_id' => 'required|exists:master_products,id',
            'name' => 'required|string',
            'type' => 'required|string', // single, bundle
            'components' => 'nullable|array', // if bundle, list of other products/offers
            'description' => 'nullable|string',
        ]);

        $offer = InventoryOffer::create($validated);

        return response()->json($offer->load(['masterProduct', 'skus']), 201);
    }

    public function show(string $id)
    {
        return response()->json(InventoryOffer::with(['masterProduct', 'skus'])->findOrFail($id));
    }

    public function update(Request $request, string $id)
    {
        $offer = InventoryOffer::findOrFail($id);

        $validated = $request->validate([
            'master_product_id' => 'sometimes|exists:master_products,id',
            'name' => 'sometimes|string|max:255',
            'type' => 'sometimes|string|max:50',
            'components' => 'nullable|array',
        ]);

        $offer->update($validated);

        return response()->json($offer->load(['masterProduct', 'skus']));
    }

    public function destroy(string $id)
    {
        InventoryOffer::destroy($id);

        return response()->json(null, 204);
    }
}
