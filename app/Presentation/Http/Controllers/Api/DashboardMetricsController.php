<?php

declare(strict_types=1);

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use App\Application\Services\DashboardMetricsService;

class DashboardMetricsController extends Controller
{
    public function __construct(
        private readonly DashboardMetricsService $metrics,
    ) {}

    public function index(Request $request)
    {
        $validated = $request->validate([
            'start_date' => 'required|date',
            'end_date' => 'required|date|after_or_equal:start_date',
            'low_stock_limit' => 'nullable|integer|min:1|max:50',
        ]);

        return response()->json(
            $this->metrics->forPeriod(
                $validated['start_date'],
                $validated['end_date'],
                (int) ($validated['low_stock_limit'] ?? 20),
            )
        );
    }
}
