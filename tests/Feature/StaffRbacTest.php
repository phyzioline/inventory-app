<?php

use App\Application\Services\InventoryAbilityService;
use App\Application\Support\TenantContext;
use App\Domain\Models\Wms\TenantMembership;
use App\Models\User;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;

beforeEach(function () {
    TenantContext::flush();
    TenantContext::clearOverride();
});

it('scopes IsIsolatedByUser to tenant owner for staff members', function () {
    $owner = User::factory()->create();
    $staff = User::factory()->create([
        'password' => Hash::make('password'),
    ]);

    TenantMembership::create([
        'tenant_user_id' => $owner->id,
        'member_user_id' => $staff->id,
        'role' => 'warehouse',
        'invited_at' => now(),
        'accepted_at' => now(),
    ]);

    Auth::login($staff);
    TenantContext::flush();

    expect(TenantContext::id())->toBe((int) $owner->id)
        ->and(TenantContext::role())->toBe('warehouse')
        ->and(app(InventoryAbilityService::class)->can('transfers.write'))->toBeTrue()
        ->and(app(InventoryAbilityService::class)->can('marketplace.import'))->toBeFalse();
});

it('denies accountant marketplace import ability', function () {
    $owner = User::factory()->create();
    $staff = User::factory()->create();

    TenantMembership::create([
        'tenant_user_id' => $owner->id,
        'member_user_id' => $staff->id,
        'role' => 'accountant',
        'invited_at' => now(),
        'accepted_at' => now(),
    ]);

    Auth::login($staff);
    TenantContext::flush();

    expect(app(InventoryAbilityService::class)->can('finance.write'))->toBeTrue()
        ->and(app(InventoryAbilityService::class)->can('marketplace.import'))->toBeFalse()
        ->and(app(InventoryAbilityService::class)->can('withdrawal.approve'))->toBeTrue();
});

it('owner has wildcard abilities', function () {
    $owner = User::factory()->create();
    Auth::login($owner);
    TenantContext::flush();

    expect(TenantContext::role())->toBe('owner')
        ->and(app(InventoryAbilityService::class)->can('staff.manage'))->toBeTrue()
        ->and(app(InventoryAbilityService::class)->abilities())->toContain('*');
});

it('cashier can sell but cannot read finance or reports', function () {
    $owner = User::factory()->create();
    $cashier = User::factory()->create();

    TenantMembership::create([
        'tenant_user_id' => $owner->id,
        'member_user_id' => $cashier->id,
        'role' => 'cashier',
        'invited_at' => now(),
        'accepted_at' => now(),
    ]);

    Auth::login($cashier);
    TenantContext::flush();

    $abilities = app(InventoryAbilityService::class);
    expect(TenantContext::id())->toBe((int) $owner->id)
        ->and(TenantContext::role())->toBe('cashier')
        ->and($abilities->can('sales.write'))->toBeTrue()
        ->and($abilities->can('orders.read'))->toBeTrue()
        ->and($abilities->can('finance.read'))->toBeFalse()
        ->and($abilities->can('reports.read'))->toBeFalse()
        ->and($abilities->can('cost.read'))->toBeFalse()
        ->and($abilities->can('staff.manage'))->toBeFalse();
});

it('cashier customer list uses tenant owner scope', function () {
    $owner = User::factory()->create();
    $cashier = User::factory()->create();

    TenantMembership::create([
        'tenant_user_id' => $owner->id,
        'member_user_id' => $cashier->id,
        'role' => 'cashier',
        'invited_at' => now(),
        'accepted_at' => now(),
    ]);

    \App\Domain\Models\Wms\Customer::query()->create([
        'name' => 'Tenant Customer',
        'user_id' => $owner->id,
        'current_balance' => 0,
        'currency' => 'EGP',
        'is_active' => true,
        'credit_limit' => 0,
    ]);

    $this->actingAs($cashier);
    TenantContext::flush();

    $this->getJson('/api/inventory/customers/paginated-with-summary')
        ->assertOk()
        ->assertJsonPath('meta.total', 1)
        ->assertJsonPath('data.0.name', 'Tenant Customer');
});

it('forbids cashier from treasury and profit report endpoints', function () {
    $owner = User::factory()->create();
    $cashier = User::factory()->create();

    TenantMembership::create([
        'tenant_user_id' => $owner->id,
        'member_user_id' => $cashier->id,
        'role' => 'cashier',
        'invited_at' => now(),
        'accepted_at' => now(),
    ]);

    $this->actingAs($cashier);
    TenantContext::flush();

    $this->getJson('/api/inventory/finance/treasury-panels')->assertForbidden();
    $this->getJson('/api/inventory/reports/profit-summary')->assertForbidden();
    $this->getJson('/api/inventory/finance/cash-flow-stats')->assertForbidden();
});

it('allows accountant finance read but forbids staff invite', function () {
    $owner = User::factory()->create();
    $accountant = User::factory()->create();

    TenantMembership::create([
        'tenant_user_id' => $owner->id,
        'member_user_id' => $accountant->id,
        'role' => 'accountant',
        'invited_at' => now(),
        'accepted_at' => now(),
    ]);

    $this->actingAs($accountant);
    TenantContext::flush();

    $this->getJson('/api/inventory/finance/treasury-panels')->assertOk();
    $this->getJson('/api/inventory/reports/profit-summary?'.http_build_query([
        'start_date' => now()->subDays(7)->toDateString(),
        'end_date' => now()->toDateString(),
    ]))->assertOk();

    $this->postJson('/api/inventory/staff', [
        'email' => 'blocked@example.com',
        'name' => 'Blocked',
        'role' => 'cashier',
    ])->assertForbidden();
});

it('cashier channel summary uses tenant inventory quantities not auth user id', function () {
    $owner = User::factory()->create();
    $cashier = User::factory()->create();

    TenantMembership::create([
        'tenant_user_id' => $owner->id,
        'member_user_id' => $cashier->id,
        'role' => 'cashier',
        'invited_at' => now(),
        'accepted_at' => now(),
    ]);

    $channel = \App\Domain\Models\Wms\Channel::factory()->create([
        'user_id' => $owner->id,
        'name' => 'المحل',
        'slug' => 'store-cashier-qty-'.uniqid(),
        'type' => 'store',
    ]);

    $location = \App\Domain\Models\Wms\InventoryLocation::factory()->create([
        'user_id' => $owner->id,
        'name' => 'المحل',
        'type' => 'store',
        'channel_id' => null,
        'is_active' => true,
    ]);

    $sku = \App\Domain\Models\Wms\Sku::factory()->create([
        'user_id' => $owner->id,
        'channel_id' => $channel->id,
        'sku' => 'CASHIER-QTY-1',
        'name' => 'Cashier Qty Product',
        'selling_price' => 100,
        'cost_price' => 40,
        'offer_id' => null,
    ]);

    \App\Domain\Models\Wms\SkuInventory::factory()->create([
        'user_id' => $owner->id,
        'sku_id' => $sku->id,
        'location_id' => $location->id,
        'quantity' => 17,
    ]);

    \App\Application\Services\ChannelStockResolver::clearCache();

    $this->actingAs($cashier);
    TenantContext::flush();

    $summary = $this->getJson('/api/inventory/skus/channel-summary?channel_id='.$channel->id)
        ->assertOk()
        ->json();

    expect((int) ($summary['products'] ?? 0))->toBeGreaterThan(0)
        ->and((float) ($summary['pieces'] ?? 0))->toBeGreaterThan(0)
        ->and((float) ($summary['purchaseCost'] ?? -1))->toBe(0.0);
});
