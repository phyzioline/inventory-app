<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;

class Quotation extends Model
{
    protected $fillable = [
        'reference_number', 'user_id', 'customer_id', 'customer_name',
        'quotation_date', 'valid_until',
        'total_amount', 'tax_amount', 'discount_amount', 'status', 'notes',
    ];

    protected $casts = [
        'quotation_date' => 'date',
        'valid_until' => 'date',
        'total_amount' => 'decimal:2',
        'tax_amount' => 'decimal:2',
        'discount_amount' => 'decimal:2',
    ];

    public function customer()
    {
        return $this->belongsTo(\App\Domain\Models\Wms\Customer::class);
    }

    public function user()
    {
        return $this->belongsTo(\App\Models\User::class);
    }

    public function items()
    {
        return $this->hasMany(\App\Domain\Models\Wms\QuotationItem::class);
    }
}
