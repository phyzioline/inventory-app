<?php

use App\Application\Services\PurchaseReceiveLedgerBaseline;

describe('PurchaseReceiveLedgerBaseline', function () {
    beforeEach(function () {
        $this->tmp = sys_get_temp_dir().'/prl-baseline-'.uniqid('', true).'.json';
        $this->baseline = new PurchaseReceiveLedgerBaseline($this->tmp);
    });

    afterEach(function () {
        if (is_file($this->tmp)) {
            @unlink($this->tmp);
        }
    });

    it('freezes only baselinable shortfalls and ignores orphans', function () {
        $path = $this->baseline->freeze([
            [
                'batch_id' => 10,
                'sku_id' => 100,
                'sku_code' => 'A',
                'category' => 'shortfall_zero_posted',
                'expected' => 5,
                'posted' => 0,
                'delta' => 5,
            ],
            [
                'batch_id' => 11,
                'sku_id' => 200,
                'sku_code' => 'B',
                'category' => 'orphan_excess',
                'expected' => 0,
                'posted' => 3,
                'delta' => -3,
            ],
        ]);

        expect(is_file($path))->toBeTrue();
        $loaded = $this->baseline->load();
        expect($loaded['entry_count'])->toBe(1);
        expect($loaded['entries'])->toHaveKey('10:100:shortfall_zero_posted');
        expect($loaded['entries'])->not->toHaveKey('11:200:orphan_excess');
    });

    it('reports new and worse shortfalls as regressions while unchanged stay capped', function () {
        $this->baseline->freeze([
            [
                'batch_id' => 1,
                'sku_id' => 10,
                'sku_code' => 'OLD',
                'category' => 'shortfall_zero_posted',
                'expected' => 4,
                'posted' => 0,
                'delta' => 4,
            ],
            [
                'batch_id' => 2,
                'sku_id' => 20,
                'sku_code' => 'KEEP',
                'category' => 'shortfall_partial',
                'expected' => 10,
                'posted' => 5,
                'delta' => 5,
            ],
        ]);

        $compare = $this->baseline->compare([
            [
                'batch_id' => 1,
                'sku_id' => 10,
                'sku_code' => 'OLD',
                'category' => 'shortfall_zero_posted',
                'expected' => 4,
                'posted' => 0,
                'delta' => 4,
            ],
            [
                'batch_id' => 2,
                'sku_id' => 20,
                'sku_code' => 'KEEP',
                'category' => 'shortfall_partial',
                'expected' => 15,
                'posted' => 5,
                'delta' => 10,
            ],
            [
                'batch_id' => 3,
                'sku_id' => 30,
                'sku_code' => 'NEW',
                'category' => 'shortfall_zero_posted',
                'expected' => 2,
                'posted' => 0,
                'delta' => 2,
            ],
            [
                'batch_id' => 9,
                'sku_id' => 99,
                'sku_code' => 'ORPH',
                'category' => 'orphan_excess',
                'expected' => 0,
                'posted' => 1,
                'delta' => -1,
            ],
        ]);

        expect($compare['has_baseline'])->toBeTrue();
        expect($compare['baseline_count'])->toBe(2);
        expect($compare['still_present'])->toBe(2);
        expect($compare['resolved'])->toBe(0);
        expect($compare['new_shortfalls'])->toHaveCount(1);
        expect($compare['worse_shortfalls'])->toHaveCount(1);
        expect($compare['open_orphans'])->toHaveCount(1);
        expect($compare['regression_count'])->toBe(3);
    });

    it('counts resolved when a baseline shortfall disappears', function () {
        $this->baseline->freeze([
            [
                'batch_id' => 1,
                'sku_id' => 10,
                'sku_code' => 'GONE',
                'category' => 'legacy_morph_candidate',
                'expected' => 3,
                'posted' => 0,
                'delta' => 3,
            ],
        ]);

        $compare = $this->baseline->compare([]);
        expect($compare['resolved'])->toBe(1);
        expect($compare['regression_count'])->toBe(0);
    });
});
