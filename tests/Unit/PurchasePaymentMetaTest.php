<?php

use App\Domain\ValueObjects\PurchasePaymentMeta;

describe('PurchasePaymentMeta', function () {
    it('never treats type=cash as fully paid', function () {
        $meta = PurchasePaymentMeta::fromNotes('[PAYMENT] type=cash; paid=0.00; remaining=7250.00; status=pending');

        expect($meta->paidAgainst(7250))->toBe(0.0)
            ->and($meta->remainingAgainst(7250))->toBe(7250.0);
    });

    it('uses the entered partial amount for cash invoices', function () {
        $meta = PurchasePaymentMeta::fromNotes("Some note\n[PAYMENT] type=cash; paid=41271.00; remaining=1100.00; status=partially_paid");

        expect($meta->paidAgainst(42371))->toBe(41271.0)
            ->and($meta->remainingAgainst(42371))->toBe(1100.0);
    });

    it('treats a missing payment line as nothing paid', function () {
        $meta = PurchasePaymentMeta::fromNotes('plain notes');

        expect($meta->type)->toBeNull()
            ->and($meta->paidAgainst(500))->toBe(0.0)
            ->and($meta->remainingAgainst(500))->toBe(500.0);
    });

    it('clamps to the invoice total', function () {
        $meta = PurchasePaymentMeta::fromNotes('[PAYMENT] type=credit; paid=900.00; status=paid');

        expect($meta->paidAgainst(600))->toBe(600.0)
            ->and($meta->paidAgainst(0))->toBe(0.0);
    });
});
