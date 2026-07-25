<?php

declare(strict_types=1);

namespace App\Presentation\Http\Controllers\Api\Admin;

use App\Application\Services\DashboardMetricsService;
use App\Http\Controllers\Controller;
use Illuminate\Http\Request;

class AdminDashboardController extends Controller
{
    public function __construct(
        private readonly DashboardMetricsService $metrics,
    ) {}

    public function overview(Request $request)
    {
        $threshold = (int) $request->integer('low_stock_threshold', 10);

        return response()->json($this->metrics->adminCrossTenantOverview($threshold));
    }
}
