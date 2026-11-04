<?php

declare(strict_types=1);

namespace App\Domain\Models\Wms;

use App\Infrastructure\Traits\IsIsolatedByUser;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SupplierAccountCredit extends Model
{
    use IsIsolatedByUser;

    public const REASON_COMMISSION = 'commission';

    public const REASON_PRICE_DIFFERENCE = 'price_difference';

    public const REASON_OTHER = 'other';

    protected $table = 'supplier_account_credits';

    protected $fillable = [
        'user_id',
        'supplier_id',
        'amount',
        'credit_date',
        'reason',
        'notes',
        'reference',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'credit_date' => 'date',
    ];

    public function supplier(): BelongsTo
    {
        return $this->belongsTo(Supplier::class);
    }
}
