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
            'limit' => ['nullable', 'integer', 'min:1', 'max:500'],
            'channel_id' => ['nullable', 'integer', 'exists:channels,id'],
            'vendor_id' => ['nullable', 'integer', 'exists:vendors,id'],
        ]);

        $items = $this->alerts->alerts(
            (int) ($data['limit'] ?? 200),
            isset($data['channel_id']) ? (int) $data['channel_id'] : null,
            isset($data['vendor_id']) ? (int) $data['vendor_id'] : null,
        );

        return response()->json([
            'success' => true,
            'count' => count($items),
            'data' => $items,
        ]);
    }
}
