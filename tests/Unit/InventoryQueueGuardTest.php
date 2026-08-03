<?php

uses(Tests\TestCase::class);

use App\Support\InventoryQueueGuard;
use Illuminate\Support\Facades\Cache;

it('marks queued marketplace import jobs as failed after the stale TTL', function () {
    Cache::put('marketplace_import_job:mktimp_1_stale.test', [
        'status' => 'queued',
        'updated_at' => now()->subSeconds(InventoryQueueGuard::QUEUED_STALE_SECONDS + 5)->toIso8601String(),
    ], now()->addHour());

    $payload = InventoryQueueGuard::refreshStaleJobPayload('mktimp_1_stale.test', [
        'status' => 'queued',
        'updated_at' => now()->subSeconds(InventoryQueueGuard::QUEUED_STALE_SECONDS + 5)->toIso8601String(),
    ]);

    expect($payload['status'])->toBe('failed')
        ->and($payload['error'])->toContain('queue');
});

it('leaves fresh queued jobs untouched', function () {
    $fresh = [
        'status' => 'queued',
        'updated_at' => now()->toIso8601String(),
    ];

    $payload = InventoryQueueGuard::refreshStaleJobPayload('mktimp_1_fresh.test', $fresh);

    expect($payload['status'])->toBe('queued');
});
