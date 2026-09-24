/**
 * Gantt timeline, adapted from Kibo UI (https://www.kibo-ui.com/components/gantt, MIT, Hayden
 * Bleasel). The compound structure is upstream's -- a provider, a sticky sidebar of grouped
 * items, a sticky two-tier header, feature rows, markers and a "today" line -- rebuilt as a
 * read-only view for the board:
 *
 * - No editing. Dragging, resizing, add-item and marker context menus are gone, and with them
 *   every dependency that only served them: @dnd-kit/core, @dnd-kit/modifiers, jotai,
 *   lodash.throttle, @uidotdev/usehooks and the card/context-menu registry items. date-fns, which
 *   the board already ships, is the only one left.
 * - A fixed window instead of upstream's infinitely scrolling years. The caller passes `start`,
 *   `end` and a zoom (`day` = hour columns, `week`/`month` = day columns); positions are a linear
 *   percentage of that window, so columns stretch to the card and shrink to a minimum width
 *   before the timeline scrolls sideways. Hour resolution is what schedules need; upstream's
 *   finest column was a day.
 * - Labels are `Intl` dates in the board's language, weekends are shaded on day columns, and
 *   all colours are the board's tokens.
 * - `GanttPoint` places a single instant in a row (upstream only had bars), and takes a ref so a
 *   Radix `TooltipTrigger asChild` can wrap it.
 */
import { addDays, addHours, isSameDay, isWeekend } from 'date-fns';
import {
  type ComponentProps,
  createContext,
  type CSSProperties,
  type FC,
  type ReactNode,
  useContext,
  useMemo,
} from 'react';
import { cn } from '@/lib/utils';

export type GanttZoom = 'day' | 'week' | 'month';

type GanttColumn = {
  start: number;
  label: string;
  sublabel?: string;
  /** Shaded, e.g. a weekend day. */
  secondary: boolean;
  /** Starts a new header group (a new day at hour zoom, a new month at day zoom). */
  groupStart: boolean;
  groupLabel: string;
  current: boolean;
};

type GanttContextProps = {
  start: number;
  end: number;
  zoom: GanttZoom;
  locale: string;
  now: number;
  columns: GanttColumn[];
  /** Horizontal position of an instant, as a percentage of the timeline width. */
  position: (time: number) => number;
};

const GanttContext = createContext<GanttContextProps | null>(null);

export const useGantt = () => {
  const context = useContext(GanttContext);
  if (!context) {
    throw new Error('Gantt components must be used within a GanttProvider');
  }
  return context;
};

const safeFormat = (locale: string, options: Intl.DateTimeFormatOptions) => {
  try {
    return new Intl.DateTimeFormat(locale, options);
  } catch {
    return new Intl.DateTimeFormat(undefined, options);
  }
};

/** Smallest a column may get before the timeline scrolls sideways instead. */
const COLUMN_MIN_WIDTH: Record<GanttZoom, number> = {
  day: 32,
  week: 104,
  month: 28,
};

const buildColumns = (
  start: number,
  end: number,
  zoom: GanttZoom,
  locale: string,
  now: number
): GanttColumn[] => {
  const columns: GanttColumn[] = [];
  if (zoom === 'day') {
    const hour = safeFormat(locale, { hour: 'numeric' });
    const day = safeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' });
    for (let time = start, index = 0; time < end; time = addHours(time, 1).getTime(), index++) {
      const date = new Date(time);
      const next = addHours(time, 1).getTime();
      columns.push({
        start: time,
        // Every other hour: "10 AM" in every 32px column runs the labels into each other.
        label: date.getHours() % 2 === 0 ? hour.format(date) : '',
        secondary: false,
        groupStart: index === 0 || date.getHours() === 0,
        groupLabel: day.format(date),
        current: now >= time && now < next,
      });
    }
    return columns;
  }

  const month = safeFormat(locale, { month: 'long', year: 'numeric' });
  const label =
    zoom === 'week'
      ? safeFormat(locale, { weekday: 'short', day: 'numeric' })
      : safeFormat(locale, { day: 'numeric' });
  for (let time = start, index = 0; time < end; time = addDays(time, 1).getTime(), index++) {
    const date = new Date(time);
    columns.push({
      start: time,
      label: label.format(date),
      // A month of 28px columns only has room for the day number; weekends are shaded instead.
      sublabel: undefined,
      secondary: isWeekend(date),
      groupStart: index === 0 || date.getDate() === 1,
      groupLabel: month.format(date),
      current: isSameDay(date, now),
    });
  }
  return columns;
};

export type GanttProviderProps = Omit<ComponentProps<'div'>, 'children'> & {
  start: number;
  end: number;
  zoom: GanttZoom;
  /** BCP 47 tag for the header labels; the board passes `i18n.language`. */
  locale?: string;
  /** Injectable for tests; defaults to the time of render. */
  now?: number;
  sidebarWidth?: number;
  rowHeight?: number;
  children: ReactNode;
};

export const GanttProvider: FC<GanttProviderProps> = ({
  start,
  end,
  zoom,
  locale = 'en-US',
  now: nowProp,
  sidebarWidth = 264,
  rowHeight = 44,
  className,
  style,
  children,
  ...props
}) => {
  const now = nowProp ?? Date.now();
  const columns = useMemo(
    () => buildColumns(start, end, zoom, locale, now),
    // `now` only moves the "current column" highlight, which can wait for the next zoom change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [start, end, zoom, locale]
  );
  const span = Math.max(1, end - start);

  const cssVariables = {
    '--gantt-sidebar-width': `${sidebarWidth}px`,
    '--gantt-header-height': '52px',
    '--gantt-row-height': `${rowHeight}px`,
    '--gantt-columns': columns.length,
    '--gantt-column-min': `${COLUMN_MIN_WIDTH[zoom]}px`,
  } as CSSProperties;

  return (
    <GanttContext.Provider
      value={{
        start,
        end,
        zoom,
        locale,
        now,
        columns,
        position: (time) => ((time - start) / span) * 100,
      }}
    >
      <div
        data-slot="gantt"
        data-zoom={zoom}
        className={cn(
          'relative isolate grid w-full overflow-auto overscroll-x-contain bg-card',
          className
        )}
        style={{
          ...cssVariables,
          gridTemplateColumns: 'var(--gantt-sidebar-width) minmax(0, 1fr)',
          ...style,
        }}
        {...props}
      >
        {children}
      </div>
    </GanttContext.Provider>
  );
};

export type GanttSidebarProps = {
  title: ReactNode;
  /** Right-aligned header for the items' trailing detail. */
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** Sticky left column: stays put while the timeline scrolls sideways. */
export const GanttSidebar: FC<GanttSidebarProps> = ({ title, meta, children, className }) => (
  <div
    data-slot="gantt-sidebar"
    className={cn('sticky left-0 z-30 h-max min-h-full border-r bg-card', className)}
  >
    <div
      className="sticky top-0 z-10 flex items-end justify-between gap-2 border-b bg-card/95 px-3 pb-2 text-[0.68rem] font-semibold tracking-wide text-muted-foreground uppercase backdrop-blur-sm"
      style={{ height: 'var(--gantt-header-height)' }}
    >
      <span className="truncate">{title}</span>
      {meta && <span className="shrink-0">{meta}</span>}
    </div>
    {children}
  </div>
);

export type GanttSidebarGroupProps = {
  name: ReactNode;
  /** Right-aligned detail in the group header, e.g. a count. */
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
};

export const GanttSidebarGroup: FC<GanttSidebarGroupProps> = ({
  name,
  meta,
  children,
  className,
}) => (
  <div role="group" className={className}>
    <div
      className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 text-xs font-semibold text-foreground"
      style={{ height: 'var(--gantt-row-height)' }}
    >
      <span className="truncate">{name}</span>
      {meta}
    </div>
    {children}
  </div>
);

export type GanttSidebarItemProps = {
  /** Makes the item a button; without it the item is a plain label. */
  onSelect?: () => void;
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
};

export const GanttSidebarItem: FC<GanttSidebarItemProps> = ({
  onSelect,
  children,
  className,
  'aria-label': ariaLabel,
}) => {
  const classes = cn(
    'flex w-full min-w-0 items-center gap-2.5 border-b border-border/60 px-3 text-left text-xs',
    onSelect &&
      'outline-none transition-colors hover:bg-state-hover focus-visible:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
    className
  );
  const style = { height: 'var(--gantt-row-height)' };

  return onSelect ? (
    <button
      type="button"
      className={classes}
      style={style}
      onClick={onSelect}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  ) : (
    <div className={classes} style={style} aria-label={ariaLabel}>
      {children}
    </div>
  );
};

export type GanttTimelineProps = {
  children: ReactNode;
  className?: string;
};

/** The scrolling right-hand side: header, background columns and rows. */
export const GanttTimeline: FC<GanttTimelineProps> = ({ children, className }) => (
  <div
    data-slot="gantt-timeline"
    className={cn('relative flex h-max min-h-full flex-col', className)}
    style={{ minWidth: 'calc(var(--gantt-columns) * var(--gantt-column-min))' }}
  >
    {children}
  </div>
);

const columnTemplate = { gridTemplateColumns: 'repeat(var(--gantt-columns), minmax(0, 1fr))' };

/** Two tiers: the day (hour zoom) or month (day zoom) on top, one label per column below. */
export const GanttHeader: FC<{ className?: string }> = ({ className }) => {
  const { columns } = useGantt();
  const groups = columns.reduce<{ index: number; span: number; label: string }[]>(
    (acc, column, index) => {
      if (column.groupStart || acc.length === 0) {
        acc.push({ index, span: 1, label: column.groupLabel });
      } else {
        acc[acc.length - 1].span++;
      }
      return acc;
    },
    []
  );

  return (
    <div
      data-slot="gantt-header"
      aria-hidden="true"
      className={cn(
        'sticky top-0 z-20 grid grid-rows-2 border-b bg-card/95 backdrop-blur-sm',
        className
      )}
      style={{ height: 'var(--gantt-header-height)' }}
    >
      <div className="grid" style={columnTemplate}>
        {groups.map((group) => (
          <div
            key={group.index}
            className="min-w-0 border-l border-border/60 first:border-l-0"
            style={{ gridColumn: `${group.index + 1} / span ${group.span}` }}
          >
            <span
              className="sticky inline-block truncate px-2 pt-1.5 text-[0.7rem] font-semibold text-foreground"
              style={{ left: 'var(--gantt-sidebar-width)' }}
            >
              {group.label}
            </span>
          </div>
        ))}
      </div>
      <div className="grid" style={columnTemplate}>
        {columns.map((column) => (
          <div
            key={column.start}
            className={cn(
              'flex min-w-0 items-center justify-center gap-1 border-l border-border/40 text-[0.66rem] text-muted-foreground tabular-nums first:border-l-0',
              column.groupStart && 'border-border',
              column.current && 'font-semibold text-foreground'
            )}
          >
            <span className="truncate">{column.label}</span>
            {column.sublabel && <span className="opacity-60">{column.sublabel}</span>}
          </div>
        ))}
      </div>
    </div>
  );
};

/** Grid lines and weekend shading behind the rows, full height. */
export const GanttColumns: FC<{ className?: string }> = ({ className }) => {
  const { columns } = useGantt();
  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-x-0 bottom-0 grid', className)}
      style={{ ...columnTemplate, top: 'var(--gantt-header-height)' }}
    >
      {columns.map((column) => (
        <div
          key={column.start}
          className={cn(
            'border-l border-border/35 first:border-l-0',
            column.groupStart && 'border-border/80',
            column.secondary && 'bg-muted/45'
          )}
        />
      ))}
    </div>
  );
};

export const GanttFeatureList: FC<{ children: ReactNode; className?: string }> = ({
  children,
  className,
}) => <div className={cn('relative', className)}>{children}</div>;

/** Aligns with a `GanttSidebarGroup`: an empty band where the group's name sits in the sidebar. */
export const GanttFeatureListGroup: FC<{ children: ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <div className={className}>
    <div className="border-b bg-muted/40" style={{ height: 'var(--gantt-row-height)' }} />
    {children}
  </div>
);

export type GanttFeatureRowProps = ComponentProps<'div'>;

export const GanttFeatureRow: FC<GanttFeatureRowProps> = ({ className, style, ...props }) => (
  <div
    data-slot="gantt-row"
    className={cn('relative border-b border-border/60', className)}
    style={{ height: 'var(--gantt-row-height)', ...style }}
    {...props}
  />
);

export type GanttFeatureItemProps = Omit<ComponentProps<'div'>, 'children'> & {
  startAt: number;
  endAt: number;
  children?: ReactNode;
};

/** A span of time in a row, clipped to the window. */
export const GanttFeatureItem: FC<GanttFeatureItemProps> = ({
  startAt,
  endAt,
  className,
  style,
  children,
  ...props
}) => {
  const { position } = useGantt();
  const left = Math.max(0, position(startAt));
  const right = Math.min(100, position(endAt));
  if (right < 0 || left > 100) {
    return null;
  }

  return (
    <div
      data-slot="gantt-feature"
      className={cn('absolute top-1/2 -translate-y-1/2 rounded-md', className)}
      style={{ left: `${left}%`, width: `max(${right - left}%, 2px)`, ...style }}
      {...props}
    >
      {children}
    </div>
  );
};

export type GanttPointProps = ComponentProps<'span'> & {
  date: number;
};

/** One instant in a row, centred on its time. */
export const GanttPoint: FC<GanttPointProps> = ({ date, className, style, ...props }) => {
  const { position } = useGantt();
  const left = position(date);
  if (left < 0 || left > 100) {
    return null;
  }
  return (
    <span
      className={cn('absolute top-1/2 -translate-x-1/2 -translate-y-1/2', className)}
      style={{ left: `${left}%`, ...style }}
      {...props}
      // After the spread: a Radix trigger wrapping the point passes its own `data-slot`.
      data-slot="gantt-point"
    />
  );
};

export type GanttMarkerProps = {
  date: number;
  label: ReactNode;
  className?: string;
};

/** A labelled vertical line across every row, e.g. a deploy or a maintenance window. */
export const GanttMarker: FC<GanttMarkerProps> = ({ date, label, className }) => {
  const { position } = useGantt();
  const left = position(date);
  if (left < 0 || left > 100) {
    return null;
  }
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 z-20 flex w-0 flex-col items-center"
      style={{ left: `${left}%` }}
    >
      {/* Straddles the header's bottom edge, clear of the group labels above it. */}
      <span
        className={cn(
          'sticky z-30 rounded-full bg-foreground px-1.5 py-px text-[0.62rem] leading-4 font-semibold whitespace-nowrap text-background shadow-xs',
          className
        )}
        style={{
          top: 'calc(var(--gantt-header-height) - 8px)',
          marginTop: 'calc(var(--gantt-header-height) - 8px)',
        }}
      >
        {label}
      </span>
      <span className={cn('w-0.5 flex-1 bg-foreground/60', className)} />
    </div>
  );
};

/** The "now" line. Upstream called it Today; at hour zoom it has to be the current instant. */
export const GanttToday: FC<{ label: ReactNode; className?: string }> = ({ label, className }) => {
  const { now } = useGantt();
  return (
    <GanttMarker
      date={now}
      label={label}
      className={cn('bg-primary text-primary-foreground', className)}
    />
  );
};
