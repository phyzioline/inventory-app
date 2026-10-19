<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Application\Support\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use App\Application\Services\CustomerReceivablesQueryService;
use App\Application\Services\ReceiptApplicationService;
use App\Domain\Models\Wms\Customer;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryReturn;
use App\Domain\Models\Wms\Receipt;
use App\Infrastructure\External\MonolithCrmWebhookClient;

class CustomerController extends Controller
{
    public function __construct(
        protected MonolithCrmWebhookClient $crmWebhook,
    ) {}

    private function sqlEmptyString(): string
    {
        // Postgres treats "" as identifier; keep raw SQL portable.
        return "''";
    }

    private function tenantUserId(): ?int
    {
        $id = TenantContext::id() ?? Auth::id();

        return $id !== null ? (int) $id : null;
    }

    private function ensureLegacyCustomersLinkedToUser(): void
    {
        if (! Auth::check()) {
            return;
        }

        $tenantId = $this->tenantUserId();
        if ($tenantId === null) {
            return;
        }

        // If the current tenant sees no customers, legacy rows with null user_id are likely hidden by the user scope.
        if (Customer::query()->count() > 0) {
            return;
        }

        $orphans = Customer::withoutGlobalScopes()
            ->whereNull('user_id')
            ->limit(5000)
            ->pluck('id');

        if ($orphans->isEmpty()) {
            return;
        }

        Customer::withoutGlobalScopes()
            ->whereIn('id', $orphans->all())
            ->update(['user_id' => $tenantId]);
    }

    private function orderMatchesCustomer(InventoryOrder $order, Customer $customer): bool
    {
        if ((int) ($order->customer_id ?? 0) === (int) $customer->id) {
            return true;
        }

        $nameTrim = trim((string) $customer->name);
        $emailNorm = strtolower(trim((string) ($customer->email ?? '')));
        $phoneTrim = trim((string) ($customer->phone ?? ''));

        $oName = trim((string) ($order->customer_name ?? ''));
        $oEmail = strtolower(trim((string) ($order->customer_email ?? '')));
        $oPhone = trim((string) ($order->customer_phone ?? ''));

        if ($nameTrim !== '' && $oName !== '' && $oName === $nameTrim) {
            return true;
        }
        if ($emailNorm !== '' && $oEmail !== '' && $oEmail === $emailNorm) {
            return true;
        }
        if ($phoneTrim !== '' && $oPhone !== '' && $oPhone === $phoneTrim) {
            return true;
        }

        return false;
    }

    public function receive(Request $request, Customer $customer)
    {
        $validated = $request->validate([
            'amount' => 'required|numeric|min:0.01',
            'receipt_date' => 'required|date',
            'payment_method' => 'nullable|string|max:50',
            'description' => 'nullable|string|max:500',
            'external_reference' => 'nullable|string|max:191',
            'linked_inventory_order_id' => 'nullable|integer|exists:inventory_orders,id',
            'apply_payment_to_order' => 'nullable|boolean',
        ]);

        $orderId = isset($validated['linked_inventory_order_id']) ? (int) $validated['linked_inventory_order_id'] : null;
        if ($orderId !== null && $orderId > 0) {
            $order = InventoryOrder::query()->whereKey($orderId)->firstOrFail();
            if (! $this->orderMatchesCustomer($order, $customer)) {
                return response()->json(['message' => 'Order does not belong to this customer.'], 422);
            }
        } else {
            $orderId = null;
        }

        $receipt = app(ReceiptApplicationService::class)->create([
            'user_id' => $this->tenantUserId(),
            'category' => 'customer_collection',
            'amount' => (float) $validated['amount'],
            'description' => $validated['description'] ?? ('Customer collection — '.$customer->name),
            'receipt_date' => $validated['receipt_date'],
            'payment_method' => $validated['payment_method'] ?? 'cash',
            'external_reference' => $validated['external_reference'] ?? null,
            'payer_name' => $customer->name,
            'receipt_number' => $this->generateNextReceiptNumber(),
            'linked_inventory_order_id' => $orderId,
            'apply_payment_to_order' => $orderId ? (bool) ($validated['apply_payment_to_order'] ?? true) : false,
        ]);

        return response()->json([
            'message' => 'Receipt recorded successfully',
            'receipt' => $receipt,
        ], 201);
    }

    private function generateNextReceiptNumber(): string
    {
        return app(ReceiptApplicationService::class)->generateNextReceiptNumber();
    }

    public function index()
    {
        $this->ensureLegacyCustomersLinkedToUser();

        return response()->json(Customer::orderBy('name')->get());
    }

    /**
     * Paginated customer list with aggregated summary computed in SQL.
     * Returns 50 rows per page, default sort: outstanding DESC (customers who owe money first).
     * Marketplace "Guest" placeholder customers are excluded by default (exclude_guests=1).
     * meta.totals aggregates the FULL filtered set (not just the current page) for KPI cards.
     *
     * Query params:
     *   page           int
     *   per_page       int     (max 100, default 50)
     *   search         string
     *   sort           outstanding|total_sales|total_received|invoice_count|name
     *   direction      asc|desc
     *   start_date     date
     *   end_date       date
     *   exclude_guests 0|1     (default 1)
     */
    public function paginatedWithSummary(Request $request, CustomerReceivablesQueryService $receivables): \Illuminate\Http\JsonResponse
    {
        $this->ensureLegacyCustomersLinkedToUser();

        $userId = $this->tenantUserId();
        if ($userId === null) {
            abort(401);
        }

        $perPage = min(max((int) $request->query('per_page', 50), 1), 100);
        $page = max(1, (int) $request->query('page', 1));
        $sort = in_array($request->query('sort'), CustomerReceivablesQueryService::SORTS, true)
            ? (string) $request->query('sort')
            : 'outstanding';
        $direction = $request->query('direction') === 'asc' ? 'ASC' : 'DESC';
        $filters = $this->receivablesFilters($request);

        $result = $receivables->paginate($userId, $filters, $sort, $direction, $page, $perPage);

        return response()->json([
            'data' => $result['data'],
            'meta' => [
                'total' => $result['total'],
                'per_page' => $perPage,
                'current_page' => $page,
                'last_page' => (int) max(1, ceil($result['total'] / max(1, $perPage))),
                'exclude_guests' => $filters['exclude_guests'],
                'totals' => $result['totals'],
            ],
        ]);
    }

    /**
     * Customer receivables KPI totals only (Treasury / Capital cards).
     * Same numbers as the Customers page cards for the same filters.
     */
    public function receivablesSummary(Request $request, CustomerReceivablesQueryService $receivables): \Illuminate\Http\JsonResponse
    {
        $this->ensureLegacyCustomersLinkedToUser();

        $userId = $this->tenantUserId();
        if ($userId === null) {
            abort(401);
        }

        return response()->json($receivables->totals($userId, $this->receivablesFilters($request)));
    }

    /**
     * @return array{search: string, start_date: ?string, end_date: ?string, exclude_guests: bool}
     */
    private function receivablesFilters(Request $request): array
    {
        $startDate = $request->query('start_date') ?: null;
        $endDate = $request->query('end_date') ?: null;

        return [
            'search' => trim((string) $request->query('search', '')),
            'start_date' => $startDate && $endDate ? (string) $startDate : null,
            'end_date' => $startDate && $endDate ? (string) $endDate : null,
            'exclude_guests' => $request->query('exclude_guests', '1') !== '0',
        ];
    }

    public function store(Request $request)
    {
        if (! $request->user()) {
            return response()->json(['message' => 'Authentication required'], 401);
        }

        $request->merge([
            'email' => $this->nullIfBlank($request->input('email')),
            'phone' => $this->nullIfBlank($request->input('phone')),
            'tax_id' => $this->nullIfBlank($request->input('tax_id')),
            'address' => $this->nullIfBlank($request->input('address')),
            'credit_limit' => $request->input('credit_limit') === '' || $request->input('credit_limit') === null
                ? 0
                : $request->input('credit_limit'),
        ]);

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'nullable|email|max:255',
            'phone' => 'nullable|string|max:255',
            'tax_id' => 'nullable|string|max:255',
            'address' => 'nullable|string',
            'credit_limit' => 'nullable|numeric|min:0',
        ]);

        try {
            $customer = Customer::create(array_merge($validated, [
                'user_id' => $this->tenantUserId() ?? $request->user()->id,
                'current_balance' => 0,
                'currency' => 'EGP',
                'is_active' => true,
            ]));
        } catch (\Throwable $e) {
            report($e);

            return response()->json([
                'message' => 'Could not create customer',
                'error' => config('app.debug') ? $e->getMessage() : null,
            ], 500);
        }

        return response()->json($customer, 201);
    }

    private function nullIfBlank(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $trimmed = trim((string) $value);

        return $trimmed === '' ? null : $trimmed;
    }

    public function show(Customer $customer)
    {
        return response()->json($customer);
    }

    public function update(Request $request, Customer $customer)
    {
        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'email' => 'nullable|email|max:255',
            'phone' => 'nullable|string|max:255',
            'tax_id' => 'nullable|string|max:255',
            'address' => 'nullable|string',
            'credit_limit' => 'nullable|numeric|min:0',
            'is_active' => 'sometimes|boolean',
        ]);

        $customer->update($validated);

        return response()->json($customer->fresh());
    }

    /**
     * Manually re-push this customer to the monolith CRM webhook (best-effort, fire-and-forget).
     * There is no local read-back of CRM link/sync status in this standalone app — the
     * monolith owns the CRM database and the receiver endpoint (out of scope here).
     */
    public function syncCrm(Customer $customer)
    {
        $this->crmWebhook->syncCustomer($customer, 'updated');

        return response()->json([
            'success' => true,
            'message' => 'CRM sync requested.',
        ]);
    }

    public function destroy(Customer $customer)
    {
        $customer->delete();

        return response()->json(null, 204);
    }

    /**
     * Accounting view for customer: KPIs + orders/invoices + receipts + ledger.
     */
    public function accountSummary(Request $request, Customer $customer)
    {
        $startDate = $request->query('start_date');
        $endDate = $request->query('end_date');

        // Guest placeholders share one name across thousands of marketplace orders —
        // match them by customer_id only, never by name/payer_name.
        $isGuest = CustomerReceivablesQueryService::isGuestPlaceholderName($customer->name);
        $nameTrim = $isGuest ? '' : trim((string) $customer->name);
        $emailNorm = strtolower(trim((string) ($customer->email ?? '')));
        $phoneTrim = trim((string) ($customer->phone ?? ''));

        $ordersQuery = InventoryOrder::with(['items.sku.offer.masterProduct'])
            ->where(function ($q) use ($customer, $nameTrim, $emailNorm, $phoneTrim) {
                $q->where('customer_id', $customer->id);
                if ($nameTrim !== '') {
                    $q->orWhere('customer_name', $customer->name)
                        ->orWhere('customer_name', $nameTrim)
                        ->orWhereRaw("TRIM(COALESCE(customer_name, {$this->sqlEmptyString()})) = ?", [$nameTrim]);
                }
                if ($emailNorm !== '') {
                    $q->orWhereRaw("LOWER(TRIM(COALESCE(customer_email, {$this->sqlEmptyString()}))) = ?", [$emailNorm]);
                }
                if ($phoneTrim !== '' && Schema::hasColumn('inventory_orders', 'customer_phone')) {
                    $q->orWhere('customer_phone', $customer->phone)
                        ->orWhere('customer_phone', $phoneTrim)
                        ->orWhereRaw("TRIM(COALESCE(customer_phone, {$this->sqlEmptyString()})) = ?", [$phoneTrim]);
                }
            })
            ->whereNotIn('status', ['cancelled', 'rejected']);

        if ($startDate && $endDate) {
            $ordersQuery->whereBetween('order_date', [$startDate.' 00:00:00', $endDate.' 23:59:59']);
        }

        $orders = $ordersQuery->orderByDesc('order_date')->get();

        $receiptsQuery = Receipt::where(function ($q) use ($customer, $nameTrim, $isGuest) {
            if ($isGuest) {
                $q->whereRaw('0 = 1');

                return;
            }
            $q->where('payer_name', $customer->name);
            if ($nameTrim !== '') {
                $q->orWhere('payer_name', $nameTrim)
                    ->orWhereRaw("TRIM(COALESCE(payer_name, {$this->sqlEmptyString()})) = ?", [$nameTrim]);
            }
        });
        if ($startDate && $endDate) {
            $receiptsQuery->whereBetween('receipt_date', [$startDate, $endDate]);
        }
        $receipts = $receiptsQuery->orderByDesc('receipt_date')->get();

        $invoiceRows = $orders->map(function ($order) {
            $lineItems = $order->items->map(function ($item) {
                return [
                    'id' => $item->id,
                    'product_name' => $item->sku?->offer?->masterProduct?->internal_name ?? $item->product_name,
                    'sku_code' => $item->sku?->sku ?? $item->sku_code,
                    'quantity' => (float) $item->quantity,
                    'unit_price' => (float) $item->unit_price,
                    'total_price' => (float) $item->total_price,
                ];
            })->values();

            $total = (float) $order->total_amount;
            $paid = (float) ($order->paid_amount ?? 0);
            $remaining = $order->remaining_amount !== null
                ? (float) $order->remaining_amount
                : max(0.0, $total - $paid);

            return [
                'id' => $order->id,
                'invoice_number' => $order->platform_order_id ?: ('SO-'.$order->id),
                'date' => optional($order->order_date)->toDateString(),
                'total' => $total,
                'paid' => round($paid, 2),
                'remaining' => round($remaining, 2),
                'status' => $order->status,
                'items' => $lineItems,
            ];
        })->values();

        $returns = InventoryReturn::whereIn('inventory_order_id', $orders->pluck('id'))
            ->where('status', 'completed')
            ->where('refund_amount', '>', 0)
            ->orderBy('return_date')
            ->get();

        $receiptRows = $receipts->map(function ($receipt) {
            return [
                'id' => $receipt->id,
                'date' => optional($receipt->receipt_date)->toDateString(),
                'amount' => (float) $receipt->amount,
                'method' => $receipt->payment_method,
                'reference' => $receipt->reference_id ?: $receipt->receipt_number,
                'type' => $receipt->type,
                'notes' => $receipt->description,
            ];
        })->values();

        $totalSales = round((float) $invoiceRows->sum('total'), 2);
        // Base outstanding/collected reflect order paid_amount (e.g. cash sales).
        // Negative means the customer overpaid or returned goods worth more than
        // what's left owed — a credit balance owed back to them, not zero.
        $outstanding = round((float) $invoiceRows->sum('remaining'), 2);

        // Extra customer receipts (not linked to an inventory order) should reduce outstanding.
        // This is the "on-account" collection the UI records from the customer list.
        $orphanReceiptsTotal = 0.0;
        foreach ($receipts as $receipt) {
            if ($this->receiptReferencesInventoryOrder($receipt)) {
                continue;
            }
            $orphanReceiptsTotal += (float) $receipt->amount;
        }

        $outstandingAfterReceipts = round($outstanding - $orphanReceiptsTotal, 2);
        $totalReceived = round(max(0.0, $totalSales - $outstandingAfterReceipts), 2);

        $ledgerRows = collect();
        foreach ($invoiceRows as $inv) {
            $ledgerRows->push([
                'date' => $inv['date'],
                'description' => 'Sales Invoice #'.$inv['invoice_number'],
                'debit' => $inv['total'],
                'credit' => 0.0,
                'source' => 'invoice',
                'source_id' => $inv['id'],
                '_sort' => ($inv['date'] ?? '0000-00-00').'-A-'.$inv['id'],
            ]);
            if (((float) ($inv['paid'] ?? 0)) > 0.00001) {
                $ledgerRows->push([
                    'date' => $inv['date'],
                    'description' => $this->customerCollectionLedgerDescription(
                        (string) $customer->name,
                        $inv['invoice_number'] ?? null
                    ),
                    'debit' => 0.0,
                    'credit' => (float) $inv['paid'],
                    'source' => 'order_payment',
                    'source_id' => $inv['id'],
                    '_sort' => ($inv['date'] ?? '0000-00-00').'-B-'.$inv['id'],
                ]);
            }
        }
        foreach ($receipts as $receipt) {
            if ($this->receiptReferencesInventoryOrder($receipt)) {
                continue;
            }
            $rcp = [
                'id' => $receipt->id,
                'date' => optional($receipt->receipt_date)->toDateString(),
                'amount' => (float) $receipt->amount,
                'method' => $receipt->payment_method,
                'reference' => $receipt->reference_id ?: $receipt->receipt_number,
                'type' => $receipt->type,
                'notes' => $receipt->description,
            ];
            $ledgerRows->push([
                'date' => $rcp['date'],
                'description' => $this->customerCollectionLedgerDescription(
                    (string) $customer->name,
                    $rcp['reference'] ?? null
                ),
                'debit' => 0.0,
                'credit' => $rcp['amount'],
                'source' => 'receipt',
                'source_id' => $rcp['id'],
                '_sort' => ($rcp['date'] ?? '0000-00-00').'-C-'.$rcp['id'],
            ]);
        }
        foreach ($returns as $return) {
            $returnDate = optional($return->return_date)->toDateString();
            $ledgerRows->push([
                'date' => $returnDate,
                'description' => 'مرتجع - Return #'.$return->id,
                'debit' => 0.0,
                'credit' => (float) $return->refund_amount,
                'source' => 'return',
                'source_id' => $return->id,
                '_sort' => ($returnDate ?? '0000-00-00').'-D-'.$return->id,
            ]);
        }

        $running = 0.0;
        $ledger = $ledgerRows
            ->sortBy('_sort')
            ->values()
            ->map(function ($row) use (&$running) {
                unset($row['_sort']);
                $running += ((float) $row['debit'] - (float) $row['credit']);
                $row['balance'] = round($running, 2);

                return $row;
            })
            ->values();

        $orderDates = $invoiceRows->pluck('date')->filter()->map(fn ($d) => Carbon::parse($d));
        $receiptDates = $receiptRows->pluck('date')->filter()->map(fn ($d) => Carbon::parse($d));
        $avgCollectionDays = 0;
        if ($orderDates->isNotEmpty() && $receiptDates->isNotEmpty()) {
            $days = [];
            foreach ($orderDates as $orderDate) {
                $nextReceipt = $receiptDates->first(fn ($rDate) => $rDate->greaterThanOrEqualTo($orderDate));
                if ($nextReceipt) {
                    $days[] = $orderDate->diffInDays($nextReceipt);
                }
            }
            if (! empty($days)) {
                $avgCollectionDays = round(array_sum($days) / count($days), 2);
            }
        }

        return response()->json([
            'customer' => $customer,
            'summary' => [
                'total_sales' => $totalSales,
                'total_received' => $totalReceived,
                'outstanding' => $outstandingAfterReceipts,
                'invoice_count' => (int) $invoiceRows->count(),
                'avg_collection_days' => $avgCollectionDays,
            ],
            'invoices' => $invoiceRows,
            'receipts' => $receiptRows,
            'returns' => $returns->map(fn ($r) => [
                'id' => $r->id,
                'date' => optional($r->return_date)->toDateString(),
                'amount' => (float) $r->refund_amount,
                'inventory_order_id' => $r->inventory_order_id,
            ])->values(),
            'ledger' => $ledger,
        ]);
    }

    /**
     * Receipts linked to an inventory order already move that order's paid_amount; do not double-count in ledger/collection.
     */
    private function receiptReferencesInventoryOrder(Receipt $receipt): bool
    {
        if (! $receipt->reference_id) {
            return false;
        }
        $type = (string) $receipt->reference_type;

        return $type === InventoryOrder::class
            || Str::endsWith($type, '\\InventoryOrder')
            || Str::endsWith($type, 'InventoryOrder');
    }

    private function customerCollectionLedgerDescription(string $customerName, mixed $reference): string
    {
        $name = trim($customerName) !== '' ? trim($customerName) : 'العميل';
        $ref = trim((string) ($reference ?? ''));

        return 'سداد نقدي من '.$name.($ref !== '' ? ' — #'.$ref : '');
    }
}
