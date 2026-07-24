<?php

use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\Warehouse;
use Illuminate\Support\Facades\Broadcast;

/*
|--------------------------------------------------------------------------
| Broadcast Channel Authorization
|--------------------------------------------------------------------------
|
| Real-time event map:
|   stock.updated → inventory.user.{userId}   (App\Domain\Events\StockUpdated)
|
| Ported from the monolith's routes/channels.php (Inventory section only).
*/

// ── Current channel — one private channel per tenant, all their warehouses ────
Broadcast::channel('inventory.user.{userId}', function ($user, $userId) {
    return (int) $user->id === (int) $userId;
});

// Legacy per-warehouse channel (kept for backward compatibility during rollout,
// same as source).
Broadcast::channel('inventory.{warehouseId}', function ($user, $warehouseId) {
    $id = (int) $warehouseId;

    if (Warehouse::withoutGlobalScope('user_isolation')
        ->where('id', $id)
        ->where('user_id', $user->id)
        ->exists()) {
        return true;
    }

    return InventoryLocation::withoutGlobalScope('user_isolation')
        ->where('id', $id)
        ->where('user_id', $user->id)
        ->exists();
});
