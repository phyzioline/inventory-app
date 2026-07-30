<?php

namespace App\Infrastructure\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Http\UploadedFile;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use App\Application\Services\MarketplaceImportService;
use App\Application\Support\TenantContext;
use App\Models\User;

/**
 * Async marketplace sheet import. HTTP can dispatch this and return 202 + job_key
 * while the worker runs MarketplaceImportService with the same idempotency guards.
 */
class ProcessMarketplaceImportJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 600;

    public function __construct(
        public int $userId,
        public int $channelId,
        public bool $lockChannel,
        public string $storedRelativePath,
        public string $originalName,
        public string $jobKey,
    ) {}

    public function handle(MarketplaceImportService $importService): void
    {
        Cache::put($this->cacheKey(), [
            'status' => 'running',
            'updated_at' => now()->toIso8601String(),
        ], now()->addHours(6));

        $user = User::query()->find($this->userId);
        if (! $user) {
            $this->failStatus('User not found');

            return;
        }

        Auth::login($user);
        TenantContext::flush();

        $absolute = Storage::disk('local')->path($this->storedRelativePath);
        if (! is_file($absolute)) {
            $this->failStatus('Stored import file missing');

            return;
        }

        try {
            $uploaded = new UploadedFile(
                $absolute,
                $this->originalName,
                mime_content_type($absolute) ?: 'application/octet-stream',
                null,
                true
            );
            $results = $importService->import($uploaded, $this->channelId, $this->lockChannel);
            Cache::put($this->cacheKey(), [
                'status' => 'completed',
                'result' => $results,
                'updated_at' => now()->toIso8601String(),
            ], now()->addHours(6));
        } catch (\Throwable $e) {
            Log::error('ProcessMarketplaceImportJob failed', [
                'job_key' => $this->jobKey,
                'error' => $e->getMessage(),
            ]);
            $this->failStatus($e->getMessage());
            throw $e;
        } finally {
            Auth::logout();
            Storage::disk('local')->delete($this->storedRelativePath);
        }
    }

    private function cacheKey(): string
    {
        return 'marketplace_import_job:'.$this->jobKey;
    }

    private function failStatus(string $message): void
    {
        Cache::put($this->cacheKey(), [
            'status' => 'failed',
            'error' => $message,
            'updated_at' => now()->toIso8601String(),
        ], now()->addHours(6));
    }
}
