<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Application\Services\CycleCountService;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CycleCountController extends Controller
{
    public function __construct(
        private readonly CycleCountService $cycleCounts,
    ) {}

    public function index(): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data' => $this->cycleCounts->list(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'location_id' => ['required', 'integer', 'exists:inventory_locations,id'],
            'notes' => ['nullable', 'string', 'max:500'],
        ]);

        $count = $this->cycleCounts->create((int) $data['location_id'], $data['notes'] ?? null);

        return response()->json(['success' => true, 'data' => $count], 201);
    }

    public function recordCounts(Request $request, int $id): JsonResponse
    {
        $data = $request->validate([
            'lines' => ['required', 'array', 'min:1'],
            'lines.*.sku_id' => ['required', 'integer'],
            'lines.*.counted_qty' => ['required', 'numeric'],
        ]);

        $count = $this->cycleCounts->recordCounts($id, $data['lines']);

        return response()->json(['success' => true, 'data' => $count]);
    }

    public function post(int $id): JsonResponse
    {
        $count = $this->cycleCounts->post($id);

        return response()->json(['success' => true, 'data' => $count]);
    }
}
