<?php

use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Web Routes
|--------------------------------------------------------------------------
|
| This app is an API backend for the Inventory React SPA (served
| separately from resources/frontend) plus the Tauri desktop warehouse
| app. There is no server-rendered UI here.
|
| routes/api.php is included under the `web` middleware group (session +
| CSRF), not Laravel's stateless `api` group, because auth is
| session-cookie based — same pattern the source Modules/Inventory/routes/
| api.php used inside the monolith (InventoryServiceProvider registered it
| via Route::middleware('web')->group(...) rather than the framework's
| auto-prefixed `api:` routing key, to avoid a double "/api" prefix and to
| keep CSRF protection active for POST/PUT/DELETE requests from the SPA).
|
*/

Route::middleware('web')->group(base_path('routes/api.php'));

// Paymob payment webhook — deliberately OUTSIDE the group above: Paymob calls
// this server-to-server with no session cookie, verified by HMAC instead of
// CSRF (see bootstrap/app.php's validateCsrfTokens except list).
Route::post('webhooks/paymob', \App\Presentation\Http\Controllers\Api\PaymobWebhookController::class);

// Bare domain → SPA. The React app is a HashRouter (see tauri.conf.json /
// resources/frontend), so this single static entry point is enough — no
// catch-all route needed for client-side sub-routes.
Route::redirect('/', '/app/');
