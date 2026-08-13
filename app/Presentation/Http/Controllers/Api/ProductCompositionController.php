<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Application\Services\ProductCompositionService;
use App\Http\Controllers\Controller;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\ProductComposition;
use App\Domain\Models\Wms\Sku;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ProductCompositionController extends Controller
{
    public function __construct(
        private readonly ProductCompositionService $compositions,
    ) {}

    /**
     * This offer's own components (it as the kit), and where it's used as someone else's component.
     */
    public function index(string $id)
    {
        $offer = InventoryOffer::findOrFail($id);

        return response()->json([
            'offer_id' => (int) $offer->id,
            'components' => $offer->components()
                ->with(['componentOffer.masterProduct', 'componentOffer.skus.channel'])
                ->get(),
            'used_in' => $offer->usedInCompositions()
                ->with(['parentOffer.masterProduct', 'parentOffer.skus.channel'])
                ->get(),
        ]);
    }

    public function store(Request $request, string $id)
    {
        $parent = InventoryOffer::findOrFail($id);

        $validated = $request->validate([
            'component_offer_id' => ['required', 'integer', 'exists:inventory_offers,id'],
            'quantity_per' => ['required', 'integer', 'min:1'],
            'notes' => ['nullable', 'string', 'max:255'],
        ]);

        $component = InventoryOffer::findOrFail($validated['component_offer_id']);

        $composition = $this->compositions->attachComponent(
            $parent,
            $component,
            (int) $validated['quantity_per'],
            $validated['notes'] ?? null,
        );

        return response()->json($composition->load('componentOffer.masterProduct'), 201);
    }

    public function update(Request $request, string $compositionId)
    {
        $composition = ProductComposition::findOrFail($compositionId);

        $validated = $request->validate([
            'quantity_per' => ['required', 'integer', 'min:1'],
            'notes' => ['nullable', 'string', 'max:255'],
        ]);

        $this->compositions->updateComponent(
            $composition,
            (int) $validated['quantity_per'],
            $validated['notes'] ?? null,
        );

        return response()->json($composition->fresh()->load('componentOffer.masterProduct'));
    }

    public function destroy(string $compositionId)
    {
        $composition = ProductComposition::findOrFail($compositionId);
        $this->compositions->detachComponent($composition);

        return response()->json(null, 204);
    }

    public function unpack(Request $request, string $id)
    {
        $parentOffer = InventoryOffer::findOrFail($id);
        $validated = $this->validateConversionRequest($request);
        $componentOffer = InventoryOffer::findOrFail($validated['component_offer_id']);
        $parentSku = Sku::findOrFail($validated['parent_sku_id']);
        $componentSku = Sku::findOrFail($validated['component_sku_id']);

        $result = DB::transaction(fn () => $this->compositions->unpack(
            $parentOffer,
            $componentOffer,
            $parentSku,
            (int) $validated['parent_location_id'],
            $componentSku,
            (int) $validated['component_location_id'],
            (int) $validated['quantity'],
            $validated['notes'] ?? null,
            $validated['client_operation_id'] ?? null,
        ));

        return response()->json($result);
    }

    public function pack(Request $request, string $id)
    {
        $parentOffer = InventoryOffer::findOrFail($id);
        $validated = $this->validateConversionRequest($request);
        $componentOffer = InventoryOffer::findOrFail($validated['component_offer_id']);
        $parentSku = Sku::findOrFail($validated['parent_sku_id']);
        $componentSku = Sku::findOrFail($validated['component_sku_id']);

        $result = DB::transaction(fn () => $this->compositions->pack(
            $parentOffer,
            $componentOffer,
            $componentSku,
            (int) $validated['component_location_id'],
            $parentSku,
            (int) $validated['parent_location_id'],
            (int) $validated['quantity'],
            $validated['notes'] ?? null,
            $validated['client_operation_id'] ?? null,
        ));

        return response()->json($result);
    }

    private function validateConversionRequest(Request $request): array
    {
        return $request->validate([
            'component_offer_id' => ['required', 'integer', 'exists:inventory_offers,id'],
            'parent_sku_id' => ['required', 'integer', 'exists:skus,id'],
            'parent_location_id' => ['required', 'integer', 'exists:inventory_locations,id'],
            'component_sku_id' => ['required', 'integer', 'exists:skus,id'],
            'component_location_id' => ['required', 'integer', 'exists:inventory_locations,id'],
            'quantity' => ['required', 'integer', 'min:1'],
            'notes' => ['nullable', 'string', 'max:500'],
            'client_operation_id' => ['nullable', 'string', 'max:100'],
        ]);
    }
}
