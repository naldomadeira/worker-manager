import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { asyncHighlight } from '../../utils/highlight/highlight';
import { CopyButton } from '../CopyButton/CopyButton';

interface HighlightProps {
  language: 'json' | 'stacktrace';
  text: string;
}

export const Highlight: React.FC<HighlightProps> = ({ language, text }) => {
  const [code, setCode] = useState<string>('');

  useEffect(() => {
    let unmount = false;
    asyncHighlight(text as string, language).then((newCode) => {
      if (!unmount) {
        setCode(newCode);
      }
    });

    return () => {
      unmount = true;
    };
  }, [language, text]);

  return (
    <div className="group/highlight relative flex items-start rounded-lg border bg-muted/40 font-mono text-[0.8125rem] leading-relaxed">
      <pre className="m-0 min-w-0 flex-1 overflow-x-auto p-3 pr-11">
        <code
          className={cn('hljs animate-in duration-300 fade-in-0', language)}
          dangerouslySetInnerHTML={{ __html: code }}
        />
      </pre>

      <CopyButton
        textToCopy={text ?? ''}
        className="absolute top-2 right-2 bg-card opacity-0 shadow-xs ring-1 ring-border transition-opacity group-focus-within/highlight:opacity-100 group-hover/highlight:opacity-100 max-md:opacity-70"
      />
    </div>
  );
};
