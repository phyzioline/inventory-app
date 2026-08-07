<?php

declare(strict_types=1);

namespace App\Presentation\Http\Controllers\Api;

use App\Application\Services\DesktopSyncService;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/**
 * Offline sync for the Tauri desktop client — bootstrap/delta catalog pull
 * plus queued stock-adjustment push. Routes are protected by auth:sanctum
 * (see InventoryAuthController::login for token issuance); every query is
 * scoped by TenantContext exactly like the session-authenticated web routes.
 */
final class InventoryDesktopSyncController extends Controller
{
    public function __construct(private readonly DesktopSyncService $syncService) {}

    public function bootstrap(): JsonResponse
    {
        return response()->json($this->syncService->bootstrap());
    }

    public function delta(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'since' => ['required', 'date'],
        ]);

        return response()->json($this->syncService->delta(Carbon::parse($validated['since'])));
    }

    public function push(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'device_id' => ['required', 'string', 'max:191'],
            'operations' => ['required', 'array', 'min:1', 'max:100'],
            'operations.*.client_op_id' => ['required', 'uuid'],
            'operations.*.sku_id' => ['required', 'integer', 'exists:skus,id'],
            'operations.*.location_id' => ['required', 'integer', 'exists:inventory_locations,id'],
            'operations.*.type' => ['required', 'string', 'in:DAMAGE,LOST,THEFT,EXPIRED,CORRECTION,OPENING_BALANCE,STOCK_IN'],
            'operations.*.quantity' => ['required', 'numeric', 'min:0.01'],
            'operations.*.notes' => ['nullable', 'string'],
        ]);

        $results = $this->syncService->push($validated['device_id'], $validated['operations']);

        return response()->json(['results' => $results]);
    }
}
