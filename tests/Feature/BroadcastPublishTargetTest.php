<?php

/**
 * Server-side broadcasts must go to the internal Reverb process, not the
 * public domain: POSTing /apps/{id}/events to https://inventory.phyzioline.com
 * hit the SPA and returned HTML ("Pusher error", 2026-07 → 2026-11-22).
 */
it('publishes broadcasts to the internal reverb server by default', function () {
    $options = config('broadcasting.connections.reverb.options');

    expect($options['host'])->toBe('127.0.0.1')
        ->and($options['scheme'])->toBe('http')
        ->and($options['useTLS'])->toBeFalse()
        ->and($options['port'])->toBe((int) env('REVERB_SERVER_PORT', 8080));
});
