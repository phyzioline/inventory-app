<?php

use App\Application\Services\SupplierStatementReconciliationService;
use App\Application\Support\TenantContext;
use App\Domain\Models\Wms\InventoryAuditLog;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\Payment;
use App\Domain\Models\Wms\PurchaseBatch;
use App\Domain\Models\Wms\PurchaseReturn;
use App\Domain\Models\Wms\Receipt;
use App\Domain\Models\Wms\Supplier;
use App\Domain\Models\Wms\Vendor;
use App\Models\User;

/**
 * When the owner agrees a supplier's statement balance, the account is brought to it with one
 * labelled, audited line — no invoice or payment is edited, no stock or treasury row is written.
 */
beforeEach(function () {
    TenantContext::flush();
    TenantContext::clearOverride();
});

function seedStatementSupplier(User $user, string $name, float $invoiceTotal): Supplier
{
    $vendor = Vendor::query()->create(['name' => $name, 'is_active' => true, 'current_balance' => 0, 'user_id' => $user->id]);
    $supplier = Supplier::query()->create(['name' => $name, 'balance' => 0, 'user_id' => $user->id]);
    PurchaseBatch::query()->create([
        'batch_number' => 'PB-STMT-'.uniqid(),
        'user_id' => $user->id,
        'vendor_id' => $vendor->id,
        'supplier_name_raw' => $name,
        'invoice_number' => 'PUR-STMT-'.uniqid(),
        'invoice_date' => now()->toDateString(),
        'grand_total' => $invoiceTotal,
        'subtotal' => $invoiceTotal,
        'status' => 'received',
        'notes' => '[PAYMENT] type=credit; paid=0.00; remaining='.number_format($invoiceTotal, 2, '.', '').'; status=confirmed',
    ]);

    return $supplier;
}

function statementOutstanding($test, Supplier $supplier): float
{
    return (float) $test->getJson('/api/inventory/suppliers/'.$supplier->id.'/account-summary')->assertOk()->json('summary.outstanding');
}

it('posts a credit note when the system balance is above the agreed statement', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    $supplier = seedStatementSupplier($user, 'مورد كشف', 10000);

    $args = ['--user' => $user->id, '--supplier' => 'مورد كشف', '--statement-balance' => 7500, '--note' => 'كشف المورد'];
    $this->artisan('inventory:reconcile-supplier-statement', $args)->assertSuccessful();
    expect(PurchaseReturn::query()->count())->toBe(0);

    $this->artisan('inventory:reconcile-supplier-statement', $args + ['--apply' => true])->assertSuccessful();

    $return = PurchaseReturn::query()->sole();
    expect((float) $return->grand_total)->toBe(2500.0)
        ->and($return->refund_method)->toBe('credit_note')
        ->and($return->reason)->toBe(SupplierStatementReconciliationService::REASON)
        ->and(statementOutstanding($this, $supplier))->toBe(7500.0)
        ->and(Receipt::query()->count())->toBe(0)
        ->and(Payment::query()->count())->toBe(0)
        ->and(InventoryTransaction::query()->count())->toBe(0)
        ->and(InventoryAuditLog::query()->where('action', SupplierStatementReconciliationService::AUDIT_ACTION)->count())->toBe(1);

    $ledger = collect($this->getJson('/api/inventory/suppliers/'.$supplier->id.'/account-summary')->json('ledger'));
    expect($ledger->pluck('description')->filter(fn ($d) => str_starts_with($d, 'Supplier statement reconciliation #'))->count())->toBe(1);

    // Re-running posts nothing more.
    $this->artisan('inventory:reconcile-supplier-statement', $args + ['--apply' => true])
        ->expectsOutput('Already matches the statement.')
        ->assertSuccessful();
    expect(PurchaseReturn::query()->count())->toBe(1);
});

it('posts an open adjustment invoice when the system balance is below the agreed statement', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    $supplier = seedStatementSupplier($user, 'مورد كشف ٢', 4930);

    $this->artisan('inventory:reconcile-supplier-statement', [
        '--user' => $user->id, '--supplier' => 'مورد كشف ٢', '--statement-balance' => 5000, '--apply' => true,
    ])->assertSuccessful();

    $adjustment = PurchaseBatch::query()->where('invoice_number', 'like', 'STMT-%')->sole();
    expect((float) $adjustment->grand_total)->toBe(70.0)
        ->and($adjustment->items()->count())->toBe(0)
        ->and(\App\Domain\ValueObjects\PurchasePaymentMeta::fromNotes($adjustment->notes)->type)->toBe('credit')
        ->and(statementOutstanding($this, $supplier))->toBe(5000.0)
        ->and(Payment::query()->count())->toBe(0)
        ->and(InventoryTransaction::query()->count())->toBe(0);
});
