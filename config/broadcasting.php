<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Default Broadcaster
    |--------------------------------------------------------------------------
    |
    | This app runs its own Reverb server, fully independent from the
    | monolith's Reverb instance — separate app id/key/secret, separate port.
    | See docs note in .env.example for the required env vars.
    |
    */
    'default' => env('BROADCAST_CONNECTION', 'reverb'),

    'connections' => [

        'reverb' => [
            'driver' => 'reverb',
            'key' => env('REVERB_APP_KEY'),
            'secret' => env('REVERB_APP_SECRET'),
            'app_id' => env('REVERB_APP_ID'),
            /*
             * Server-side publishing goes straight to the internal Reverb
             * process, never through the public domain: REVERB_HOST/PORT/
             * SCHEME/PATH describe the browser-facing nginx sub-path, and
             * POSTing /apps/{id}/events there lands on the SPA (HTML reply,
             * "Pusher error"). Override with REVERB_PUBLISH_* only when the
             * Reverb process runs on another host.
             */
            'options' => [
                'host' => env('REVERB_PUBLISH_HOST', '127.0.0.1'),
                'port' => (int) env('REVERB_PUBLISH_PORT', env('REVERB_SERVER_PORT', 8080)),
                'scheme' => env('REVERB_PUBLISH_SCHEME', 'http'),
                'useTLS' => env('REVERB_PUBLISH_SCHEME', 'http') === 'https',
            ],
            'client_options' => [],
        ],

        'log' => ['driver' => 'log'],
        'null' => ['driver' => 'null'],

    ],

];
