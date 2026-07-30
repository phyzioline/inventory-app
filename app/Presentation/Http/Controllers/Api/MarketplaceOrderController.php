<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Application\Services\InventoryAbilityService;
use App\Application\Services\MarketplaceImportService;
use App\Http\Controllers\Controller;
use App\Presentation\Http\Requests\MarketplaceImportRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

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
    public function import(MarketplaceImportRequest $request): JsonResponse
    {
        app(InventoryAbilityService::class)->assertCan('marketplace.import');

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

        // Optional async path: store file and queue ProcessMarketplaceImportJob (202 + job_key).
        if ($request->boolean('async')) {
            $userId = (int) $request->user()->id;
            $jobKey = 'mktimp_'.$userId.'_'.uniqid('', true);
            $stored = $request->file('file')->storeAs(
                'marketplace-imports/'.$userId,
                $jobKey.'_'.$request->file('file')->getClientOriginalName(),
                'local'
            );
            \App\Infrastructure\Jobs\ProcessMarketplaceImportJob::dispatch(
                $userId,
                (int) $request->input('channel_id', 0),
                $lockChannel,
                $stored,
                $request->file('file')->getClientOriginalName(),
                $jobKey,
            );
            \Illuminate\Support\Facades\Cache::put('marketplace_import_job:'.$jobKey, [
                'status' => 'queued',
                'updated_at' => now()->toIso8601String(),
            ], now()->addHours(6));

            return response()->json([
                'message' => 'Import queued',
                'job_key' => $jobKey,
                'status_url' => '/api/inventory/marketplace/import/jobs/'.$jobKey,
            ], 202);
        }

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
     * Poll async marketplace import job status (Cache-backed).
     */
    public function importJobStatus(string $jobKey): JsonResponse
    {
        $payload = \Illuminate\Support\Facades\Cache::get('marketplace_import_job:'.$jobKey);
        if (! is_array($payload)) {
            return response()->json(['message' => 'Job not found'], 404);
        }

        return response()->json($payload);
    }

    /**
     * Preview marketplace orders import result (no DB write).
     */
    public function preview(Request $request): JsonResponse
    {
        app(InventoryAbilityService::class)->assertCan('marketplace.import');

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
        $this->authorize('rollback-marketplace-import');

        try {
            $details = $this->importService->rollbackLastStockDeductionBatch();
            app(\App\Application\Services\InventoryAuditLogService::class)->record(
                'marketplace_import.rollback_last',
                null,
                null,
                is_array($details) ? $details : ['details' => $details],
            );

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

    /**
     * Preview or run batch retry of pending import stock deductions (no sheet re-upload).
     */
    public function retryStockDeductions(Request $request): JsonResponse
    {
        if (function_exists('set_time_limit')) {
            @set_time_limit(600);
        }

        $data = $request->validate([
            'since' => 'nullable|date',
            'until' => 'nullable|date',
            'days' => 'nullable|integer|min:0|max:366',
            'only_shortage' => 'nullable|boolean',
            'dry_run' => 'nullable|boolean',
            'limit' => 'nullable|integer|min:1|max:5000',
        ]);

        $since = $data['since'] ?? null;
        if ($since === null && isset($data['days'])) {
            $since = now()->subDays((int) $data['days'])->startOfDay()->toDateTimeString();
        }

        try {
            $details = $this->importService->retryPendingStockDeductions([
                'user_id' => (int) $request->user()->id,
                'since' => $since,
                'until' => $data['until'] ?? null,
                'dry_run' => (bool) ($data['dry_run'] ?? false),
                'only_shortage' => (bool) ($data['only_shortage'] ?? false),
                'limit' => $data['limit'] ?? null,
            ]);

            return response()->json([
                'message' => ! empty($details['dry_run'])
                    ? 'Pending deduction preview'
                    : 'Pending deductions processed',
                'details' => $details,
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
                'message' => 'Retry blocked',
                'error' => $first !== '' ? $first : $e->getMessage(),
            ], 422);
        } catch (\Throwable $e) {
            report($e);

            return response()->json([
                'message' => 'Retry failed',
                'error' => $e->getMessage(),
            ], 500);
        }
    }
}
