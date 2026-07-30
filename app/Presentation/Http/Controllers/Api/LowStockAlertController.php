<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Application\Services\InventoryAbilityService;
use App\Application\Services\LowStockAlertService;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LowStockAlertController extends Controller
{
    public function __construct(
        private readonly LowStockAlertService $alerts,
        private readonly InventoryAbilityService $abilities,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $this->abilities->assertCan('stock.read');

        $data = $request->validate([
            'limit' => ['nullable', 'integer', 'min:1', 'max:200'],
        ]);

        $items = $this->alerts->alerts((int) ($data['limit'] ?? 50));

        return response()->json([
            'success' => true,
            'count' => count($items),
            'data' => $items,
        ]);
    }
}
