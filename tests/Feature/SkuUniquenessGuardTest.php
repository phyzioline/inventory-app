<?php

use App\Application\Services\SkuUniquenessGuard;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\Sku;
use App\Models\User;
use Illuminate\Validation\ValidationException;

describe('SkuUniquenessGuard', function () {
    it('blocks creating the same SKU code for the same user on another channel', function () {
        $user = User::factory()->create();
        $this->actingAs($user);

        $chA = Channel::query()->create([
            'user_id' => $user->id,
            'name' => 'Channel A Guard',
            'slug' => 'channel-a-guard-'.uniqid(),
            'type' => 'marketplace',
            'is_active' => true,
        ]);
        $chB = Channel::query()->create([
            'user_id' => $user->id,
            'name' => 'Channel B Guard',
            'slug' => 'channel-b-guard-'.uniqid(),
            'type' => 'marketplace',
            'is_active' => true,
        ]);

        $code = 'DUP-GUARD-'.strtoupper(bin2hex(random_bytes(3)));

        $this->postJson('/api/inventory/skus', [
            'sku' => $code,
            'channel_id' => $chA->id,
            'name' => 'First listing',
            'selling_price' => 0,
            'cost_price' => 0,
        ])->assertCreated();

        $second = $this->postJson('/api/inventory/skus', [
            'sku' => $code,
            'channel_id' => $chB->id,
            'name' => 'Duplicate listing',
            'selling_price' => 0,
            'cost_price' => 0,
        ]);

        $second->assertStatus(422)
            ->assertJsonPath('sku_duplicate', true)
            ->assertJsonStructure(['message', 'duplicate_locations']);

        expect(Sku::query()->where('user_id', $user->id)->where('sku', $code)->count())->toBe(1);
    });

    it('flags duplicate siblings in channel SKU list enrichment', function () {
        $user = User::factory()->create();
        $this->actingAs($user);

        $chA = Channel::query()->create([
            'user_id' => $user->id,
            'name' => 'Flag Channel A',
            'slug' => 'flag-a-'.uniqid(),
            'type' => 'marketplace',
            'is_active' => true,
        ]);
        $chB = Channel::query()->create([
            'user_id' => $user->id,
            'name' => 'Flag Channel B',
            'slug' => 'flag-b-'.uniqid(),
            'type' => 'marketplace',
            'is_active' => true,
        ]);

        $code = 'FLAG-DUP-'.strtoupper(bin2hex(random_bytes(3)));

        // Seed two rows directly (legacy duplicates) without going through the new guard.
        $skuA = Sku::query()->create([
            'user_id' => $user->id,
            'channel_id' => $chA->id,
            'sku' => $code,
            'name' => 'A',
            'selling_price' => 0,
            'cost_price' => 0,
            'is_active' => true,
        ]);
        Sku::query()->create([
            'user_id' => $user->id,
            'channel_id' => $chB->id,
            'sku' => $code,
            'name' => 'B',
            'selling_price' => 0,
            'cost_price' => 0,
            'is_active' => true,
        ]);

        $map = SkuUniquenessGuard::duplicateMapForCodes((int) $user->id, [$code]);
        expect($map)->toHaveKey($code)
            ->and($map[$code])->toHaveCount(2);

        $response = $this->getJson('/api/inventory/skus?channel_id='.$chA->id.'&paginate=1&per_page=50');
        $response->assertOk();
        $rows = $response->json('data') ?? $response->json();
        $row = collect($rows)->firstWhere('id', $skuA->id);
        expect($row)->not->toBeNull()
            ->and($row['is_duplicate_sku'] ?? false)->toBeTrue()
            ->and($row['duplicate_action_required'] ?? false)->toBeTrue()
            ->and($row['duplicate_siblings'] ?? [])->not->toBeEmpty();

        $filtered = $this->getJson('/api/inventory/skus?channel_id='.$chA->id.'&paginate=1&per_page=50&duplicates_only=1');
        $filtered->assertOk();
        $filteredRows = $filtered->json('data') ?? $filtered->json();
        expect(collect($filteredRows)->pluck('id')->all())->toContain($skuA->id);

        $summary = $this->getJson('/api/inventory/skus/channel-summary?channel_id='.$chA->id);
        $summary->assertOk()
            ->assertJsonPath('duplicate_sku_count', 1);
    });

    it('allows different users to reuse the same SKU code', function () {
        $user1 = User::factory()->create();
        $user2 = User::factory()->create();

        $code = 'SHARED-CODE-'.strtoupper(bin2hex(random_bytes(3)));

        $this->actingAs($user1)->postJson('/api/inventory/skus', [
            'sku' => $code,
            'name' => 'User1',
            'selling_price' => 0,
            'cost_price' => 0,
        ])->assertCreated();

        $this->actingAs($user2)->postJson('/api/inventory/skus', [
            'sku' => $code,
            'name' => 'User2',
            'selling_price' => 0,
            'cost_price' => 0,
        ])->assertCreated();

        expect(
            Sku::withoutGlobalScope('user_isolation')->where('sku', $code)->count()
        )->toBe(2);
    });

    it('assertAvailable throws ValidationException with Arabic message', function () {
        $user = User::factory()->create();
        $this->actingAs($user);

        Sku::query()->create([
            'user_id' => $user->id,
            'sku' => 'ASSERT-DUP-001',
            'name' => 'X',
            'selling_price' => 0,
            'cost_price' => 0,
            'is_active' => true,
        ]);

        expect(fn () => SkuUniquenessGuard::assertAvailable((int) $user->id, 'ASSERT-DUP-001'))
            ->toThrow(ValidationException::class);
    });
});
