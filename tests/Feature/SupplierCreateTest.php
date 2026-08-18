<?php

use App\Application\Support\TenantContext;
use App\Domain\Models\Wms\Supplier;
use App\Models\User;

beforeEach(function () {
    TenantContext::flush();
    TenantContext::clearOverride();
});

it('creates a supplier with name only and defaults balance to zero', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    $response = $this->postJson('/api/inventory/suppliers', [
        'name' => 'الجيد',
    ]);

    $response->assertCreated()
        ->assertJsonPath('name', 'الجيد');

    expect((float) $response->json('balance'))->toBe(0.0);

    $supplier = Supplier::query()->findOrFail((int) $response->json('id'));
    expect((float) $supplier->balance)->toBe(0.0)
        ->and((int) $supplier->user_id)->toBe((int) $user->id);
});

it('creates a supplier with optional phone', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    $this->postJson('/api/inventory/suppliers', [
        'name' => 'مورد الهاتف',
        'phone' => '01000000000',
    ])->assertCreated()
        ->assertJsonPath('phone', '01000000000');
});

it('rejects creating a supplier without a name', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    $this->postJson('/api/inventory/suppliers', [
        'phone' => '01000000000',
    ])->assertStatus(422);
});
