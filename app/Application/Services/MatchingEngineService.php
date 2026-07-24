<?php

namespace App\Application\Services;

use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\ProductAlias;

/**
 * Matching Engine Service
 *
 * Powers product deduplication by matching incoming products against existing database.
 * Uses multiple strategies: exact match, fuzzy string matching, and alias lookup.
 */
class MatchingEngineService
{
    protected ?\Illuminate\Support\Collection $productsCache = null;

    protected array $normalizedCache = [];

    /**
     * Find matching product for import data.
     *
     * @param  array  $importData  Product data from import (name, barcode, sku, etc.)
     * @return array ['product_id' => int|null, 'confidence' => string]
     */
    public function findMatch(array $importData): array
    {
        // Strategy 1: Exact match on barcode (highest confidence)
        if (! empty($importData['barcode'])) {
            $match = $this->matchByBarcode($importData['barcode']);
            if ($match) {
                return ['product_id' => $match->id, 'confidence' => 'exact'];
            }
        }

        // Strategy 2: Exact match on SKU alias
        if (! empty($importData['sku'])) {
            $match = $this->matchBySku($importData['sku']);
            if ($match) {
                return ['product_id' => $match->id, 'confidence' => 'exact'];
            }
        }

        // Strategy 3: Fuzzy match on product name
        if (! empty($importData['name'])) {
            $match = $this->fuzzyMatchByName($importData['name']);
            if ($match) {
                return [
                    'product_id' => $match['product_id'],
                    'confidence' => $match['confidence'],
                ];
            }
        }

        // No match found
        return ['product_id' => null, 'confidence' => 'none'];
    }

    /**
     * Pre-load products to speed up batch matching.
     */
    public function setProductsCache(\Illuminate\Support\Collection $products): void
    {
        $this->productsCache = $products;
        $this->normalizedCache = [];
        foreach ($products as $product) {
            $this->normalizedCache[$product->id] = $this->normalizeString($product->internal_name);
        }
    }

    /**
     * Match by barcode using product aliases.
     */
    protected function matchByBarcode(string $barcode): ?MasterProduct
    {
        $alias = ProductAlias::where('alias_type', 'barcode')
            ->where('alias_text', $barcode)
            ->first();

        return $alias ? $alias->masterProduct : null;
    }

    /**
     * Match by SKU using product aliases.
     */
    protected function matchBySku(string $sku): ?MasterProduct
    {
        $alias = ProductAlias::whereIn('alias_type', ['old_sku', 'sku_alias'])
            ->where('alias_text', $sku)
            ->first();

        return $alias ? $alias->masterProduct : null;
    }

    /**
     * Fuzzy match by product name.
     * Uses Levenshtein distance for string similarity.
     */
    protected function fuzzyMatchByName(string $name): ?array
    {
        $normalizedName = $this->normalizeString($name);
        $threshold = 0.8; // 80% similarity required for "high" confidence
        $lowThreshold = 0.6; // 60% for "low" confidence

        // Optimized: Use cache if available, otherwise hit DB once
        if ($this->productsCache === null) {
            $this->setProductsCache(MasterProduct::all());
        }

        $bestMatchId = null;
        $bestSimilarity = 0;

        foreach ($this->normalizedCache as $id => $productNormalizedName) {
            // Quick skip: If length difference is massive, similarity will be very low
            $lenDiff = abs(strlen($normalizedName) - strlen($productNormalizedName));
            $maxLen = max(strlen($normalizedName), strlen($productNormalizedName));

            // If the BEST case similarity (difference in length) is already worse than our lowThreshold, skip
            if ($maxLen > 0 && (1 - ($lenDiff / $maxLen)) < $lowThreshold) {
                continue;
            }

            $similarity = $this->calculateSimilarity($normalizedName, $productNormalizedName);

            if ($similarity > $bestSimilarity) {
                $bestSimilarity = $similarity;
                $bestMatchId = $id;
            }

            // Short-circuit: If we found a perfect match, stop looking
            if ($bestSimilarity >= 0.99) {
                break;
            }
        }

        // Determine confidence level
        if ($bestMatchId && $bestSimilarity >= $threshold) {
            return [
                'product_id' => $bestMatchId,
                'confidence' => 'high',
            ];
        } elseif ($bestMatchId && $bestSimilarity >= $lowThreshold) {
            return [
                'product_id' => $bestMatchId,
                'confidence' => 'low',
            ];
        }

        return null;
    }

    /**
     * Calculate string similarity (0-1 scale).
     * Uses Levenshtein distance normalized by string length.
     */
    protected function calculateSimilarity(string $str1, string $str2): float
    {
        $maxLen = max(strlen($str1), strlen($str2));
        if ($maxLen === 0) {
            return 1.0;
        }

        // PHP levenshtein has a 255 char limit
        if (strlen($str1) > 255 || strlen($str2) > 255) {
            return str_contains($str1, $str2) || str_contains($str2, $str1) ? 0.7 : 0;
        }

        $distance = levenshtein($str1, $str2);

        return 1 - ($distance / $maxLen);
    }

    /**
     * Normalize string for comparison.
     * Lowercase, remove special chars, trim whitespace.
     */
    protected function normalizeString(string $str): string
    {
        $str = strtolower($str);
        $str = preg_replace('/[^a-z0-9\s]/', '', $str); // Remove special chars
        $str = preg_replace('/\s+/', ' ', $str); // Collapse whitespace

        return trim($str);
    }

    /**
     * Add alias to existing product.
     * Used when user confirms a match or creates manual link.
     */
    public function addAlias(int $productId, string $aliasText, string $aliasType): void
    {
        ProductAlias::firstOrCreate([
            'master_product_id' => $productId,
            'alias_text' => $aliasText,
            'alias_type' => $aliasType,
        ]);
    }

    /**
     * Batch match multiple import rows.
     * Returns array of results with match info.
     */
    public function batchMatch(array $importRows): array
    {
        $results = [];

        foreach ($importRows as $index => $row) {
            $match = $this->findMatch($row);
            $results[] = [
                'row_index' => $index,
                'import_data' => $row,
                'matched_product_id' => $match['product_id'],
                'match_confidence' => $match['confidence'],
            ];
        }

        return $results;
    }
}
