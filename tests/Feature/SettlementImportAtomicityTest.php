<?php

use App\Application\Services\SettlementService;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\Settlement;
use App\Domain\Models\Wms\SettlementItem;
use App\Models\User;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Auth;

describe('Settlement import atomicity', function () {

    it('rolls back settlement items when reconcile fails after import', function () {
        $user = User::factory()->create();
        $this->actingAs($user);
        $this->withoutMiddleware(ValidateCsrfToken::class);

        $channel = Channel::factory()->create([
            'user_id' => $user->id,
            'name' => 'Amazon EG',
            'slug' => 'amazon-eg-'.uniqid(),
            'type' => 'fba',
            'is_active' => true,
        ]);

        $csv = implode("\n", [
            'settlement-id,settlement-start-date,settlement-end-date,order-id,transaction-type,amount,sku,quantity-purchased,currency',
            'TEST-ATOMIC-001,2026-07-01,2026-07-07,111-ATOMIC-0000001,Order,100.00,SKU-A,1,EGP',
        ]);
        $tmp = tempnam(sys_get_temp_dir(), 'set_').'.csv';
        file_put_contents($tmp, $csv);
        $upload = new UploadedFile($tmp, 'settlement.csv', 'text/csv', null, true);

        $real = app(SettlementService::class);
        $mock = Mockery::mock(SettlementService::class);
        $mock->shouldReceive('importAmazonSettlement')
            ->once()
            ->andReturnUsing(fn (int $channelId, string $path) => $real->importAmazonSettlement($channelId, $path));
        $mock->shouldReceive('reconcile')
            ->once()
            ->andThrow(new RuntimeException('forced reconcile failure'));
        $mock->shouldReceive('buildReconciliationSummary')->never();
        $this->app->instance(SettlementService::class, $mock);

        $response = $this->post('/api/inventory/settlements/import', [
            'channel_id' => $channel->id,
            'file' => $upload,
        ]);

        $response->assertStatus(500);
        expect(Settlement::withoutGlobalScopes()->where('report_id', 'TEST-ATOMIC-001')->count())->toBe(0);
        expect(SettlementItem::query()->count())->toBe(0);
    });

    it('requires --user on reconcile-settlements artisan command', function () {
        $this->artisan('inventory:reconcile-settlements')
            ->assertFailed();
    });

    it('scopes reconcile-settlements to the logged-in tenant', function () {
        $owner = User::factory()->create();
        $other = User::factory()->create();

        $ownerChannel = Channel::factory()->create([
            'user_id' => $owner->id,
            'slug' => 'own-'.uniqid(),
            'is_active' => true,
        ]);
        $otherChannel = Channel::factory()->create([
            'user_id' => $other->id,
            'slug' => 'oth-'.uniqid(),
            'is_active' => true,
        ]);

        Auth::login($owner);
        Settlement::create([
            'channel_id' => $ownerChannel->id,
            'report_id' => 'OWN-REC-1',
            'start_date' => '2026-07-01',
            'end_date' => '2026-07-07',
            'total_amount' => 10,
            'status' => 'draft',
        ]);

        Auth::login($other);
        Settlement::create([
            'channel_id' => $otherChannel->id,
            'report_id' => 'OTH-REC-1',
            'start_date' => '2026-07-01',
            'end_date' => '2026-07-07',
            'total_amount' => 20,
            'status' => 'draft',
        ]);

        Auth::logout();

        $this->artisan('inventory:reconcile-settlements', [
            '--user' => $owner->id,
            '--dry-run' => true,
        ])->assertSuccessful()
            ->expectsOutputToContain('Settlements to reconcile (user='.$owner->id.'): 1');
    });

});
