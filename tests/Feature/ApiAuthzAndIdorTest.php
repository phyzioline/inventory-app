<?php

use App\Application\Support\TenantContext;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\TenantMembership;
use App\Models\User;
use Illuminate\Support\Facades\Hash;

beforeEach(function () {
    TenantContext::flush();
    TenantContext::clearOverride();
});

it('returns 401 for protected endpoints without auth', function () {
    $this->getJson('/api/inventory/channels')->assertUnauthorized();
    $this->getJson('/api/inventory/skus')->assertUnauthorized();
    $this->getJson('/api/inventory/auth/me')->assertUnauthorized();
    $this->postJson('/api/inventory/staff', [
        'email' => 'x@example.com',
        'role' => 'viewer',
    ])->assertUnauthorized();
});

it('blocks cross-tenant channel show as 404 (IDOR)', function () {
    $owner = User::factory()->create();
    $attacker = User::factory()->create();

    $this->actingAs($owner);
    $channel = Channel::query()->create([
        'name' => 'Owner Channel',
        'slug' => 'owner-ch-'.uniqid(),
        'type' => 'store',
        'is_active' => true,
        'user_id' => $owner->id,
    ]);

    $this->actingAs($attacker);
    $this->getJson('/api/inventory/channels/'.$channel->id)->assertNotFound();
});

it('blocks cross-tenant sku show as 404 (IDOR)', function () {
    $owner = User::factory()->create();
    $attacker = User::factory()->create();

    $this->actingAs($owner);
    $channel = Channel::query()->create([
        'name' => 'Ch',
        'slug' => 'ch-'.uniqid(),
        'type' => 'store',
        'is_active' => true,
        'user_id' => $owner->id,
    ]);
    $master = MasterProduct::query()->create([
        'internal_name' => 'P',
        'is_active' => true,
        'user_id' => $owner->id,
    ]);
    $offer = InventoryOffer::query()->create([
        'master_product_id' => $master->id,
        'name' => 'O',
        'type' => 'single',
        'user_id' => $owner->id,
    ]);
    $sku = Sku::query()->create([
        'offer_id' => $offer->id,
        'sku' => 'IDOR-SKU-'.uniqid(),
        'channel_id' => $channel->id,
        'cost_price' => 1,
        'selling_price' => 2,
        'is_active' => true,
        'user_id' => $owner->id,
    ]);

    $this->actingAs($attacker);
    $this->getJson('/api/inventory/skus/'.$sku->id)->assertNotFound();
});

it('returns 422 when creating a channel without required fields', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    $this->postJson('/api/inventory/channels', [])
        ->assertStatus(422)
        ->assertJsonValidationErrors(['name']);
});

it('returns 422 when marketplace import is missing file', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    $this->postJson('/api/inventory/marketplace/import', [])
        ->assertStatus(422);
});

it('returns auth/me with role and abilities for owner', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    $this->getJson('/api/inventory/auth/me')
        ->assertOk()
        ->assertJsonPath('success', true)
        ->assertJsonPath('user.role', 'owner')
        ->assertJsonStructure(['user' => ['abilities', 'tenant_user_id', 'role']]);
});

it('forbids staff invite for viewer role (403)', function () {
    $owner = User::factory()->create();
    $viewer = User::factory()->create(['password' => Hash::make('password')]);

    TenantMembership::create([
        'tenant_user_id' => $owner->id,
        'member_user_id' => $viewer->id,
        'role' => 'viewer',
        'invited_at' => now(),
        'accepted_at' => now(),
    ]);

    $this->actingAs($viewer);
    TenantContext::flush();

    $this->postJson('/api/inventory/staff', [
        'email' => 'newstaff@example.com',
        'name' => 'New',
        'role' => 'warehouse',
    ])->assertForbidden();
});

it('forbids marketplace import for accountant role (403)', function () {
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

    $this->postJson('/api/inventory/marketplace/import', [
        'async' => true,
    ])->assertForbidden();
});
