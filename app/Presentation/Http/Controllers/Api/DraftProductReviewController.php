<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use App\Domain\Models\Wms\DraftMasterProduct;

class DraftProductReviewController extends Controller
{
    public function index(Request $request)
    {
        $status = $request->get('status', 'pending');

        // "finished" = approved OR merged (products successfully added to Master)
        $query = DraftMasterProduct::with('matchedProduct');

        if ($status === 'finished' || $status === 'approved') {
            $query->whereIn('status', ['approved', 'merged'])
                ->orderBy('updated_at', 'desc'); // Most recently processed first
        } else {
            $query->where('status', $status)
                ->orderBy('match_confidence', 'asc')
                ->orderBy('created_at', 'desc');
        }

        $drafts = $query->get();

        return response()->json($drafts);
    }

    public function show($id)
    {
        $draft = DraftMasterProduct::with('matchedProduct')->findOrFail($id);

        return response()->json($draft);
    }

    public function process(Request $request, $id)
    {
        $request->validate([
            'action' => 'required|in:create_new,link_existing,skip,reject',
            'matched_product_id' => 'nullable|exists:master_products,id',
        ]);

        $draft = DraftMasterProduct::findOrFail($id);

        DB::beginTransaction();
        try {
            $draft->user_action = $request->action;

            if ($request->action === 'link_existing') {
                $draft->matched_product_id = $request->matched_product_id;
            }

            if ($request->action === 'reject' || $request->action === 'skip') {
                $draft->reject();
            } else {
                $draft->approve();
            }

            DB::commit();

            return response()->json([
                'success' => true,
                'message' => 'Draft processed successfully',
                'draft' => $draft->load('matchedProduct'),
            ]);
        } catch (\Exception $e) {
            DB::rollBack();

            return response()->json([
                'success' => false,
                'message' => 'Failed to process draft: '.$e->getMessage(),
            ], 500);
        }
    }

    public function batchProcess(Request $request)
    {
        $request->validate([
            'ids' => 'required|array',
            'ids.*' => 'exists:draft_master_products,id',
            'action' => 'required|in:create_new,reject',
        ]);

        $results = [
            'success' => 0,
            'failed' => 0,
            'errors' => [],
        ];

        foreach ($request->ids as $id) {
            $draft = DraftMasterProduct::find($id);
            if (! $draft || $draft->status !== 'pending') {
                if ($draft && $draft->status !== 'pending') {
                    continue; // Already processed, skip silently
                }
                $results['failed']++;

                continue;
            }

            DB::beginTransaction();
            try {
                $draft->user_action = $request->action;
                if ($request->action === 'reject') {
                    $draft->reject();
                } else {
                    $draft->approve();
                }
                DB::commit();
                $results['success']++;
            } catch (\Exception $e) {
                DB::rollBack();
                $results['failed']++;
                $results['errors'][] = [
                    'draft_id' => $id,
                    'sku' => $draft->sku ?? '-',
                    'message' => $e->getMessage(),
                ];
                // Keep only last 20 errors to avoid huge response
                if (count($results['errors']) > 20) {
                    array_shift($results['errors']);
                }
            }
        }

        return response()->json([
            'success' => true,
            'results' => $results,
        ]);
    }
}
