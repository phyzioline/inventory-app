<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Proxies external images to bypass CORS / hotlink blocking.
 * Use when img src fails (e.g. Amazon, other CDNs blocking referrer).
 */
class ImageProxyController extends Controller
{
    /** Allowed host patterns for security */
    private const ALLOWED_HOSTS = [
        'amazon.eg',
        'www.amazon.eg',
        'm.media-amazon.com',
        'images-na.ssl-images-amazon.com',
        'images.amazon.com',
        'images-eu.ssl-images-amazon.com',
        'noon.com',
        'm.noon.com',
        'dn2bgg0s0n6tc.cloudfront.net',
        'i.imgur.com',
    ];

    public function __invoke(Request $request)
    {
        $url = $request->query('url');
        if (empty($url) || ! filter_var($url, FILTER_VALIDATE_URL)) {
            return response('Invalid URL', 400);
        }

        $host = parse_url($url, PHP_URL_HOST);
        $allowed = false;
        foreach (self::ALLOWED_HOSTS as $pattern) {
            if ($host === $pattern || str_ends_with($host, '.'.$pattern)) {
                $allowed = true;
                break;
            }
        }
        if (! $allowed) {
            return response('URL not allowed', 403);
        }

        try {
            $headers = [
                'User-Agent' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept' => 'image/*,text/html;q=0.9,*/*;q=0.8',
            ];

            $response = Http::timeout(8)
                ->withHeaders($headers)
                ->get($url);

            if (! $response->successful()) {
                return response('Image fetch failed', 404);
            }

            $contentType = $response->header('Content-Type') ?: '';

            // If the URL points to a product page (HTML), try extracting og:image and fetch it.
            if (str_contains($contentType, 'text/html')) {
                $html = $response->body();
                $imageUrl = $this->extractImageFromHtml($html);

                if (! $imageUrl) {
                    return response('URL is not an image', 400);
                }

                $imageHost = parse_url($imageUrl, PHP_URL_HOST);
                if (! $this->isAllowedHost($imageHost)) {
                    return response('Extracted image URL not allowed', 403);
                }

                $imageResponse = Http::timeout(8)
                    ->withHeaders($headers)
                    ->get($imageUrl);

                if (! $imageResponse->successful()) {
                    return response('Image fetch failed', 404);
                }

                $imageContentType = $imageResponse->header('Content-Type') ?: 'image/jpeg';
                if (! str_contains($imageContentType, 'image')) {
                    return response('Extracted URL is not an image', 400);
                }

                return response($imageResponse->body(), 200, [
                    'Content-Type' => $imageContentType,
                    'Cache-Control' => 'public, max-age=86400',
                ]);
            }

            if (empty($contentType) || ! str_contains($contentType, 'image')) {
                $contentType = 'image/jpeg';
            }

            return response($response->body(), 200, [
                'Content-Type' => $contentType,
                'Cache-Control' => 'public, max-age=86400',
            ]);
        } catch (\Exception $e) {
            Log::warning('ImageProxy failed: '.$e->getMessage());

            return response('Proxy error', 502);
        }
    }

    private function isAllowedHost(?string $host): bool
    {
        if (! $host) {
            return false;
        }
        foreach (self::ALLOWED_HOSTS as $pattern) {
            if ($host === $pattern || str_ends_with($host, '.'.$pattern)) {
                return true;
            }
        }

        return false;
    }

    private function extractImageFromHtml(string $html): ?string
    {
        $patterns = [
            '/<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']/i',
            '/<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)["\']/i',
        ];

        foreach ($patterns as $pattern) {
            if (preg_match($pattern, $html, $matches)) {
                return html_entity_decode($matches[1], ENT_QUOTES | ENT_HTML5);
            }
        }

        return null;
    }
}
