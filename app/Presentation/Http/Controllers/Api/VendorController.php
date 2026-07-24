<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use App\Domain\Models\Wms\Vendor;
use App\Infrastructure\External\MonolithCrmWebhookClient;

class VendorController extends Controller
{
    public function __construct(
        protected MonolithCrmWebhookClient $crmWebhook,
    ) {}

    /**
     * Display a listing of the resource.
     */
    public function index()
    {
        $vendors = Vendor::orderBy('name')->paginate(50);

        return response()->json($vendors);
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'nullable|email',
            'phone' => 'nullable|string',
            'address' => 'nullable|string',
            'is_active' => 'boolean',
        ]);

        $vendor = Vendor::create($validated);

        return response()->json($vendor, 201);
    }

    /**
     * Display the specified resource.
     */
    public function show($id)
    {
        // Load recent payments
        $vendor = Vendor::with(['payments' => function ($query) {
            $query->latest()->limit(10);
        }])->findOrFail($id);

        return response()->json($vendor);
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, $id)
    {
        $vendor = Vendor::findOrFail($id);

        $validated = $request->validate([
            'name' => 'sometimes|string|max:255',
            'email' => 'nullable|email',
            'phone' => 'nullable|string',
            'address' => 'nullable|string',
            'is_active' => 'boolean',
        ]);

        $vendor->update($validated);

        return response()->json($vendor->fresh());
    }

    /**
     * Manually re-push this vendor to the monolith CRM webhook (best-effort, fire-and-forget).
     * There is no local read-back of CRM link/sync status in this standalone app — the
     * monolith owns the CRM database and the receiver endpoint (out of scope here).
     */
    public function syncCrm($id)
    {
        $vendor = Vendor::findOrFail($id);
        $this->crmWebhook->syncVendor($vendor, 'updated');

        return response()->json([
            'success' => true,
            'message' => 'CRM sync requested.',
        ]);
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy($id)
    {
        $vendor = Vendor::findOrFail($id);

        // Check if has payments or history
        if ($vendor->payments()->exists()) {
            return response()->json(['message' => 'Cannot delete vendor with transaction history.'], 409);
        }

        $vendor->delete();

        return response()->json(['message' => 'Vendor deleted successfully.']);
    }

    /**
     * Manually adjust vendor balance.
     */
    public function adjustBalance(Request $request, $id)
    {
        $request->validate([
            'amount' => 'required|numeric',
            'type' => 'required|in:credit,debit', // credit = they owe us/we paid detailed, debit = we owe them
            'reason' => 'required|string',
        ]);

        $vendor = Vendor::findOrFail($id);
        $amount = $request->amount;

        if ($request->type === 'debit') {
            $vendor->increment('current_balance', $amount);
        } else {
            $vendor->decrement('current_balance', $amount);
        }

        return response()->json(['message' => 'Balance adjusted', 'balance' => $vendor->current_balance]);
    }

    /**
     * Get purchase history and price trends for this vendor.
     */
    public function purchaseHistory($id)
    {
        $vendor = Vendor::findOrFail($id);

        $history = \App\Domain\Models\Wms\PurchaseBatchItem::whereHas('batch', function ($q) use ($id) {
            $q->where('vendor_id', $id)->where('status', 'received');
        })
            ->with(['sku.masterProduct', 'batch'])
            ->orderBy('created_at', 'desc')
            ->limit(200)
            ->get();

        return response()->json($history);
    }
}
