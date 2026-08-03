<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Redis;

/**
 * Keeps marketplace async imports from hanging forever when the inventory
 * queue worker is down or jobs stall in Redis.
 *
 * Ops: systemd unit inventory-queue.service must stay enabled+running.
 */
final class InventoryQueueGuard
{
    public const WORKER_PROCESS_PATTERN = 'inventory.phyzioline.com/artisan queue:work';

    /** Seconds a job may stay "queued" before it is marked failed. */
    public const QUEUED_STALE_SECONDS = 120;

    /** Seconds a job may stay "running" before it is marked failed. */
    public const RUNNING_STALE_SECONDS = 900;

    public const ACTIVE_JOBS_CACHE_KEY = 'marketplace_import_jobs_active';

    public static function workerAppearsAlive(): bool
    {
        if (config('queue.default') === 'sync') {
            return true;
        }

        $out = [];
        $code = 1;
        @exec('pgrep -f '.escapeshellarg(self::WORKER_PROCESS_PATTERN).' 2>/dev/null', $out, $code);

        return $code === 0 && $out !== [];
    }

    public static function pendingQueueSize(): int
    {
        if (config('queue.default') !== 'redis') {
            return 0;
        }

        try {
            $connection = (string) config('queue.connections.redis.connection', 'default');
            $queue = (string) config('queue.connections.redis.queue', 'default');

            return (int) Redis::connection($connection)->llen('queues:'.$queue);
        } catch (\Throwable $e) {
            Log::warning('InventoryQueueGuard: could not read queue length', [
                'error' => $e->getMessage(),
            ]);

            return 0;
        }
    }

    public static function registerActiveJob(string $jobKey): void
    {
        $active = Cache::get(self::ACTIVE_JOBS_CACHE_KEY, []);
        if (! is_array($active)) {
            $active = [];
        }
        $active[$jobKey] = now()->toIso8601String();
        Cache::put(self::ACTIVE_JOBS_CACHE_KEY, $active, now()->addHours(12));
    }

    public static function forgetActiveJob(string $jobKey): void
    {
        $active = Cache::get(self::ACTIVE_JOBS_CACHE_KEY, []);
        if (! is_array($active) || ! isset($active[$jobKey])) {
            return;
        }
        unset($active[$jobKey]);
        Cache::put(self::ACTIVE_JOBS_CACHE_KEY, $active, now()->addHours(12));
    }

    /**
     * If payload is queued/running past TTL, mark failed and return updated payload.
     *
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public static function refreshStaleJobPayload(string $jobKey, array $payload): array
    {
        $status = (string) ($payload['status'] ?? '');
        if (! in_array($status, ['queued', 'running'], true)) {
            return $payload;
        }

        $updatedAt = isset($payload['updated_at']) ? strtotime((string) $payload['updated_at']) : false;
        if ($updatedAt === false) {
            return $payload;
        }

        $age = time() - $updatedAt;
        $limit = $status === 'queued' ? self::QUEUED_STALE_SECONDS : self::RUNNING_STALE_SECONDS;
        if ($age < $limit) {
            return $payload;
        }

        $error = $status === 'queued'
            ? 'الاستيراد معلّق: معالج الطوابير (queue worker) غير شغّال أو متأخر. أعد المحاولة بعد دقيقة، وإن تكرر راجع خدمة inventory-queue.'
            : 'الاستيراد استغرق وقتاً أطول من المتوقع وتوقف. أعد رفع الشيت؛ إن تكرر راجع سجلات الـ queue worker.';

        $failed = [
            'status' => 'failed',
            'error' => $error,
            'updated_at' => now()->toIso8601String(),
            'stale_from' => $status,
            'stale_age_seconds' => $age,
        ];

        Cache::put('marketplace_import_job:'.$jobKey, $failed, now()->addHours(6));
        self::forgetActiveJob($jobKey);

        Log::critical('Marketplace import job marked stale/failed', [
            'job_key' => $jobKey,
            'previous_status' => $status,
            'age_seconds' => $age,
            'worker_alive' => self::workerAppearsAlive(),
            'pending_queue' => self::pendingQueueSize(),
        ]);

        return $failed;
    }

    /**
     * Sweep registered active jobs and fail any that are stale.
     *
     * @return array{checked: int, failed: int, worker_alive: bool, pending: int}
     */
    public static function sweepStaleJobs(): array
    {
        $active = Cache::get(self::ACTIVE_JOBS_CACHE_KEY, []);
        if (! is_array($active)) {
            $active = [];
        }

        $failed = 0;
        foreach (array_keys($active) as $jobKey) {
            $jobKey = (string) $jobKey;
            $payload = Cache::get('marketplace_import_job:'.$jobKey);
            if (! is_array($payload)) {
                unset($active[$jobKey]);
                continue;
            }
            $before = (string) ($payload['status'] ?? '');
            $after = self::refreshStaleJobPayload($jobKey, $payload);
            if (($after['status'] ?? '') === 'failed' && $before !== 'failed') {
                $failed++;
            }
            if (in_array((string) ($after['status'] ?? ''), ['completed', 'failed'], true)) {
                unset($active[$jobKey]);
            }
        }

        Cache::put(self::ACTIVE_JOBS_CACHE_KEY, $active, now()->addHours(12));

        $workerAlive = self::workerAppearsAlive();
        $pending = self::pendingQueueSize();

        if (! $workerAlive && ($pending > 0 || $active !== [])) {
            Log::critical('Inventory queue worker appears DOWN while jobs are pending', [
                'pending_queue' => $pending,
                'active_import_jobs' => count($active),
            ]);
        }

        return [
            'checked' => count($active) + $failed,
            'failed' => $failed,
            'worker_alive' => $workerAlive,
            'pending' => $pending,
        ];
    }
}
