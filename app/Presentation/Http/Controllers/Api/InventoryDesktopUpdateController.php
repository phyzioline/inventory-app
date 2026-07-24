<?php

declare(strict_types=1);

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
use App\Application\Services\TauriDesktopUpdateService;

/**
 * Tauri auto-updater for the Inventory Warehouse desktop app.
 *
 * GET /api/v1/inventory/desktop/update/{target}/{arch}/{current_version}
 */
final class InventoryDesktopUpdateController extends Controller
{
    private function updater(): TauriDesktopUpdateService
    {
        return new TauriDesktopUpdateService('inventory_downloads', 'Phyzioline Inventory');
    }

    public function check(string $target, string $arch, string $current): JsonResponse|Response
    {
        return $this->updater()->check($target, $current);
    }

    public function latest(): JsonResponse
    {
        return $this->updater()->latest();
    }
}
