<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use App\Infrastructure\Traits\IsIsolatedByUser;
use Database\Factories\ChannelFactory;

class Channel extends Model
{
    use HasFactory, IsIsolatedByUser;

    protected $fillable = [
        'name', 'type', 'slug', 'is_active', 'credentials', 'merchant_identifier', 'account_label',
        'stock_tracking_starts_at',
    ];

    protected static function newFactory(): ChannelFactory
    {
        return ChannelFactory::new();
    }

    protected $casts = [
        'is_active' => 'boolean',
        'credentials' => 'array',
        'stock_tracking_starts_at' => 'datetime',
    ];

    public function locations()
    {
        return $this->hasMany(\App\Domain\Models\Wms\InventoryLocation::class);
    }
}
