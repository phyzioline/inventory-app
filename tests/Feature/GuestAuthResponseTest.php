<?php

/**
 * The SPA owns the login screen, so there is no named `login` route. Guests
 * must get a clean 401 (API / Reverb channel auth) or a redirect to the SPA
 * login — never a 500 "Route [login] not defined" (seen 2026-11-22 once
 * realtime started authorising channels).
 */
it('answers a guest broadcasting auth form post with 401 json', function () {
    $this->post('/broadcasting/auth', ['socket_id' => '1.1', 'channel_name' => 'private-inventory.stock'])
        ->assertUnauthorized()
        ->assertJson(['message' => 'Unauthenticated.']);
});

it('answers a guest api call without json accept header with 401', function () {
    $this->get('/api/inventory/orders')->assertUnauthorized();
});

it('sends guests of other authenticated web pages to the spa login', function () {
    $request = \Illuminate\Http\Request::create('/some-page', 'GET');
    $middleware = app(\Illuminate\Auth\Middleware\Authenticate::class);

    try {
        $middleware->handle($request, fn () => response('ok'));
        $this->fail('Expected AuthenticationException');
    } catch (\Illuminate\Auth\AuthenticationException $e) {
        expect($e->redirectTo($request))->toBe('/app/#/login');
    }
});
