<?php

namespace App\Infrastructure\External;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Standalone, local replacement for the monolith's
 * Modules\AI\app\Application\Services\Legacy\GeminiService.
 *
 * Calls Google's Gemini API directly over HTTP using GEMINI_API_KEY —
 * no dependency on the monolith's AI module / BrainFallbackService.
 * Public method signatures are kept identical to the source class so
 * PurchaseImportService (and any other caller) needed no changes beyond
 * the `use` import path.
 */
class GeminiService
{
    /** @var list<string> */
    protected array $lastErrors = [];

    public function askGemini(string $prompt, ?string $system = null): string
    {
        $apiKey = config('services.gemini.api_key');
        $primary = config('services.gemini.model', 'gemini-2.0-flash');

        if (empty($apiKey)) {
            $this->lastErrors = ['missing_api_key'];

            return '';
        }

        $models = array_values(array_unique(array_filter([
            $primary,
            'gemini-2.0-flash-lite',
            'gemini-1.5-flash',
            'gemini-1.5-flash-8b',
        ])));

        $this->lastErrors = [];

        foreach ($models as $model) {
            $text = $this->requestModel($apiKey, $model, $prompt, $system);
            if ($text !== '') {
                return $text;
            }
        }

        return '';
    }

    public function lastErrorWasQuota(): bool
    {
        return in_array('quota', $this->lastErrors, true)
            || in_array('rate_limit', $this->lastErrors, true);
    }

    public function isConfigured(): bool
    {
        return ! empty(config('services.gemini.api_key'));
    }

    /**
     * @return \Generator<int, string>
     */
    public function streamGemini(string $prompt, ?string $system = null): \Generator
    {
        $apiKey = config('services.gemini.api_key');
        $model = config('services.gemini.model', 'gemini-2.0-flash');

        if (empty($apiKey)) {
            throw new \RuntimeException('Gemini API key not configured');
        }

        $url = "https://generativelanguage.googleapis.com/v1beta/models/{$model}:streamGenerateContent?alt=sse&key={$apiKey}";

        $payload = [
            'contents' => [[
                'parts' => [['text' => $prompt]],
            ]],
        ];
        if ($system !== null && $system !== '') {
            $payload['systemInstruction'] = ['parts' => [['text' => $system]]];
        }

        $response = Http::timeout((int) config('services.gemini.timeout', 20))
            ->withOptions(['stream' => true])
            ->post($url, $payload);

        if (! $response->successful()) {
            throw new \RuntimeException('Gemini stream request failed: HTTP '.$response->status());
        }

        $body = $response->toPsrResponse()->getBody();
        $buffer = '';
        while (! $body->eof()) {
            $buffer .= $body->read(1024);
            while (($newlinePos = strpos($buffer, "\n")) !== false) {
                $line = trim(substr($buffer, 0, $newlinePos));
                $buffer = substr($buffer, $newlinePos + 1);

                if (! str_starts_with($line, 'data:')) {
                    continue;
                }

                $json = trim(substr($line, 5));
                if ($json === '' || $json === '[DONE]') {
                    continue;
                }

                $decoded = json_decode($json, true);
                $text = $decoded['candidates'][0]['content']['parts'][0]['text'] ?? null;
                if (is_string($text) && $text !== '') {
                    yield $text;
                }
            }
        }
    }

    protected function requestModel(string $apiKey, string $model, string $prompt, ?string $system = null): string
    {
        $url = "https://generativelanguage.googleapis.com/v1beta/models/{$model}:generateContent?key={$apiKey}";

        $payload = [
            'contents' => [[
                'parts' => [['text' => $prompt]],
            ]],
        ];
        if ($system !== null && $system !== '') {
            $payload['systemInstruction'] = ['parts' => [['text' => $system]]];
        }

        try {
            $response = Http::timeout((int) config('services.gemini.timeout', 20))->post($url, $payload);

            if ($response->successful()) {
                $text = $response->json('candidates.0.content.parts.0.text');

                return is_string($text) ? trim($text) : '';
            }

            $body = (string) $response->body();
            if ($response->status() === 429 || str_contains($body, 'RESOURCE_EXHAUSTED') || str_contains($body, 'quota')) {
                $this->lastErrors[] = 'quota';
            } elseif ($response->status() === 429) {
                $this->lastErrors[] = 'rate_limit';
            } else {
                $this->lastErrors[] = 'http_'.$response->status();
            }

            Log::warning('Gemini API error', [
                'model' => $model,
                'status' => $response->status(),
                'body' => \Illuminate\Support\Str::limit($body, 500),
            ]);
        } catch (\Throwable $e) {
            $this->lastErrors[] = 'exception';
            Log::error('Gemini exception: '.$e->getMessage(), ['model' => $model]);
        }

        return '';
    }
}
