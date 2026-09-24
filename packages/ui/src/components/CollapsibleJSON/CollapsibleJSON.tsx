import React, { useCallback, useMemo } from 'react';
import { JsonView, collapseAllNested } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';
import { cn } from '@/lib/utils';
import { CopyButton } from '../CopyButton/CopyButton';

interface CollapsibleJSONProps {
  data: any;
  defaultCollapseDepth?: number;
}

const value = '[overflow-wrap:anywhere]';
const toggle =
  'absolute -left-[1em] -top-px cursor-pointer text-[1.1em] text-muted-foreground transition-colors select-none hover:text-foreground';

// react-json-view-lite takes a class per token; these map them onto the highlight tokens.
const customStyles = {
  container: 'relative ml-2 leading-5',
  basicChildStyle: 'relative m-0 ml-4 p-0',
  collapseIcon: cn(toggle, "after:content-['▾']"),
  expandIcon: cn(toggle, "after:content-['▸']"),
  collapsedContent: "mr-1 text-muted-foreground italic after:text-[0.8em] after:content-['...']",
  label: 'mr-1 text-(--hl-type)',
  clickableLabel: 'mr-1 cursor-pointer text-(--hl-type)',
  punctuation: 'text-muted-foreground',
  stringValue: cn('text-(--hl-string)', value),
  numberValue: cn('text-(--hl-number)', value),
  booleanValue: cn('text-(--hl-keyword)', value),
  nullValue: cn('text-(--hl-meta)', value),
  undefinedValue: cn('text-(--hl-meta)', value),
  otherValue: cn('text-foreground', value),
  noQuotesForStringValues: false,
};

export const CollapsibleJSON: React.FC<CollapsibleJSONProps> = ({
  data,
  defaultCollapseDepth = 3,
}) => {
  const textToCopy = useMemo(() => JSON.stringify(data, null, 2), [data]);

  const shouldExpandNode = useCallback(
    (level: number) => {
      if (defaultCollapseDepth === 0) {
        return collapseAllNested(level);
      }
      return level < defaultCollapseDepth;
    },
    [defaultCollapseDepth]
  );

  return (
    <div className="group/json relative rounded-lg border bg-muted/40 p-3 font-mono text-[0.8125rem] leading-relaxed">
      <div className="inline-block min-w-full overflow-x-auto pr-8">
        <JsonView data={data} shouldExpandNode={shouldExpandNode} style={customStyles} />
      </div>
      <CopyButton
        textToCopy={textToCopy}
        className="absolute top-2 right-2 bg-card opacity-0 shadow-xs ring-1 ring-border transition-opacity group-focus-within/json:opacity-100 group-hover/json:opacity-100 max-md:opacity-70"
      />
    </div>
  );
};
