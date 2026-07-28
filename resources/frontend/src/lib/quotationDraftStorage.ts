export type QuotationDraftItem = {
    id: string;
    product_id: string;
    sku_id: string | number | null;
    name: string;
    sku: string;
    image: string | null;
    quantity: number;
    unit_price: number;
    total: number;
    description?: string;
};

export type QuotationDraft = {
    customerId: string;
    customerName: string;
    customerEmail: string;
    customerPhone: string;
    storeId: string;
    items: QuotationDraftItem[];
    editingQuotationId: string | null;
    savedQuotation: { id: string; status: string; reference_number?: string } | null;
    updatedAt: string;
};

const DRAFT_KEY = 'phyzioline.quotation-editor-draft';

export function loadQuotationDraft(): QuotationDraft | null {
    try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as QuotationDraft;
        if (!parsed || typeof parsed !== 'object') return null;
        return parsed;
    } catch {
        return null;
    }
}

export function saveQuotationDraft(draft: QuotationDraft): void {
    try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, updatedAt: new Date().toISOString() }));
    } catch {
        // ignore quota errors
    }
}

export function clearQuotationDraft(): void {
    try {
        localStorage.removeItem(DRAFT_KEY);
    } catch {
        // ignore
    }
}
