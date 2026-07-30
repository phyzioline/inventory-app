<?php

use App\Models\User;
use App\Domain\Models\Wms\CapitalSource;
use App\Domain\Models\Wms\ProfitDistribution;
use App\Domain\Models\Wms\Supplier;
use App\Domain\Models\Wms\Payment;
use App\Domain\Models\Wms\Receipt;

it('scopes profit distributions to the authenticated tenant', function () {
    $owner = User::factory()->create();
    $other = User::factory()->create();

    $this->actingAs($other);
    $otherSource = CapitalSource::query()->create([
        'name' => 'Other Capital',
        'type' => 'partner',
        'amount' => 1000,
        'ownership_percentage' => 100,
        'user_id' => $other->id,
    ]);
    $foreign = ProfitDistribution::query()->create([
        'user_id' => $other->id,
        'capital_source_id' => $otherSource->id,
        'amount' => 50,
        'period_start' => now()->startOfMonth()->toDateString(),
        'period_end' => now()->endOfMonth()->toDateString(),
        'status' => 'pending',
    ]);

    $this->actingAs($owner);
    expect(ProfitDistribution::query()->find($foreign->id))->toBeNull();

    $this->getJson('/api/inventory/profit-distributions/'.$foreign->id)
        ->assertNotFound();
});

it('rejects regenerate-master-products for non super-admin', function () {
    $user = User::factory()->create(['is_super_admin' => false]);
    $victim = User::factory()->create();

    $this->actingAs($user)
        ->postJson('/api/inventory/admin/regenerate-master-products', ['user_id' => $victim->id])
        ->assertForbidden();
});

it('records supplier pay via Payment and TreasurySpendGuard', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    CapitalSource::query()->create([
        'name' => 'Seed Capital',
        'type' => 'owner',
        'amount' => 5000,
        'ownership_percentage' => 100,
        'user_id' => $user->id,
    ]);

    Receipt::query()->create([
        'receipt_number' => 'RCPT-SUP-PAY-1',
        'type' => 'capital',
        'amount' => 5000,
        'receipt_date' => now()->toDateString(),
        'user_id' => $user->id,
    ]);

    $supplier = Supplier::query()->create([
        'name' => 'Test Supplier',
        'balance' => 200,
        'is_active' => true,
        'user_id' => $user->id,
    ]);

    $response = $this->postJson('/api/inventory/suppliers/'.$supplier->id.'/pay', [
        'amount' => 50,
        'payment_method' => 'cash',
        'notes' => 'Phase A pay',
    ]);

    $response->assertSuccessful();
    expect((float) $supplier->fresh()->balance)->toBe(150.0)
        ->and(Payment::query()->where('payee_id', $supplier->id)->count())->toBe(1);
});
