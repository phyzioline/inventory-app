<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use App\Infrastructure\Traits\IsIsolatedByUser;

class Supplier extends Model
{
    use IsIsolatedByUser;

    protected $fillable = [
        'name', 'email', 'phone', 'address', 'balance',
    ];

    protected $casts = [
        'balance' => 'decimal:2',
    ];

    public static function normalizePhoneDigits(?string $phone): string
    {
        return preg_replace('/\D+/', '', (string) $phone) ?? '';
    }

    public static function findMatchingVendorFor(self $supplier): ?\App\Domain\Models\Wms\Vendor
    {
        $name = trim((string) $supplier->name);
        $digits = static::normalizePhoneDigits($supplier->phone ?? null);
        $email = trim((string) ($supplier->email ?? ''));

        if ($name !== '') {
            $byName = \App\Domain\Models\Wms\Vendor::query()->where('name', $name)->first();
            if ($byName) {
                return $byName;
            }
        }

        if ($digits !== '') {
            $raw = trim((string) ($supplier->phone ?? ''));
            if ($raw !== '') {
                $byExactPhone = \App\Domain\Models\Wms\Vendor::query()->where('phone', $raw)->first();
                if ($byExactPhone) {
                    return $byExactPhone;
                }
            }
            $byDigits = \App\Domain\Models\Wms\Vendor::query()
                ->whereNotNull('phone')
                ->where('phone', '!=', '')
                ->get()
                ->first(static function (\App\Domain\Models\Wms\Vendor $v) use ($digits) {
                    return static::normalizePhoneDigits($v->phone) === $digits;
                });
            if ($byDigits) {
                return $byDigits;
            }
        }

        if ($email !== '') {
            return \App\Domain\Models\Wms\Vendor::query()->where('email', $email)->first();
        }

        return null;
    }

    public function resolveLinkedVendor(): ?\App\Domain\Models\Wms\Vendor
    {
        return static::findMatchingVendorFor($this)
            ?? \App\Domain\Models\Wms\Vendor::query()->where('id', $this->id)->first();
    }

    public function purchaseReturns(): HasMany
    {
        return $this->hasMany(\App\Domain\Models\Wms\PurchaseReturn::class);
    }
}
