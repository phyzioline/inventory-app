<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use App\Application\DTOs\InvoiceEditDTO;
use App\Application\DTOs\InvoiceItemDTO;
use App\Application\Services\InvoiceEditService;
use App\Domain\Models\Wms\InvoiceEditLog;

class InvoiceEditController extends Controller
{
    public function __construct(
        private readonly InvoiceEditService $service,
    ) {}

    /**
     * Apply a financial correction to a sales invoice.
     * Validates → builds DTO → delegates to InvoiceEditService → responds.
     */
    public function edit(Request $request, int $orderId): JsonResponse
    {
        $validated = $request->validate([
            'items' => 'sometimes|array|min:1',
            'items.*.sku_id' => 'required_with:items|integer|exists:skus,id',
            'items.*.quantity' => 'required_with:items|numeric|min:0.001',
            'items.*.unit_price' => 'required_with:items|numeric|min:0',
            'paid_amount' => 'sometimes|nullable|numeric|min:0',
            'payment_type' => 'sometimes|nullable|string|in:cash,credit,mixed',
            'tax_amount' => 'sometimes|nullable|numeric|min:0',
            'discount_amount' => 'sometimes|nullable|numeric|min:0',
            'reason' => 'sometimes|nullable|string|max:500',
        ]);

        $items = array_map(
            fn (array $row) => new InvoiceItemDTO(
                skuId: (int) $row['sku_id'],
                quantity: (float) $row['quantity'],
                unitPrice: (float) $row['unit_price'],
            ),
            $validated['items'] ?? []
        );

        $dto = new InvoiceEditDTO(
            orderId: $orderId,
            items: $items,
            paidAmount: isset($validated['paid_amount']) ? (float) $validated['paid_amount'] : null,
            paymentType: $validated['payment_type'] ?? null,
            taxAmount: isset($validated['tax_amount']) ? (float) $validated['tax_amount'] : null,
            discountAmount: isset($validated['discount_amount']) ? (float) $validated['discount_amount'] : null,
            reason: $validated['reason'] ?? null,
            userId: (int) Auth::id(),
        );

        $order = $this->service->edit($dto);

        return response()->json([
            'message' => 'Invoice updated successfully',
            'order' => $order,
        ]);
    }

    /**
     * Return the full edit history for a sales invoice.
     */
    public function history(int $orderId): JsonResponse
    {
        $logs = InvoiceEditLog::where('inventory_order_id', $orderId)
            ->with('user:id,name,email')
            ->orderByDesc('created_at')
            ->get()
            ->map(fn ($log) => [
                'id' => $log->id,
                'edited_by' => $log->user?->only('id', 'name', 'email'),
                'before' => $log->before_snapshot,
                'after' => $log->after_snapshot,
                'items_delta' => $log->items_delta,
                'payment' => $log->payment_delta,
                'reason' => $log->reason,
                'created_at' => $log->created_at?->toISOString(),
            ]);

        return response()->json(['logs' => $logs]);
    }
}
