<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote')->hourly();

Schedule::command('inventory:ensure-queue-healthy')
    ->everyMinute()
    ->withoutOverlapping(2)
    ->runInBackground();

// Nightly dry-run: classify received PO ledger drift; fail if NEW/WORSE vs baseline or any orphan.
Schedule::command('inventory:audit-purchase-receive-ledger --fail-on-regression')
    ->dailyAt('02:40')
    ->withoutOverlapping(120)
    ->runInBackground()
    ->appendOutputTo(storage_path('logs/purchase-receive-ledger-audit.log'));
