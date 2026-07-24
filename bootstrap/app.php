<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withBroadcasting(
        channels: __DIR__.'/../routes/channels.php',
        attributes: ['middleware' => ['web', 'auth']],
    )
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware) {
        $trustedProxies = env('TRUSTED_PROXIES', '*');
        $middleware->trustProxies(
            at: $trustedProxies === '*'
                ? '*'
                : array_values(array_filter(array_map('trim', explode(',', (string) $trustedProxies))))
        );

        // No CSRF exemptions: this app has no inbound webhook receivers (its
        // only webhook traffic is outbound, to the monolith's CRM receiver —
        // see App\Infrastructure\External\MonolithCrmWebhookClient). Every
        // POST/PUT/PATCH/DELETE from the Inventory SPA goes through the `web`
        // group and must carry a CSRF token, same as the source monolith.
    })
    ->withExceptions(function (Exceptions $exceptions) {
        //
    })->create();
