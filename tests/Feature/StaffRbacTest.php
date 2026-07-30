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
