<?php

use App\Models\User;

/**
 * File imports hold an fpm worker for a long time; one account may send at most
 * 20 per minute (pool is 8 workers — 2026-11-23 saturation).
 */
it('throttles marketplace import previews per user', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    for ($i = 0; $i < 20; $i++) {
        $status = $this->postJson('/api/inventory/marketplace/import/preview', [])->status();
        expect($status)->not->toBe(429);
    }

    $this->postJson('/api/inventory/marketplace/import/preview', [])->assertStatus(429);
});

it('keeps a separate budget for each user', function () {
    $first = User::factory()->create();
    $this->actingAs($first);
    for ($i = 0; $i < 21; $i++) {
        $this->postJson('/api/inventory/marketplace/import/preview', []);
    }

    $this->actingAs(User::factory()->create());
    expect($this->postJson('/api/inventory/marketplace/import/preview', [])->status())->not->toBe(429);
});
