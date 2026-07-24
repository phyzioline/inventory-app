<?php

declare(strict_types=1);

namespace App\Application\Services;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;

/**
 * Builds Tauri v2 auto-updater JSON from a named config file (inventory_downloads).
 *
 * Standalone port of the monolith's shared
 * Modules\Administration\app\Application\Services\TauriDesktopUpdateService —
 * logic unchanged, only the namespace moved local to this app.
 */
final class TauriDesktopUpdateService
{
    public function __construct(
        private readonly string $configKey,
        private readonly string $productLabel,
    ) {}

    public function check(string $target, string $current): JsonResponse|Response
    {
        $latest = (string) config("{$this->configKey}.version", '1.0.0');
        if (version_compare($latest, $current, '<=')) {
            return response()->noContent();
        }

        $platforms = $this->buildPlatforms($target);
        if ($platforms === []) {
            return response()->noContent();
        }

        return response()->json([
            'version' => 'v'.$latest,
            'notes' => "{$this->productLabel} v{$latest} — new features and improvements.",
            'pub_date' => now()->toIso8601String(),
            'platforms' => $platforms,
        ])->withHeaders([
            'Cache-Control' => 'public, max-age=300',
        ]);
    }

    public function latest(): JsonResponse
    {
        return response()->json([
            'version' => config("{$this->configKey}.version", '1.0.0'),
            'windows_url' => config("{$this->configKey}.windows"),
            'macos_url' => config("{$this->configKey}.macos"),
        ])->withHeaders([
            'Cache-Control' => 'public, max-age=300',
        ]);
    }

    /** @return array<string, array{url: string, signature: string}> */
    private function buildPlatforms(string $target): array
    {
        $platforms = [];
        $windowsUrl = config("{$this->configKey}.windows");
        $macosUrl = config("{$this->configKey}.macos");
        $winSig = (string) config("{$this->configKey}.sig_windows", '');
        $macSig = (string) config("{$this->configKey}.sig_macos", '');

        $isWindows = str_contains($target, 'windows');
        $isMac = str_contains($target, 'darwin') || str_contains($target, 'macos');

        if ($isWindows && $windowsUrl && $windowsUrl !== '#coming-soon') {
            $platforms['windows-x86_64'] = ['url' => $windowsUrl, 'signature' => $winSig];
        }

        if ($isMac && $macosUrl && $macosUrl !== '#coming-soon') {
            $platforms['darwin-x86_64'] = ['url' => $macosUrl, 'signature' => $macSig];
            $platforms['darwin-aarch64'] = ['url' => $macosUrl, 'signature' => $macSig];
        }

        return $platforms;
    }
}
