import { describe, expect, it } from 'vitest';
import {
    getTransferStockKind,
    resolveSkuChannelMeta,
    transferChannelBadgeLabel,
    transferStockKindLabel,
} from '@/lib/transferStockKind';

describe('transferStockKind', () => {
    const shopLocation = { id: 16, name: 'المحل', type: 'physical', channel_id: null };
    const noonLocation = { id: 24, name: 'نون', type: 'channel', channel_id: 6 };

    it('labels Amazon merchant SKU as تاجر even when stock sits at المحل', () => {
        const item = {
            id: 1,
            quantity: 5,
            sku: {
                id: 7561,
                sku: 'PHYZ-485',
                channel: { id: 4, name: 'امازون فيزيولاين  التاجر', type: 'amazon_merchant', slug: 'امازون-فيزيولاين-التاجر' },
            },
        };

        expect(getTransferStockKind(item, shopLocation)).toBe('merchant');
        expect(transferStockKindLabel('merchant', true, shopLocation, resolveSkuChannelMeta(item))).toBe('تاجر');
        expect(transferChannelBadgeLabel(resolveSkuChannelMeta(item), true)).toBe('تاجر');
    });

    it('labels shop-channel SKU as المحل', () => {
        const item = {
            sku: {
                id: 10,
                sku: 'SHOP-1',
                channel: { id: 16, name: 'المحل', type: 'pos', slug: 'المحل' },
            },
        };

        expect(getTransferStockKind(item, shopLocation)).toBe('shop');
        expect(transferStockKindLabel('shop', true, shopLocation, resolveSkuChannelMeta(item))).toBe('المحل');
    });

    it('labels Noon channel SKU as نون (not المحل)', () => {
        const item = {
            id: 'channel-sku-99',
            sku: {
                id: 99,
                sku: 'NOON-1',
                channel: { id: 6, name: 'نون', type: 'noon_fbn', slug: 'نون' },
            },
        };

        expect(getTransferStockKind(item, noonLocation)).toBe('merchant');
        expect(transferStockKindLabel('merchant', true, noonLocation, resolveSkuChannelMeta(item))).toBe('نون');
    });

    it('labels FBA channel SKU as FBA', () => {
        const item = {
            sku: {
                channel: { id: 3, name: 'امازون فيزيولان FBA', type: 'amazon_fba', slug: 'امازون-فيزيولان-fba' },
            },
        };

        expect(getTransferStockKind(item, shopLocation)).toBe('fba');
        expect(transferStockKindLabel('fba', true, shopLocation, resolveSkuChannelMeta(item))).toBe('FBA');
    });

    it('falls back to location when SKU has no channel', () => {
        const item = { id: 1, sku: { id: 1, sku: 'X' } };
        expect(getTransferStockKind(item, shopLocation)).toBe('shop');
        expect(getTransferStockKind(item, noonLocation)).toBe('merchant');
        expect(transferStockKindLabel('shop', true, shopLocation, null)).toBe('المحل');
        expect(transferStockKindLabel('merchant', true, noonLocation, null)).toBe('نون');
    });
});
