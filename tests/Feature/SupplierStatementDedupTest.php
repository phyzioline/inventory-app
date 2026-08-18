<?php

use App\Application\Support\TenantContext;
use App\Domain\Models\Wms\Payment;
use App\Domain\Models\Wms\PurchaseBatch;
use App\Domain\Models\Wms\Supplier;
use App\Domain\Models\Wms\Vendor;
use App\Models\User;

beforeEach(function () {
    TenantContext::flush();
    TenantContext::clearOverride();
});

it('omits bogus AUTO cash-mirrors on credit invoices from the supplier statement', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    $vendor = Vendor::query()->create([
        'name' => 'جرجس',
        'is_active' => true,
        'current_balance' => 0,
        'user_id' => $user->id,
    ]);
    $supplier = Supplier::query()->create([
        'name' => 'جرجس',
        'balance' => 0,
        'user_id' => $user->id,
    ]);

    $credit = PurchaseBatch::query()->create([
        'batch_number' => 'PB-STMT-CR-'.uniqid(),
        'user_id' => $user->id,
        'vendor_id' => $vendor->id,
        'supplier_name_raw' => 'جرجس',
        'invoice_number' => 'PUR-CREDIT',
        'invoice_date' => now()->toDateString(),
        'grand_total' => 10000,
        'subtotal' => 10000,
        'status' => 'received',
        'notes' => '[PAYMENT] type=credit; paid=0.00; remaining=10000.00; status=confirmed',
    ]);
    $cash = PurchaseBatch::query()->create([
        'batch_number' => 'PB-STMT-CA-'.uniqid(),
        'user_id' => $user->id,
        'vendor_id' => $vendor->id,
        'supplier_name_raw' => 'جرجس',
        'invoice_number' => 'PUR-CASH',
        'invoice_date' => now()->toDateString(),
        'grand_total' => 5000,
        'subtotal' => 5000,
        'status' => 'received',
        'notes' => '[PAYMENT] type=cash; paid=5000.00; remaining=0.00; status=paid',
    ]);

    Payment::query()->create([
        'payment_number' => 'PAY-AUTO-CR-'.uniqid(),
        'payee_type' => Vendor::class,
        'payee_id' => $vendor->id,
        'payee_name' => 'جرجس',
        'amount' => 10000,
        'payment_method' => 'Cash',
        'payment_date' => now()->toDateString(),
        'reference_type' => PurchaseBatch::class,
        'reference_id' => $credit->id,
        'status' => 'completed',
        'notes' => 'AUTO_PURCHASE_BATCH:'.$credit->id.' PUR-CREDIT',
        'user_id' => $user->id,
    ]);
    Payment::query()->create([
        'payment_number' => 'PAY-AUTO-CA-'.uniqid(),
        'payee_type' => Vendor::class,
        'payee_id' => $vendor->id,
        'payee_name' => 'جرجس',
        'amount' => 5000,
        'payment_method' => 'Cash',
        'payment_date' => now()->toDateString(),
        'reference_type' => PurchaseBatch::class,
        'reference_id' => $cash->id,
        'status' => 'completed',
        'notes' => 'AUTO_PURCHASE_BATCH:'.$cash->id.' PUR-CASH',
        'user_id' => $user->id,
    ]);
    Payment::query()->create([
        'payment_number' => 'PAY-REAL-'.uniqid(),
        'payee_type' => Supplier::class,
        'payee_id' => $supplier->id,
        'payee_name' => 'جرجس',
        'amount' => 3000,
        'payment_method' => 'cash',
        'payment_date' => now()->toDateString(),
        'status' => 'completed',
        'notes' => null,
        'user_id' => $user->id,
    ]);

    $response = $this->getJson('/api/inventory/suppliers/'.$supplier->id.'/account-summary')
        ->assertOk();

    expect((float) $response->json('summary.total_purchases'))->toBe(15000.0)
        ->and((float) $response->json('summary.total_paid'))->toBe(8000.0)
        ->and((float) $response->json('summary.outstanding'))->toBe(7000.0);

    $paymentAmounts = collect($response->json('payments'))->pluck('amount')->map(fn ($v) => (float) $v)->sort()->values()->all();
    expect($paymentAmounts)->toBe([3000.0, 5000.0]);

    $ledgerCredits = collect($response->json('ledger'))->sum(fn ($row) => (float) ($row['credit'] ?? 0));
    expect((float) $ledgerCredits)->toBe(8000.0);
});
