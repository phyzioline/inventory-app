<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use App\Infrastructure\Traits\IsIsolatedByUser;

class Supplier extends Model
{
    use IsIsolatedByUser, SoftDeletes;

    protected $fillable = [
        'name', 'email', 'phone', 'address', 'balance',
    ];

    /**
     * PostgreSQL `suppliers.balance` is NOT NULL without a DB default
     * (pgloader / dump restore dropped DEFAULT 0). Creating with name only
     * must still persist a zero opening balance.
     */
    protected $attributes = [
        'balance' => 0,
    ];

    protected $casts = [
        'balance' => 'decimal:2',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $supplier): void {
            if ($supplier->balance === null || $supplier->balance === '') {
                $supplier->balance = 0;
            }
        });
    }

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
