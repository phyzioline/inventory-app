<?php

namespace App\Presentation\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class AdminErrorLogController extends Controller
{
    private string $logPath;

    public function __construct()
    {
        $this->logPath = storage_path('logs/laravel.log');
    }

    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'since'    => 'nullable|date',
            'until'    => 'nullable|date',
            'search'   => 'nullable|string|max:200',
            'per_page' => 'nullable|integer|min:1|max:500',
            'page'     => 'nullable|integer|min:1',
        ]);

        $since    = isset($validated['since'])  ? Carbon::parse($validated['since'])  : Carbon::now()->subDay();
        $until    = isset($validated['until'])  ? Carbon::parse($validated['until'])  : Carbon::now();
        $search   = $validated['search'] ?? null;
        $perPage  = (int) ($validated['per_page'] ?? 50);
        $page     = (int) ($validated['page'] ?? 1);

        $errors = $this->parseErrors($since, $until, $search);

        $total  = count($errors);
        $offset = ($page - 1) * $perPage;
        $items  = array_slice($errors, $offset, $perPage);

        return response()->json([
            'data'         => $items,
            'total'        => $total,
            'per_page'     => $perPage,
            'current_page' => $page,
            'last_page'    => max(1, (int) ceil($total / $perPage)),
        ]);
    }

    private function parseErrors(Carbon $since, Carbon $until, ?string $search): array
    {
        if (! file_exists($this->logPath)) {
            return [];
        }

        $errors   = [];
        $handle   = fopen($this->logPath, 'r');
        $current  = null;
        $stackBuf = [];

        $flush = function () use (&$errors, &$current, &$stackBuf, $since, $until, $search): void {
            if ($current === null) {
                return;
            }
            $current['stack'] = implode("\n", $stackBuf);
            $ts = Carbon::parse($current['timestamp']);
            if ($ts->between($since, $until)) {
                if (! $search || stripos($current['message'] . $current['stack'], $search) !== false) {
                    $errors[] = $current;
                }
            }
            $current  = null;
            $stackBuf = [];
        };

        while (($line = fgets($handle)) !== false) {
            // New log entry: [YYYY-MM-DD HH:MM:SS] environment.LEVEL: message
            if (preg_match('/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] (\w+)\.(\w+): (.+)$/', rtrim($line), $m)) {
                $flush();
                if ($m[3] === 'ERROR') {
                    $current = [
                        'timestamp'   => $m[1],
                        'environment' => $m[2],
                        'level'       => $m[3],
                        'message'     => $this->truncate($m[4], 500),
                        'user_id'     => $this->extractUserId($m[4]),
                        'stack'       => '',
                    ];
                }
            } elseif ($current !== null) {
                $stackBuf[] = rtrim($line);
            }
        }

        $flush();
        fclose($handle);

        // Newest first
        return array_reverse($errors);
    }

    private function extractUserId(string $message): ?int
    {
        if (preg_match('/"userId":(\d+)/', $message, $m)) {
            return (int) $m[1];
        }
        return null;
    }

    private function truncate(string $str, int $len): string
    {
        return mb_strlen($str) > $len ? mb_substr($str, 0, $len) . '…' : $str;
    }
}
