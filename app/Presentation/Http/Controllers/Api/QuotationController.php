<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use App\Application\Services\ChannelStockResolver;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\Customer;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryOrderItem;
use App\Domain\Models\Wms\Quotation;
use App\Domain\Models\Wms\Sku;

class QuotationController extends Controller
{
    public function index()
    {
        return response()->json(Quotation::with('customer', 'items.sku')->orderBy('created_at', 'desc')->get());
    }

    public function store(Request $request)
    {
        $items = $request->input('items', []);
        if (is_array($items)) {
            foreach ($items as $idx => $row) {
                if (! is_array($row)) {
                    continue;
                }
                $skuId = $row['sku_id'] ?? null;
                $productId = $row['product_id'] ?? null;
                if (empty($skuId) && ! empty($productId)) {
                    $resolved = Sku::query()
                        ->whereHas('offer', function ($q) use ($productId) {
                            $q->where('master_product_id', $productId);
                        })
                        ->orderBy('id')
                        ->value('id');
                    if ($resolved) {
                        $items[$idx]['sku_id'] = $resolved;
                    }
                }
            }
            $request->merge(['items' => $items]);
        }

        $validated = $request->validate([
            'customer_id' => 'nullable|exists:customers,id',
            'customer_name' => 'nullable|string|max:255',
            'customer_email' => 'nullable|email|max:255',
            'customer_phone' => 'nullable|string|max:255',
            'quotation_date' => 'nullable|date',
            'valid_until' => 'nullable|date',
            'notes' => 'nullable|string',
            'items' => 'required|array|min:1',
            'items.*.sku_id' => 'required|exists:skus,id',
            'items.*.product_id' => 'sometimes|nullable|exists:master_products,id',
            'items.*.quantity' => 'required|integer|min:1',
            'items.*.unit_price' => 'required|numeric|min:0',
            'discount_amount' => 'nullable|numeric|min:0',
            'tax_amount' => 'nullable|numeric|min:0',
        ]);

        $validated['quotation_date'] = $validated['quotation_date'] ?? now()->toDateString();

        return DB::transaction(function () use ($validated, $request) {
            $totalAmount = 0;
            foreach ($validated['items'] as $item) {
                $totalAmount += $item['quantity'] * $item['unit_price'];
            }

            $totalAmount = $totalAmount - ($validated['discount_amount'] ?? 0) + ($validated['tax_amount'] ?? 0);

            $customerId = $this->resolveOrCreateCustomerId($validated, $request->user()?->id);

            $quotation = Quotation::create([
                'reference_number' => 'QTN-'.strtoupper(Str::random(8)),
                'user_id' => $request->user()?->id,
                'customer_id' => $customerId,
                'customer_name' => $validated['customer_name'] ?? null,
                'quotation_date' => $validated['quotation_date'],
                'valid_until' => $validated['valid_until'] ?? null,
                'total_amount' => $totalAmount,
                'tax_amount' => $validated['tax_amount'] ?? 0,
                'discount_amount' => $validated['discount_amount'] ?? 0,
                'status' => 'draft',
                'notes' => $validated['notes'] ?? null,
            ]);

            foreach ($validated['items'] as $item) {
                $quotation->items()->create([
                    'sku_id' => $item['sku_id'],
                    'quantity' => $item['quantity'],
                    'unit_price' => $item['unit_price'],
                    'total' => $item['quantity'] * $item['unit_price'],
                ]);
            }

            return response()->json($quotation->load('customer', 'items.sku'), 201);
        });
    }

    /**
     * Use linked customer_id when provided; otherwise match by phone/email or create a new customer from the quotation contact fields.
     */
    private function resolveOrCreateCustomerId(array $validated, ?int $userId): ?int
    {
        $existing = $validated['customer_id'] ?? null;
        if (! empty($existing)) {
            return (int) $existing;
        }

        $name = trim((string) ($validated['customer_name'] ?? ''));
        if ($name === '') {
            return null;
        }

        $email = trim((string) ($validated['customer_email'] ?? ''));
        $phone = trim((string) ($validated['customer_phone'] ?? ''));

        $base = Customer::query();

        if ($phone !== '') {
            $byPhone = (clone $base)->where('phone', $phone)->first();
            if ($byPhone) {
                return (int) $byPhone->id;
            }
        }

        if ($email !== '') {
            $byEmail = (clone $base)->where('email', $email)->first();
            if ($byEmail) {
                return (int) $byEmail->id;
            }
        }

        $customer = Customer::create([
            'user_id' => $userId,
            'name' => $name,
            'email' => $email !== '' ? $email : null,
            'phone' => $phone !== '' ? $phone : null,
            'current_balance' => 0,
            'credit_limit' => 0,
            'currency' => 'EGP',
            'is_active' => true,
        ]);

        return (int) $customer->id;
    }

    public function show(Quotation $quotation)
    {
        return response()->json($quotation->load(['customer', 'items.sku.offer.masterProduct']));
    }

    public function update(Request $request, Quotation $quotation)
    {
        if ($quotation->status === 'converted') {
            return response()->json(['message' => 'Converted quotations cannot be edited'], 422);
        }

        if (! $request->has('items')) {
            $validated = $request->validate([
                'status' => 'sometimes|string|in:draft,sent,accepted,rejected',
                'notes' => 'nullable|string',
            ]);

            $quotation->update($validated);

            return response()->json($quotation->load(['customer', 'items.sku.offer.masterProduct']));
        }

        $items = $request->input('items', []);
        if (is_array($items)) {
            foreach ($items as $idx => $row) {
                if (! is_array($row)) {
                    continue;
                }
                $skuId = $row['sku_id'] ?? null;
                $productId = $row['product_id'] ?? null;
                if (empty($skuId) && ! empty($productId)) {
                    $resolved = Sku::query()
                        ->whereHas('offer', function ($q) use ($productId) {
                            $q->where('master_product_id', $productId);
                        })
                        ->orderBy('id')
                        ->value('id');
                    if ($resolved) {
                        $items[$idx]['sku_id'] = $resolved;
                    }
                }
            }
            $request->merge(['items' => $items]);
        }

        $validated = $request->validate([
            'customer_id' => 'nullable|exists:customers,id',
            'customer_name' => 'nullable|string|max:255',
            'customer_email' => 'nullable|email|max:255',
            'customer_phone' => 'nullable|string|max:255',
            'quotation_date' => 'nullable|date',
            'valid_until' => 'nullable|date',
            'notes' => 'nullable|string',
            'items' => 'required|array|min:1',
            'items.*.sku_id' => 'required|exists:skus,id',
            'items.*.product_id' => 'sometimes|nullable|exists:master_products,id',
            'items.*.quantity' => 'required|integer|min:1',
            'items.*.unit_price' => 'required|numeric|min:0',
            'discount_amount' => 'nullable|numeric|min:0',
            'tax_amount' => 'nullable|numeric|min:0',
        ]);

        return DB::transaction(function () use ($validated, $request, $quotation) {
            $totalAmount = 0;
            foreach ($validated['items'] as $item) {
                $totalAmount += $item['quantity'] * $item['unit_price'];
            }

            $totalAmount = $totalAmount - ($validated['discount_amount'] ?? 0) + ($validated['tax_amount'] ?? 0);

            $customerId = $this->resolveOrCreateCustomerId($validated, $request->user()?->id);

            $quotation->update([
                'customer_id' => $customerId,
                'customer_name' => $validated['customer_name'] ?? null,
                'quotation_date' => $validated['quotation_date'] ?? $quotation->quotation_date,
                'valid_until' => $validated['valid_until'] ?? $quotation->valid_until,
                'total_amount' => $totalAmount,
                'tax_amount' => $validated['tax_amount'] ?? 0,
                'discount_amount' => $validated['discount_amount'] ?? 0,
                'notes' => $validated['notes'] ?? $quotation->notes,
            ]);

            $quotation->items()->delete();

            foreach ($validated['items'] as $item) {
                $quotation->items()->create([
                    'sku_id' => $item['sku_id'],
                    'quantity' => $item['quantity'],
                    'unit_price' => $item['unit_price'],
                    'total' => $item['quantity'] * $item['unit_price'],
                ]);
            }

            return response()->json($quotation->load(['customer', 'items.sku.offer.masterProduct']));
        });
    }

    public function convertToOrder(Request $request, Quotation $quotation)
    {
        if ($quotation->status === 'converted') {
            return response()->json(['message' => 'Quotation already converted to order'], 422);
        }

        return DB::transaction(function () use ($quotation, $request) {
            $channelId = (int) ($request->input('channel_id') ?: ChannelStockResolver::resolveMainStoreChannelId());
            if ($channelId <= 0) {
                $channelId = (int) (Channel::query()->where('is_active', true)->orderBy('id')->value('id') ?? 0);
            }
            if ($channelId <= 0) {
                return response()->json(['message' => 'No sales channel configured for order conversion'], 422);
            }

            $total = (float) $quotation->total_amount;
            $platformOrderId = 'QT-'.preg_replace('/[^A-Za-z0-9\-]/', '', (string) $quotation->reference_number);
            if ($platformOrderId === 'QT-') {
                $platformOrderId = 'QT-'.strtoupper(Str::random(10));
            }

            $order = InventoryOrder::create([
                'channel_id' => $channelId,
                'platform_order_id' => $platformOrderId,
                'user_id' => $request->user()?->id,
                'customer_id' => $quotation->customer_id,
                'customer_name' => $quotation->customer_name ?? 'Guest',
                'order_date' => now(),
                'currency' => 'EGP',
                'total_amount' => $total,
                'shipping_amount' => 0,
                'tax_amount' => (float) ($quotation->tax_amount ?? 0),
                'discount_amount' => (float) ($quotation->discount_amount ?? 0),
                'payment_type' => 'credit',
                'paid_amount' => 0,
                'remaining_amount' => $total,
                'status' => 'pending',
                'financial_status' => 'pending',
                'settlement_status' => 'pending',
            ]);

            $quotation->load('items.sku');
            foreach ($quotation->items as $item) {
                $sku = $item->sku ?? ($item->sku_id ? Sku::query()->find($item->sku_id) : null);
                $qty = (int) $item->quantity;
                $unit = (float) $item->unit_price;

                InventoryOrderItem::create([
                    'inventory_order_id' => $order->id,
                    'sku_id' => $item->sku_id,
                    'sku_code' => $sku?->sku ?? (string) ($item->sku_id ?? 'UNKNOWN'),
                    'product_name' => $sku?->name ?? $sku?->sku ?? 'Quotation line',
                    'quantity' => $qty,
                    'unit_price' => $unit,
                    'total_price' => (float) ($item->total ?? ($qty * $unit)),
                ]);
            }

            $quotation->update(['status' => 'converted']);

            return response()->json([
                'message' => 'Quotation converted to order successfully',
                'order' => $order->load('items.sku'),
            ]);
        });
    }

    public function destroy(Quotation $quotation)
    {
        $quotation->delete();

        return response()->json(null, 204);
    }
}
