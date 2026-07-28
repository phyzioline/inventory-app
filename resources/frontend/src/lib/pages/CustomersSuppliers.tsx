import CustomersPage from './Customers';
import SuppliersPage from './Suppliers';
import { useLanguage } from '@/contexts/LanguageContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { cn } from '@/lib/utils';

export default function CustomersSuppliersPage() {
  const { dir } = useLanguage();
  const isMobile = useIsMobile();

  const customersPanel = (
    <div
      className={cn(
        'h-full min-h-0 overflow-auto',
        !isMobile && 'p-3',
        !isMobile && (dir === 'rtl' ? 'border-s border-border' : 'border-e border-border'),
        isMobile && 'p-4 pb-6',
      )}
    >
      <CustomersPage embedded />
    </div>
  );

  const suppliersPanel = (
    <div className={cn('h-full min-h-0 overflow-auto', isMobile ? 'p-4' : 'p-3')}>
      <SuppliersPage embedded />
    </div>
  );

  if (isMobile) {
    return (
      <div className="-m-6 flex min-h-0 flex-col gap-0">
        {customersPanel}
        <div className="border-t border-border" />
        {suppliersPanel}
      </div>
    );
  }

  return (
    <div className="-m-6 flex h-[calc(100%+3rem)] min-h-0 flex-col">
      <ResizablePanelGroup direction="horizontal" dir={dir} className="min-h-0 flex-1">
        <ResizablePanel defaultSize={50} minSize={28} className="min-h-0">
          {customersPanel}
        </ResizablePanel>

        <ResizableHandle withHandle className="bg-border/80" />

        <ResizablePanel defaultSize={50} minSize={28} className="min-h-0">
          {suppliersPanel}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
