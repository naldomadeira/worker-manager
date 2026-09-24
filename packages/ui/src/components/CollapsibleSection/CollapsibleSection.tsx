import { ChevronDown } from 'lucide-react';
import { PropsWithChildren } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

interface CollapsibleSectionProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  className?: string;
}

/** Bordered disclosure section whose body slides open with a height animation. */
export const CollapsibleSection = ({
  title,
  open,
  onToggle,
  className,
  children,
}: PropsWithChildren<CollapsibleSectionProps>) => (
  <Collapsible
    open={open}
    onOpenChange={onToggle}
    className={cn(
      'group/section overflow-hidden rounded-xl border bg-card transition-shadow duration-200 data-[state=open]:shadow-xs [&+&]:mt-3',
      className
    )}
  >
    <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold text-foreground transition-colors outline-none hover:bg-state-hover focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset group-data-[state=open]/section:bg-muted/50">
      <span className="min-w-0">{title}</span>
      <ChevronDown
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out group-data-[state=open]/section:rotate-180"
      />
    </CollapsibleTrigger>
    <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
      <div className="border-t p-4">{children}</div>
    </CollapsibleContent>
  </Collapsible>
);
