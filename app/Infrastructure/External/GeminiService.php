<?php

namespace App\Infrastructure\External;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Standalone Gemini client. API key is sent via x-goog-api-key header
 * (never as a URL query parameter — avoids leaking into access logs).
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

        $url = "https://generativelanguage.googleapis.com/v1beta/models/{$model}:streamGenerateContent?alt=sse";

        $payload = [
            'contents' => [[
                'parts' => [['text' => $prompt]],
            ]],
        ];
        if ($system !== null && $system !== '') {
            $payload['systemInstruction'] = ['parts' => [['text' => $system]]];
        }

        $response = Http::timeout((int) config('services.gemini.timeout', 20))
            ->withHeaders(['x-goog-api-key' => $apiKey])
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
        $url = "https://generativelanguage.googleapis.com/v1beta/models/{$model}:generateContent";

        $payload = [
            'contents' => [[
                'parts' => [['text' => $prompt]],
            ]],
        ];
        if ($system !== null && $system !== '') {
            $payload['systemInstruction'] = ['parts' => [['text' => $system]]];
        }

        try {
            $response = Http::timeout((int) config('services.gemini.timeout', 20))
                ->withHeaders(['x-goog-api-key' => $apiKey])
                ->post($url, $payload);

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
