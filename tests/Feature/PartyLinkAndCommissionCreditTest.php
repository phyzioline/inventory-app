<?php

use App\Application\Support\TenantContext;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\Customer;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\Payment;
use App\Domain\Models\Wms\PurchaseBatch;
use App\Domain\Models\Wms\Receipt;
use App\Domain\Models\Wms\Supplier;
use App\Domain\Models\Wms\SupplierAccountCredit;
use App\Domain\Models\Wms\Vendor;
use App\Domain\ValueObjects\NonCashSettlementMethod;
use App\Models\User;
use App\Presentation\Http\Controllers\Api\CashFlowSummaryController;

beforeEach(function () {
    TenantContext::flush();
    TenantContext::clearOverride();
});

it('links supplier to customer, set-off clears opposite balances without treasury cash, and sale appears on merged ledger', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    $vendor = Vendor::query()->create(['name' => 'pt shop', 'is_active' => true, 'current_balance' => 0, 'user_id' => $user->id]);
    $supplier = Supplier::query()->create(['name' => 'pt shop', 'balance' => 11900, 'user_id' => $user->id]);
    PurchaseBatch::query()->create([
        'batch_number' => 'PB-PT-'.uniqid(),
        'user_id' => $user->id,
        'vendor_id' => $vendor->id,
        'supplier_name_raw' => 'pt shop',
        'invoice_number' => 'PUR-PT-1',
        'invoice_date' => '2026-01-10',
        'grand_total' => 11900,
        'subtotal' => 11900,
        'status' => 'received',
        'notes' => '[PAYMENT] type=credit; paid=0.00; remaining=11900.00; status=confirmed',
    ]);

    $customer = Customer::query()->create(['name' => 'pt shop', 'is_active' => true, 'user_id' => $user->id]);
    $channel = Channel::query()->create(['name' => 'Shop', 'slug' => 'shop-'.uniqid(), 'type' => 'store', 'is_active' => true]);
    $channel->update(['user_id' => $user->id]);
    InventoryOrder::query()->create([
        'user_id' => $user->id,
        'channel_id' => $channel->id,
        'customer_id' => $customer->id,
        'customer_name' => 'pt shop',
        'platform_order_id' => 'SO-PT-'.uniqid(),
        'order_date' => '2026-02-01',
        'total_amount' => 29000,
        'paid_amount' => 0,
        'remaining_amount' => 29000,
        'status' => 'pending',
        'currency' => 'EGP',
    ]);

    $before = app(CashFlowSummaryController::class)->getCoreStatsForUser((int) $user->id);
    $receiptsBefore = (float) ($before['total_receipts'] ?? 0);
    $paymentsBefore = (float) ($before['total_payments'] ?? 0);

    $this->postJson('/api/inventory/suppliers/'.$supplier->id.'/link-customer', [
        'customer_id' => $customer->id,
        'run_set_off' => true,
    ])->assertOk()
        ->assertJsonPath('set_off.amount', 11900);

    $supplier->refresh();
    expect((int) $supplier->linked_customer_id)->toBe((int) $customer->id);

    $supplierSummary = $this->getJson('/api/inventory/suppliers/'.$supplier->id.'/account-summary')->assertOk()->json();
    expect((float) $supplierSummary['summary']['outstanding'])->toBe(0.0)
        ->and((float) $supplierSummary['linked_party']['customer_outstanding'])->toBe(17100.0)
        ->and((float) $supplierSummary['linked_party']['net_position'])->toBe(17100.0);

    $merged = collect($supplierSummary['current_account_ledger'] ?? []);
    expect($merged->contains(fn ($row) => str_contains((string) ($row['description'] ?? ''), 'اشترى منّي')))->toBeTrue();

    expect(
        Payment::query()->where('payment_method', NonCashSettlementMethod::SET_OFF)->where('payee_id', $supplier->id)->exists()
    )->toBeTrue();
    expect(
        Receipt::query()->where('payment_method', NonCashSettlementMethod::SET_OFF)->where('payer_name', 'pt shop')->exists()
    )->toBeTrue();

    $after = app(CashFlowSummaryController::class)->getCoreStatsForUser((int) $user->id);
    expect((float) ($after['total_receipts'] ?? 0))->toBe($receiptsBefore)
        ->and((float) ($after['total_payments'] ?? 0))->toBe($paymentsBefore);
});

it('posts commission credit that reduces supplier outstanding without treasury movement', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    $vendor = Vendor::query()->create(['name' => 'dealer X', 'is_active' => true, 'current_balance' => 0, 'user_id' => $user->id]);
    $supplier = Supplier::query()->create(['name' => 'dealer X', 'balance' => 11900, 'user_id' => $user->id]);
    PurchaseBatch::query()->create([
        'batch_number' => 'PB-CC-'.uniqid(),
        'user_id' => $user->id,
        'vendor_id' => $vendor->id,
        'supplier_name_raw' => 'dealer X',
        'invoice_number' => 'PUR-CC-1',
        'invoice_date' => '2026-01-10',
        'grand_total' => 11900,
        'subtotal' => 11900,
        'status' => 'received',
        'notes' => '[PAYMENT] type=credit; paid=0.00; remaining=11900.00; status=confirmed',
    ]);

    $before = app(CashFlowSummaryController::class)->getCoreStatsForUser((int) $user->id);

    $this->postJson('/api/inventory/suppliers/'.$supplier->id.'/commission-credit', [
        'amount' => 2000,
        'reason' => 'price_difference',
        'notes' => 'فرق سعر جهاز',
        'credit_date' => '2026-01-15',
    ])->assertCreated();

    expect(SupplierAccountCredit::query()->where('supplier_id', $supplier->id)->count())->toBe(1);

    $summary = $this->getJson('/api/inventory/suppliers/'.$supplier->id.'/account-summary')->assertOk()->json();
    expect((float) $summary['summary']['outstanding'])->toBe(9900.0)
        ->and((float) $summary['summary']['commission_credit'])->toBe(2000.0);

    $ledger = collect($summary['ledger'] ?? []);
    expect($ledger->contains(fn ($row) => ($row['source'] ?? '') === 'commission_credit'))->toBeTrue();

    $after = app(CashFlowSummaryController::class)->getCoreStatsForUser((int) $user->id);
    expect((float) ($after['total_receipts'] ?? 0))->toBe((float) ($before['total_receipts'] ?? 0))
        ->and((float) ($after['total_payments'] ?? 0))->toBe((float) ($before['total_payments'] ?? 0));
});

it('rejects linking a customer that is already linked to another supplier', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    $customer = Customer::query()->create(['name' => 'shared', 'is_active' => true, 'user_id' => $user->id]);
    $a = Supplier::query()->create(['name' => 'A', 'balance' => 0, 'user_id' => $user->id, 'linked_customer_id' => $customer->id]);
    $b = Supplier::query()->create(['name' => 'B', 'balance' => 0, 'user_id' => $user->id]);

    $this->postJson('/api/inventory/suppliers/'.$b->id.'/link-customer', [
        'customer_id' => $customer->id,
        'run_set_off' => false,
    ])->assertStatus(422);

    expect((int) $a->fresh()->linked_customer_id)->toBe((int) $customer->id);
});
