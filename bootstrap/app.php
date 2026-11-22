<?php

use App\Http\Middleware\CheckSubscriptionLimit;
use App\Http\Middleware\EnsureSuperAdmin;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

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
        // `web` group and must carry a CSRF token. The exceptions are Paymob's
        // server-to-server payment webhook (App\Presentation\Http\Controllers\
        // Api\PaymobWebhookController), which is verified by HMAC instead — see
        // routes/web.php — and the Tauri desktop sync endpoints, which
        // authenticate with a Sanctum bearer token (no session cookie, so no
        // CSRF token to send) — see InventoryDesktopSyncController.
        $middleware->validateCsrfTokens(except: [
            'webhooks/paymob',
            'api/v1/inventory/desktop/sync/*',
        ]);

        // The app has no named `login` route (login lives in the SPA), so the
        // framework default `route('login')` turned every guest hit into a 500.
        $middleware->redirectGuestsTo('/app/#/login');

        $middleware->alias([
            'super.admin' => EnsureSuperAdmin::class,
            'check.subscription.limit' => CheckSubscriptionLimit::class,
            'inventory.ability' => \App\Http\Middleware\EnsureInventoryAbility::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions) {
        // pusher-js posts /broadcasting/auth as a form (no JSON Accept header):
        // answer guests with 401/403 JSON instead of a redirect page.
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->expectsJson()
                || $request->is('api/*', 'broadcasting/*')
        );
    })->create();
