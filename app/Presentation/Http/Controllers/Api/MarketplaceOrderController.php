<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use App\Application\Services\MarketplaceImportService;

class MarketplaceOrderController extends Controller
{
    protected $importService;

    public function __construct(MarketplaceImportService $importService)
    {
        $this->importService = $importService;
    }

    /**
     * Import marketplace orders from CSV.
     */
    public function import(Request $request): JsonResponse
    {
        if (function_exists('set_time_limit')) {
            @set_time_limit(600);
        }

        $lockChannel = (bool) $request->boolean('lock_channel', false);

        if (! $request->hasFile('file') || $request->file('file')->getSize() === 0) {
            return response()->json([
                'message' => 'Import blocked',
                'error' => 'Please upload a non-empty CSV, TXT, or Excel file.',
                'details' => ['import_blocked' => true],
            ], 422);
        }

        $request->validate([
            'channel_id' => ($lockChannel ? 'required' : 'nullable').'|exists:channels,id',
            'file' => 'required|file|mimes:csv,txt,xlsx,xls',
            'lock_channel' => 'nullable|boolean',
        ]);

        try {
            $results = $this->importService->import(
                $request->file('file'),
                (int) $request->input('channel_id', 0),
                $lockChannel
            );

            return response()->json([
                'message' => 'Import processed',
                'details' => $results,
            ]);
        } catch (ValidationException $e) {
            $messages = $e->errors();
            $first = '';
            foreach ($messages as $vals) {
                if (is_array($vals) && isset($vals[0])) {
                    $first = (string) $vals[0];
                    break;
                }
            }

            return response()->json([
                'message' => 'Import blocked',
                'error' => $first !== '' ? $first : $e->getMessage(),
                'details' => ['import_blocked' => true],
            ], 422);
        } catch (\Throwable $e) {
            report($e);

            return response()->json([
                'message' => 'Import failed',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Preview marketplace orders import result (no DB write).
     */
    public function preview(Request $request): JsonResponse
    {
        if (function_exists('set_time_limit')) {
            @set_time_limit(600);
        }

        $lockChannel = (bool) $request->boolean('lock_channel', false);
        $request->validate([
            'channel_id' => ($lockChannel ? 'required' : 'nullable').'|exists:channels,id',
            'file' => 'required|file|mimes:csv,txt,xlsx,xls',
            'lock_channel' => 'nullable|boolean',
        ]);

        try {
            $preview = $this->importService->preview(
                $request->file('file'),
                (int) $request->input('channel_id', 0),
                $lockChannel
            );

            return response()->json([
                'message' => 'Preview generated',
                'details' => $preview,
            ]);
        } catch (\Throwable $e) {
            report($e);

            return response()->json([
                'message' => 'Preview failed',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Whether the current user can roll back stock from the last marketplace order import (cached batch).
     */
    public function lastBatch(): JsonResponse
    {
        return response()->json($this->importService->lastStockDeductionBatchSnapshot());
    }

    /**
     * Restock SKUs by reversing OUT lines recorded during the last marketplace order import for this user.
     */
    public function rollbackLast(): JsonResponse
    {
        try {
            $details = $this->importService->rollbackLastStockDeductionBatch();

            return response()->json([
                'message' => 'Last import stock deductions reversed',
                'details' => $details,
            ]);
        } catch (\Throwable $e) {
            return response()->json([
                'message' => $e->getMessage(),
            ], 422);
        }
    }
}
