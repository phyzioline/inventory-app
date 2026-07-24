<?php

namespace App\Application\Support;

use App\Domain\Models\Wms\Channel;

final class ChannelQuery
{
    /**
     * Resolve channel primary keys from a free-text filter (id, slug, or name).
     *
     * @return list<int>
     */
    public static function idsMatchingFilter(string $filter): array
    {
        $filter = trim($filter);
        if ($filter === '') {
            return [];
        }

        return self::matchingFilterQuery($filter)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->filter(fn (int $id) => $id > 0)
            ->unique()
            ->values()
            ->all();
    }

    public static function matchingFilterQuery(string $filter)
    {
        $filter = trim($filter);
        $escaped = '%'.addcslashes($filter, '%_\\').'%';

        return Channel::query()->where(function ($q) use ($filter, $escaped) {
            if (ctype_digit($filter)) {
                $q->where('id', (int) $filter);
            }

            $q->orWhere('slug', $filter)
                ->orWhere('name', $filter)
                ->orWhere('slug', 'like', $escaped)
                ->orWhere('name', 'like', $escaped);
        });
    }
}
