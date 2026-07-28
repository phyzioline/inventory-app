import { useNavigate, useParams } from 'react-router-dom';
import { QuotationEditor } from '@/components/quotations/QuotationDialog';

export default function QuotationEditorPage() {
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();

    return (
        <QuotationEditor
            mode="page"
            quotationId={id ?? null}
            onClose={() => navigate('/quotations')}
        />
    );
}
