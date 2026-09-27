import type { PgBossWarning } from '@worker-manager/api/typings/app';
import { ChevronDownIcon, DatabaseZapIcon, SearchXIcon, TriangleAlertIcon } from 'lucide-react';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useHistory, useLocation } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { CollapsibleJSON } from '../../../components/CollapsibleJSON/CollapsibleJSON';
import { HintTooltip } from '../../../components/HintTooltip/HintTooltip';
import { Loader } from '../../../components/Loader/Loader';
import { LoadError } from '../../../components/LoadError/LoadError';
import { statusTone } from '../../../components/StatusTone/statusTone';
import { useUIConfig } from '../../../hooks/useUIConfig';
import { formatDate, formatRelativeToNow } from '../../../utils/formatDate';
import { CursorPagination } from '../components/CursorPagination';
import { usePgBossInfo } from '../hooks/usePgBossInfo';
import { usePgBossWarnings } from '../hooks/usePgBossWarnings';
import { pgBossLinks } from '../utils/links';
import { PGBOSS_WARNING_TYPES, warningTone, warningTypeLabel } from '../utils/warnings';

const HEAD_CLASS = 'h-9 text-[0.68rem] font-semibold tracking-wide text-muted-foreground uppercase';
const ALL_TYPES = '__all__';
const PAGE_SIZE = 25;

export const WarningTypeBadge = ({ type }: { type: string }) => {
  const { t } = useTranslation();
  const tone = statusTone(warningTone(type));
  return (
    <Badge
      variant="secondary"
      className={cn(
        'h-5 rounded-md px-1.5 font-mono text-[0.6875rem] font-normal',
        tone.soft,
        tone.text
      )}
    >
      {warningTypeLabel(type, t)}
    </Badge>
  );
};

/** The empty, disabled and error states the page and the overview card share. */
export const WarningsEmpty = ({
  kind,
  className,
}: {
  kind: 'disabled' | 'none' | 'filtered';
  className?: string;
}) => {
  const { t } = useTranslation();
  const { info } = usePgBossInfo();
  const Icon =
    kind === 'disabled' ? DatabaseZapIcon : kind === 'filtered' ? SearchXIcon : TriangleAlertIcon;
  return (
    <Empty className={cn('border bg-card/50 py-10', className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle className="text-sm font-normal text-muted-foreground">
          {kind === 'disabled'
            ? t('PGBOSS.WARNINGS.DISABLED')
            : kind === 'filtered'
              ? t('PGBOSS.WARNINGS.EMPTY_FILTERED')
              : t('PGBOSS.WARNINGS.EMPTY')}
        </EmptyTitle>
        {kind === 'none' && !info?.persistWarnings && (
          <EmptyDescription className="text-xs">{t('PGBOSS.WARNINGS.EMPTY_HINT')}</EmptyDescription>
        )}
      </EmptyHeader>
    </Empty>
  );
};

const WarningTime = ({ iso }: { iso: string }) => {
  const { i18n } = useTranslation();
  const dateFormats = useUIConfig()?.dateFormats;
  const ts = Date.parse(iso);
  return (
    <HintTooltip title={formatDate(ts, i18n.language, dateFormats)}>
      <time
        tabIndex={0}
        dateTime={iso}
        className="text-xs whitespace-nowrap text-muted-foreground tabular-nums outline-none"
      >
        {formatRelativeToNow(ts, i18n.language)}
      </time>
    </HintTooltip>
  );
};

const QueueLink = ({ name }: { name: string | null }) =>
  name ? (
    <Link
      to={pgBossLinks.queuePage(name)}
      className="font-mono text-xs underline-offset-4 hover:underline"
    >
      {name}
    </Link>
  ) : (
    <span className="text-muted-foreground">-</span>
  );

const hasDetails = (warning: PgBossWarning) =>
  warning.data !== null && typeof warning.data === 'object' && Object.keys(warning.data).length > 0;

/**
 * pg-boss's own health reports, read from its `warning` table: slow queries, backlogs, a pinned
 * transaction horizon. Read only; pg-boss keeps them for `warningRetentionDays` and prunes them
 * itself. A warning that names a queue this viewer cannot see is never listed.
 */
export const PgBossWarningsPage = () => {
  const { t } = useTranslation();
  const history = useHistory();
  const { pathname, search } = useLocation();
  const params = new URLSearchParams(search);
  const type = params.get('type') || undefined;
  const cursor = params.get('cursor') || undefined;
  const { info } = usePgBossInfo();
  const available = !!info?.features.warnings;
  const { page, loading, error, isTransitioning, refetch } = usePgBossWarnings(
    { type, cursor, limit: PAGE_SIZE },
    available
  );
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());

  const navigate = (next: { type?: string; cursor?: string }) => {
    const query = new URLSearchParams();
    if (next.type) query.set('type', next.type);
    if (next.cursor) query.set('cursor', next.cursor);
    history.push({ pathname, search: query.toString() });
  };

  const warnings = page?.warnings ?? [];
  // The known types, plus any newer one this page happens to show.
  const types = [
    ...new Set<string>([
      ...PGBOSS_WARNING_TYPES,
      ...warnings.map((w) => w.type),
      ...(type ? [type] : []),
    ]),
  ];

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderBody = () => {
    if (info && !available) return <WarningsEmpty kind="disabled" />;
    if (error && !page) return <LoadError error={error} onRetry={refetch} />;
    if (loading || !page) return <Loader />;
    if (warnings.length === 0) return <WarningsEmpty kind={type ? 'filtered' : 'none'} />;
    return (
      <div
        aria-busy={isTransitioning || undefined}
        className={cn('transition-opacity', isTransitioning && 'opacity-60')}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={cn(HEAD_CLASS, 'w-36')}>{t('PGBOSS.WARNINGS.TIME')}</TableHead>
              <TableHead className={cn(HEAD_CLASS, 'w-44')}>
                {t('PGBOSS.WARNINGS.TYPE_COLUMN')}
              </TableHead>
              <TableHead className={cn(HEAD_CLASS, 'w-40')}>{t('PGBOSS.WARNINGS.QUEUE')}</TableHead>
              <TableHead className={HEAD_CLASS}>{t('PGBOSS.WARNINGS.MESSAGE')}</TableHead>
              <TableHead className={cn(HEAD_CLASS, 'w-10')}>
                <span className="sr-only">{t('PGBOSS.WARNINGS.DETAILS')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {warnings.map((warning) => {
              const expanded = open.has(warning.id);
              return (
                <Fragment key={warning.id}>
                  <TableRow data-warning-type={warning.type}>
                    <TableCell className="align-top">
                      <WarningTime iso={warning.createdOn} />
                    </TableCell>
                    <TableCell className="align-top">
                      <WarningTypeBadge type={warning.type} />
                    </TableCell>
                    <TableCell className="align-top">
                      <QueueLink name={warning.queueName} />
                    </TableCell>
                    <TableCell className="align-top text-xs whitespace-normal [overflow-wrap:anywhere]">
                      {warning.message}
                    </TableCell>
                    <TableCell className="align-top">
                      {hasDetails(warning) && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-expanded={expanded}
                          aria-label={t('PGBOSS.WARNINGS.DETAILS')}
                          title={t('PGBOSS.WARNINGS.DETAILS')}
                          onClick={() => toggle(warning.id)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <ChevronDownIcon
                            className={cn('transition-transform', expanded && 'rotate-180')}
                          />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                  {expanded && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell
                        colSpan={5}
                        className="bg-muted/30 font-mono text-xs whitespace-normal"
                      >
                        <CollapsibleJSON data={warning.data} defaultCollapseDepth={2} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    );
  };

  return (
    <section className="flex flex-col gap-4">
      <Card className="gap-4 py-0 shadow-xs animate-fade-in-up">
        <CardHeader className="flex flex-wrap items-center justify-between gap-3 border-b py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-status-delayed/10 text-status-delayed ring-1 ring-status-delayed/15">
              <TriangleAlertIcon className="size-4.5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <CardTitle>
                <h1 className="m-0 text-lg leading-tight font-semibold tracking-tight">
                  {t('PGBOSS.WARNINGS.TITLE')}
                </h1>
              </CardTitle>
              <p className="m-0 text-xs text-muted-foreground">
                {t('PGBOSS.WARNINGS.DESCRIPTION')}
              </p>
            </div>
          </div>
          {available && (
            <CardAction className="flex flex-wrap items-center gap-2">
              <Select
                value={type ?? ALL_TYPES}
                onValueChange={(value) =>
                  navigate({ type: value === ALL_TYPES ? undefined : value })
                }
              >
                <SelectTrigger
                  size="sm"
                  aria-label={t('PGBOSS.WARNINGS.TYPE_FILTER')}
                  className="w-48"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_TYPES}>{t('PGBOSS.WARNINGS.ALL_TYPES')}</SelectItem>
                  {types.map((candidate) => (
                    <SelectItem key={candidate} value={candidate}>
                      {warningTypeLabel(candidate, t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <CursorPagination
                label={t('PGBOSS.WARNINGS.PAGES')}
                isFirstPage={!cursor}
                prevCursor={page?.prevCursor ?? null}
                nextCursor={page?.nextCursor ?? null}
                onNavigate={(next) => navigate({ type, cursor: next })}
              />
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="px-2 pb-3">{renderBody()}</CardContent>
      </Card>
    </section>
  );
};
