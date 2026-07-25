<?php

use App\Http\Middleware\CheckSubscriptionLimit;
use App\Http\Middleware\EnsureSuperAdmin;
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

        // Every POST/PUT/PATCH/DELETE from the Inventory SPA goes through the
        // `web` group and must carry a CSRF token. The one exception is Paymob's
        // server-to-server payment webhook (App\Presentation\Http\Controllers\
        // Api\PaymobWebhookController), which is verified by HMAC instead — see
        // routes/web.php.
        $middleware->validateCsrfTokens(except: [
            'webhooks/paymob',
        ]);

        $middleware->alias([
            'super.admin' => EnsureSuperAdmin::class,
            'check.subscription.limit' => CheckSubscriptionLimit::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions) {
        //
    })->create();
