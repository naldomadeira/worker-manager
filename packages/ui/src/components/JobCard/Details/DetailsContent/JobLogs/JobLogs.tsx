import type { AppJob } from '@worker-manager/api/typings/app';
import { ArrowDownToLine, Maximize2, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';
import { useInterval } from '../../../../../hooks/useInterval';
import { CopyButton } from '../../../../CopyButton/CopyButton';
import { HintTooltip } from '../../../../HintTooltip/HintTooltip';

interface JobLogsProps {
  job: AppJob;
  actions: {
    getJobLogs: () => Promise<string[]>;
  };
}

interface LogType {
  message: string;
  lineNumber: number;
}

const getLogType = (log: LogType) => {
  const msgType = log.message?.match(/((info|warn|error)?):/i)?.[1];
  return msgType?.toLowerCase();
};

const logTypeClass: Record<string, string> = {
  error: 'text-destructive',
  warn: 'text-status-waiting',
};

const onClickFullScreen = (el: HTMLElement | null) => async () => {
  if (!!el && document.fullscreenElement !== el) return await el.requestFullscreen();
  return document.exitFullscreen();
};

/** The filter is a regular expression when it parses as one, a plain substring otherwise. */
function buildMatcher(keyword: string): RegExp | null {
  if (!keyword) {
    return null;
  }
  try {
    return new RegExp(keyword, 'i');
  } catch {
    return new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
}

function highlight(message: string, matcher: RegExp | null) {
  if (!matcher) {
    return message;
  }
  const global = new RegExp(matcher.source, 'gi');
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of message.matchAll(global)) {
    const index = match.index ?? 0;
    if (match[0].length === 0) {
      continue;
    }
    parts.push(message.slice(last, index));
    parts.push(
      <mark key={index} className="rounded-xs bg-status-waiting/30 text-inherit">
        {match[0]}
      </mark>
    );
    last = index + match[0].length;
  }
  parts.push(message.slice(last));
  return parts;
}

function formatLogs(logs: string[]) {
  return logs.map((message, i) => ({ message, lineNumber: i + 1 }));
}

export const JobLogs = ({ actions, job }: JobLogsProps) => {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<LogType[]>([]);
  const [liveLogs, setLiveLogs] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [inputValue, setInputValue] = useState('');
  const logsContainer = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let mounted = true;
    actions.getJobLogs().then((logs) => {
      if (mounted) {
        setLogs(formatLogs(logs));
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  useInterval(
    async () => {
      const logs = await actions.getJobLogs();
      setLogs(formatLogs(logs));
      requestAnimationFrame(() => {
        const scrollableElement = scrollRef.current;
        scrollableElement?.scrollTo?.({
          top: scrollableElement.scrollHeight,
          behavior: 'smooth',
        });
      });
    },
    liveLogs ? 2500 : null
  );

  const onFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setKeyword(value), 250);
  };

  const matcher = useMemo(() => buildMatcher(keyword), [keyword]);
  const logsToShow = matcher ? logs.filter((log) => matcher.test(log.message)) : logs;
  const gutterWidth = `${`${logs.length}`.length + 1}ch`;

  const followToggle = !job.finishedOn && (
    <HintTooltip title={t('JOB.LOGS.FOLLOW')}>
      <Toggle
        size="sm"
        variant="outline"
        pressed={liveLogs}
        onPressedChange={setLiveLogs}
        aria-label={t('JOB.LOGS.FOLLOW')}
        className="gap-1.5 data-[state=on]:border-status-active/40 data-[state=on]:bg-status-active/10 data-[state=on]:text-status-active"
      >
        {liveLogs ? (
          <span aria-hidden className="size-1.5 animate-pulse-ring rounded-full bg-current" />
        ) : (
          <ArrowDownToLine />
        )}
        <span className="hidden sm:inline">{t('JOB.LOGS.FOLLOW_SHORT')}</span>
      </Toggle>
    </HintTooltip>
  );

  return (
    <div
      ref={logsContainer}
      className="flex h-full min-h-0 flex-col bg-muted/40 [&:fullscreen]:bg-background [&:fullscreen]:p-4"
    >
      {logs.length > 0 ? (
        <>
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-muted/80 p-2 backdrop-blur-sm">
            <InputGroup className="h-7 max-w-sm min-w-40 flex-1 bg-background">
              <InputGroupAddon>
                <Search className="size-3.5" />
              </InputGroupAddon>
              <InputGroupInput
                type="text"
                className="h-7 text-xs"
                placeholder={t('JOB.LOGS.FILTER_PLACEHOLDER')}
                aria-label={t('JOB.LOGS.FILTER_PLACEHOLDER')}
                value={inputValue}
                onChange={onFilterChange}
              />
            </InputGroup>
            <span className="text-[0.6875rem] text-muted-foreground tabular-nums">
              {t('JOB.LOGS.LINES', { shown: logsToShow.length, total: logs.length })}
            </span>
            <div className="ml-auto flex items-center gap-1">
              {followToggle}
              <HintTooltip title={t('JOB.LOGS.FULLSCREEN')}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('JOB.LOGS.FULLSCREEN')}
                  onClick={onClickFullScreen(logsContainer.current)}
                >
                  <Maximize2 />
                </Button>
              </HintTooltip>
              <CopyButton textToCopy={logsToShow.map((log) => log.message).join('\n')} />
            </div>
          </div>
          <div
            ref={scrollRef}
            className="max-h-64 min-h-0 flex-1 overflow-auto py-1.5 [:fullscreen_&]:max-h-none [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]"
          >
            <ol className="m-0 list-none p-0 font-mono text-xs leading-relaxed">
              {logsToShow.map((log) => (
                <li
                  key={log.lineNumber}
                  className={cn(
                    'group/line flex items-start gap-3 px-3 py-px transition-colors hover:bg-foreground/5',
                    logTypeClass[getLogType(log) ?? '']
                  )}
                >
                  <span
                    aria-hidden
                    className="shrink-0 text-right text-muted-foreground/60 select-none"
                    style={{ width: gutterWidth }}
                  >
                    {log.lineNumber}
                  </span>
                  <span className="min-w-0 flex-1 break-all whitespace-pre-wrap">
                    {highlight(log.message, matcher)}
                  </span>
                  <span className="shrink-0 opacity-50 transition-opacity group-hover/line:opacity-100 sm:opacity-0 [&_button]:size-5 [&_svg]:size-3">
                    <CopyButton textToCopy={log.message} tabIndex={-1} />
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
          {t('JOB.NO_LOGS')}
          {followToggle}
        </div>
      )}
    </div>
  );
};
