<?php

return [

    'postmark' => [
        'token' => env('POSTMARK_TOKEN'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'resend' => [
        'key' => env('RESEND_KEY'),
    ],

    /*
    |--------------------------------------------------------------------------
    | Monolith integration (outbound only)
    |--------------------------------------------------------------------------
    |
    | This app no longer shares a database/queue with the phyzioline monolith.
    | Customer/Vendor create-or-update pushes a best-effort webhook to the
    | monolith's CRM receiver instead of dispatching an in-process job — see
    | App\Infrastructure\External\MonolithCrmWebhookClient. The receiver
    | endpoint itself is out of scope for this app (built in the monolith repo).
    |
    */
    'monolith' => [
        'crm_webhook_url' => env('MONOLITH_CRM_WEBHOOK_URL'),
        'webhook_secret' => env('MONOLITH_WEBHOOK_SECRET'),
    ],

    /*
    |--------------------------------------------------------------------------
    | Gemini (Google Generative AI)
    |--------------------------------------------------------------------------
    |
    | Used directly over HTTP by App\Infrastructure\External\GeminiService
    | (purchase-document smart import) and the barcode-return OCR flow — no
    | dependency on the monolith's AI module / BrainFallbackService.
    |
    */
    'gemini' => [
        'api_key' => env('GEMINI_API_KEY'),
        'model' => env('GEMINI_MODEL', 'gemini-2.0-flash'),
        'timeout' => env('GEMINI_TIMEOUT', 20),
        // Toggle between the local rule-based purchase-doc parser (default,
        // no API cost) and the Gemini AI parser in PurchaseImportService::aiParse().
        'smart_import_local' => env('GEMINI_SMART_IMPORT_LOCAL', true),
    ],

];
