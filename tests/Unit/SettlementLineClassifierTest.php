<?php

use App\Application\Services\SettlementLineClassifier;

describe('SettlementLineClassifier', function () {
    beforeEach(function () {
        $this->c = new SettlementLineClassifier;
    });

    it('classifies Amazon XML-style price and fee lines without using amount sign', function () {
        expect($this->c->classify([
            'transaction_type' => 'Order',
            'description' => 'ItemPrice: Principal',
            'amount' => 100,
        ]))->toBe(SettlementLineClassifier::ORDER_PRINCIPAL);

        expect($this->c->classify([
            'transaction_type' => 'Order',
            'description' => 'ItemFee: Commission',
            'amount' => -15,
        ]))->toBe(SettlementLineClassifier::PLATFORM_FEE);

        expect($this->c->classify([
            'transaction_type' => 'Order',
            'description' => 'ItemFee: ShippingHB',
            'amount' => -8,
        ]))->toBe(SettlementLineClassifier::SHIPPING_FEE);
    });

    it('does not treat negative amount alone as refund', function () {
        expect($this->c->classify([
            'transaction_type' => 'OtherTransaction',
            'description' => 'Storage fee',
            'amount' => -20,
        ]))->toBe(SettlementLineClassifier::PLATFORM_FEE);
    });

    it('classifies later-sheet product refunds and advertising', function () {
        expect($this->c->classify([
            'transaction_type' => 'Refund',
            'description' => 'RefundPrice: Principal',
            'amount' => -100,
        ]))->toBe(SettlementLineClassifier::REFUND_PRINCIPAL);

        expect($this->c->classify([
            'transaction_type' => 'Advertising',
            'description' => 'Advertising: Cost of Advertising',
            'amount' => -50,
            'raw_data' => ['source' => 'advertising'],
        ]))->toBe(SettlementLineClassifier::ADVERTISING);
    });

    it('maps kinds to summary buckets', function () {
        expect($this->c->summaryBucket(SettlementLineClassifier::ORDER_PRINCIPAL))->toBe('revenue');
        expect($this->c->summaryBucket(SettlementLineClassifier::PLATFORM_FEE))->toBe('platform_fee');
        expect($this->c->summaryBucket(SettlementLineClassifier::REFUND_PRINCIPAL))->toBe('refund');
        expect($this->c->summaryBucket(SettlementLineClassifier::WITHHOLDING))->toBe('pending');
    });
});
