<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasOne;
use App\Infrastructure\Traits\IsIsolatedByUser;

class PurchaseUpload extends Model
{
    use IsIsolatedByUser;

    protected $fillable = [
        'upload_id', 'user_id', 'original_filename', 'file_path', 'file_type',
        'file_size', 'raw_text', 'ai_structured_data', 'extraction_status', 'error_message',
    ];

    protected $casts = [
        'ai_structured_data' => 'array',
    ];

    public function batch(): HasOne
    {
        return $this->hasOne(\App\Domain\Models\Wms\PurchaseBatch::class);
    }

    public function scopePending($query)
    {
        return $query->where('extraction_status', 'pending');
    }

    public function scopeFailed($query)
    {
        return $query->where('extraction_status', 'failed');
    }
}
