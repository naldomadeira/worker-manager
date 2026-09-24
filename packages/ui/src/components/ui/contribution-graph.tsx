/**
 * Contribution graph, adapted from Kibo UI (https://www.kibo-ui.com/components/contribution-graph,
 * MIT, Hayden Bleasel). The compound API is upstream's; what changed for the board:
 *
 * - Colour comes from the board's tokens: one `tone` (a job status colour) mixed into an empty
 *   cell colour at four strengths, so the ramp retints with `uiConfig.theme` and flips correctly
 *   in dark mode instead of using upstream's greys.
 * - Month and weekday labels are `Intl` names in the board's language, and the week starts on the
 *   locale's first day. No date-fns locale is bundled for it.
 * - A `strip` layout for short ranges (7 or 30 days), where a seven-row grid would be a sliver.
 * - Keyboard access: one tab stop, arrow keys move between days (roving tabindex), and every
 *   cell carries its own accessible label. Upstream's hardcoded English `<title>` is gone.
 * - No throws on bad input: an out of range level is clamped rather than crashing the page.
 */
import type { Day as WeekDay } from 'date-fns';
import {
  differenceInCalendarDays,
  eachDayOfInterval,
  formatISO,
  getDay,
  getMonth,
  nextDay,
  parseISO,
  subWeeks,
} from 'date-fns';
import {
  type ComponentProps,
  type CSSProperties,
  createContext,
  Fragment,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cn } from '@/lib/utils';

export type Activity = {
  /** Calendar day, `yyyy-MM-dd`. */
  date: string;
  count: number;
  level: number;
  /** The day is still in progress (today), so its count is not final. */
  partial?: boolean;
};

type Week = Array<Activity | undefined>;

export type Labels = {
  /** Accessible name of the whole graph. */
  title?: string;
  months?: string[];
  weekdays?: string[];
  totalCount?: string;
  legend?: {
    less?: string;
    more?: string;
  };
};

export type ContributionGraphLayout = 'weeks' | 'strip';

/** Which status colour the ramp is mixed from. */
export type ContributionGraphTone = 'completed' | 'failed' | 'active';

type MonthLabel = {
  weekIndex: number;
  label: string;
};

const TONE_VARS: Record<ContributionGraphTone, string> = {
  completed: 'var(--status-completed)',
  failed: 'var(--status-failed)',
  active: 'var(--status-active)',
};

/** Share of the tone in each level, from the first non-empty level up. */
const LEVEL_MIX = [30, 52, 76, 100];

const safeFormatter = (locale: string, options: Intl.DateTimeFormatOptions) => {
  try {
    return new Intl.DateTimeFormat(locale, options);
  } catch {
    return new Intl.DateTimeFormat(undefined, options);
  }
};

/** Month names in the given language, January first. */
export const localizedMonths = (locale: string): string[] => {
  const format = safeFormatter(locale, { month: 'short' });
  return Array.from({ length: 12 }, (_, month) => format.format(new Date(2024, month, 1)));
};

/** Weekday names in the given language, Sunday first (date-fns' `Day` order). */
export const localizedWeekdays = (locale: string): string[] => {
  const format = safeFormatter(locale, { weekday: 'short' });
  // 2024-09-01 was a Sunday.
  return Array.from({ length: 7 }, (_, day) => format.format(new Date(2024, 8, 1 + day)));
};

/**
 * The locale's first day of the week, from `Intl.Locale#getWeekInfo` where the runtime has it.
 * Without it, only the regions that start on Sunday are special-cased.
 */
export const localeWeekStart = (locale: string): WeekDay => {
  try {
    const intlLocale = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = intlLocale.getWeekInfo?.() ?? intlLocale.weekInfo;
    if (info?.firstDay) {
      return (info.firstDay % 7) as WeekDay;
    }
    return ['US', 'CA', 'JP', 'BR', 'KR', 'IL', 'MX', 'PH'].includes(intlLocale.region ?? '')
      ? 0
      : 1;
  } catch {
    return 0;
  }
};

type ContributionGraphContextType = {
  data: Activity[];
  weeks: Week[];
  indexByDate: Map<string, number>;
  blockMargin: number;
  blockRadius: number;
  blockSize: number;
  fontSize: number;
  labels: Labels;
  labelHeight: number;
  labelWidth: number;
  layout: ContributionGraphLayout;
  locale: string;
  maxLevel: number;
  totalCount: number;
  weekStart: WeekDay;
  width: number;
  height: number;
  focusIndex: number;
  setFocusIndex: (index: number) => void;
};

const ContributionGraphContext = createContext<ContributionGraphContextType | null>(null);

const useContributionGraph = () => {
  const context = useContext(ContributionGraphContext);

  if (!context) {
    throw new Error('ContributionGraph components must be used within a ContributionGraph');
  }

  return context;
};

const fillHoles = (activities: Activity[]): Activity[] => {
  if (activities.length === 0) {
    return [];
  }

  const sortedActivities = [...activities].sort((a, b) => a.date.localeCompare(b.date));
  const calendar = new Map<string, Activity>(activities.map((a) => [a.date, a]));
  const firstActivity = sortedActivities[0];
  const lastActivity = sortedActivities[sortedActivities.length - 1];

  return eachDayOfInterval({
    start: parseISO(firstActivity.date),
    end: parseISO(lastActivity.date),
  }).map((day) => {
    const date = formatISO(day, { representation: 'date' });
    return calendar.get(date) ?? { date, count: 0, level: 0 };
  });
};

const groupByWeeks = (activities: Activity[], weekStart: WeekDay = 0): Week[] => {
  if (activities.length === 0) {
    return [];
  }

  const firstDate = parseISO(activities[0].date);
  const firstCalendarDate =
    getDay(firstDate) === weekStart ? firstDate : subWeeks(nextDay(firstDate, weekStart), 1);

  const paddedActivities: Week = [
    ...Array.from<undefined>({ length: differenceInCalendarDays(firstDate, firstCalendarDate) }),
    ...activities,
  ];

  const numberOfWeeks = Math.ceil(paddedActivities.length / 7);

  return Array.from({ length: numberOfWeeks }, (_, weekIndex) =>
    paddedActivities.slice(weekIndex * 7, weekIndex * 7 + 7)
  );
};

const getMonthLabels = (weeks: Week[], monthNames: string[]): MonthLabel[] =>
  weeks
    .reduce<MonthLabel[]>((labels, week, weekIndex) => {
      const firstActivity = week.find((activity) => activity !== undefined);
      if (!firstActivity) {
        return labels;
      }

      const month = monthNames[getMonth(parseISO(firstActivity.date))] ?? '';
      const prevLabel = labels[labels.length - 1];

      if (weekIndex === 0 || !prevLabel || prevLabel.label !== month) {
        return labels.concat({ weekIndex, label: month });
      }

      return labels;
    }, [])
    .filter(({ weekIndex }, index, labels) => {
      const minWeeks = 3;

      if (index === 0) {
        return !labels[1] || labels[1].weekIndex - weekIndex >= minWeeks;
      }

      if (index === labels.length - 1) {
        return weeks.slice(weekIndex).length >= minWeeks;
      }

      return true;
    });

/** Custom properties the cells read their fill from: `--cg-level-0` .. `--cg-level-N`. */
const levelVariables = (tone: ContributionGraphTone, maxLevel: number): CSSProperties => {
  const vars: Record<string, string> = {
    '--cg-tone': TONE_VARS[tone],
    // An empty day is a faint tint of the text colour on the card, so it stays visible on the
    // white light card and on the dark one alike.
    '--cg-level-0': 'color-mix(in oklab, var(--foreground) 7%, var(--card))',
  };
  for (let level = 1; level <= maxLevel; level++) {
    const mix =
      maxLevel === LEVEL_MIX.length
        ? LEVEL_MIX[level - 1]
        : Math.round(30 + (70 * (level - 1)) / Math.max(1, maxLevel - 1));
    vars[`--cg-level-${level}`] = `color-mix(in oklab, var(--cg-tone) ${mix}%, var(--cg-level-0))`;
  }
  return vars as CSSProperties;
};

export type ContributionGraphProps = HTMLAttributes<HTMLDivElement> & {
  data: Activity[];
  blockMargin?: number;
  blockRadius?: number;
  blockSize?: number;
  fontSize?: number;
  labels?: Labels;
  layout?: ContributionGraphLayout;
  /** BCP 47 tag for the month and weekday names; the board passes `i18n.language`. */
  locale?: string;
  maxLevel?: number;
  style?: CSSProperties;
  tone?: ContributionGraphTone;
  totalCount?: number;
  /** Defaults to the locale's own first day of the week. */
  weekStart?: WeekDay;
  children: ReactNode;
  className?: string;
};

export const ContributionGraph = ({
  data: dataProp,
  blockMargin = 4,
  blockRadius,
  blockSize = 12,
  fontSize = 11,
  labels: labelsProp = undefined,
  layout = 'weeks',
  locale = 'en-US',
  maxLevel: maxLevelProp = 4,
  style = {},
  tone = 'completed',
  totalCount: totalCountProp = undefined,
  weekStart: weekStartProp,
  className,
  ...props
}: ContributionGraphProps) => {
  const maxLevel = Math.max(1, maxLevelProp);
  const weekStart = weekStartProp ?? localeWeekStart(locale);
  const data = useMemo(() => fillHoles(dataProp), [dataProp]);
  const weeks = useMemo(() => groupByWeeks(data, weekStart), [data, weekStart]);
  const indexByDate = useMemo(
    () => new Map(data.map((activity, index) => [activity.date, index])),
    [data]
  );
  // The most recent day is where keyboard focus lands first.
  const [focusIndexState, setFocusIndex] = useState<number | null>(null);
  const focusIndex = Math.min(focusIndexState ?? data.length - 1, data.length - 1);

  const labels: Labels = useMemo(
    () => ({
      months: localizedMonths(locale),
      weekdays: localizedWeekdays(locale),
      ...labelsProp,
    }),
    [labelsProp, locale]
  );

  const LABEL_MARGIN = 6;
  const labelHeight = fontSize + LABEL_MARGIN;
  // Room for a short weekday name ("Mon", "Mo.", "пн") in the weeks layout.
  const labelWidth = layout === 'weeks' ? Math.ceil(fontSize * 3) : 0;

  const totalCount =
    typeof totalCountProp === 'number'
      ? totalCountProp
      : data.reduce((sum, activity) => sum + activity.count, 0);

  const width = labelWidth + weeks.length * (blockSize + blockMargin) - blockMargin;
  const height = labelHeight + (blockSize + blockMargin) * 7 - blockMargin;

  if (data.length === 0) {
    return null;
  }

  return (
    <ContributionGraphContext.Provider
      value={{
        data,
        weeks,
        indexByDate,
        blockMargin,
        blockRadius: blockRadius ?? Math.max(2, Math.round(blockSize * 0.22)),
        blockSize,
        fontSize,
        labels,
        labelHeight,
        labelWidth,
        layout,
        locale,
        maxLevel,
        totalCount,
        weekStart,
        width,
        height,
        focusIndex,
        setFocusIndex,
      }}
    >
      <div
        data-slot="contribution-graph"
        data-layout={layout}
        className={cn('flex w-full flex-col gap-2', className)}
        style={{ fontSize, ...levelVariables(tone, maxLevel), ...style }}
        {...props}
      />
    </ContributionGraphContext.Provider>
  );
};

export type ContributionGraphBlockProps = Omit<ComponentProps<'rect'>, 'children'> & {
  activity: Activity;
  dayIndex: number;
  weekIndex: number;
};

/**
 * One day. An SVG `rect` in the weeks layout, a `div` in the strip layout; either way it takes a
 * ref and arbitrary props, so it can be a Radix `TooltipTrigger asChild` target.
 */
export const ContributionGraphBlock = ({
  activity,
  dayIndex,
  weekIndex,
  className,
  style,
  ...props
}: ContributionGraphBlockProps) => {
  const {
    blockSize,
    blockMargin,
    blockRadius,
    labelHeight,
    labelWidth,
    layout,
    maxLevel,
    indexByDate,
    focusIndex,
    setFocusIndex,
  } = useContributionGraph();

  const level = Math.min(maxLevel, Math.max(0, Math.round(activity.level)));
  const index = indexByDate.get(activity.date) ?? -1;
  const common = {
    'data-count': activity.count,
    'data-date': activity.date,
    'data-level': level,
    'data-index': index,
    'data-partial': activity.partial ? 'true' : undefined,
    role: 'img',
    tabIndex: index === focusIndex ? 0 : -1,
    onFocus: () => setFocusIndex(index),
  };

  if (layout === 'strip') {
    return (
      <div
        {...common}
        {...(props as ComponentProps<'div'>)}
        // After the spread: a Radix trigger wrapping the block passes its own `data-slot`.
        data-slot="contribution-graph-block"
        className={cn(
          'min-w-0 rounded-[calc(var(--radius)*0.45)] outline-none transition-[filter,box-shadow] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring',
          'data-[partial=true]:border data-[partial=true]:border-dashed data-[partial=true]:border-muted-foreground/60',
          className
        )}
        style={{ height: blockSize, background: `var(--cg-level-${level})`, ...style }}
      />
    );
  }

  return (
    <rect
      {...common}
      className={cn(
        'outline-none transition-[filter] hover:brightness-110 focus-visible:stroke-ring focus-visible:[stroke-width:2]',
        'data-[partial=true]:stroke-muted-foreground/70 data-[partial=true]:[stroke-dasharray:2_2]',
        className
      )}
      height={blockSize}
      rx={blockRadius}
      ry={blockRadius}
      width={blockSize}
      x={labelWidth + (blockSize + blockMargin) * weekIndex}
      y={labelHeight + (blockSize + blockMargin) * dayIndex}
      style={{ fill: `var(--cg-level-${level})`, ...style }}
      {...props}
      data-slot="contribution-graph-block"
    />
  );
};

/** Arrow-key movement between days: a week is a column in the weeks layout, a row step in the strip. */
const useRovingKeys = (count: number, weekStep: number) => {
  const { setFocusIndex } = useContributionGraph();
  const ref = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = Number((event.target as Element).getAttribute('data-index'));
    if (Number.isNaN(current)) {
      return;
    }
    const steps: Record<string, number> = {
      ArrowRight: weekStep,
      ArrowLeft: -weekStep,
      ArrowDown: weekStep === 1 ? 0 : 1,
      ArrowUp: weekStep === 1 ? 0 : -1,
      Home: -current,
      End: count - 1 - current,
    };
    const step = steps[event.key];
    if (step === undefined) {
      return;
    }
    event.preventDefault();
    const next = Math.min(count - 1, Math.max(0, current + step));
    setFocusIndex(next);
    ref.current?.querySelector<HTMLElement | SVGElement>(`[data-index="${next}"]`)?.focus();
  };

  return { ref, onKeyDown };
};

export type ContributionGraphCalendarProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  hideMonthLabels?: boolean;
  hideWeekdayLabels?: boolean;
  className?: string;
  children: (props: { activity: Activity; dayIndex: number; weekIndex: number }) => ReactNode;
};

export const ContributionGraphCalendar = ({
  hideMonthLabels = false,
  hideWeekdayLabels = false,
  className,
  children,
  ...props
}: ContributionGraphCalendarProps) => {
  const {
    data,
    weeks,
    width,
    height,
    blockSize,
    blockMargin,
    labels,
    labelHeight,
    labelWidth,
    layout,
    locale,
    weekStart,
  } = useContributionGraph();
  const { ref, onKeyDown } = useRovingKeys(data.length, layout === 'strip' ? 1 : 7);

  const monthLabels = useMemo(
    () => getMonthLabels(weeks, labels.months ?? localizedMonths(locale)),
    [weeks, labels.months, locale]
  );

  if (layout === 'strip') {
    return (
      <div
        ref={ref}
        role="group"
        aria-label={labels.title}
        onKeyDown={onKeyDown}
        className={cn('grid w-full', className)}
        style={{
          gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))`,
          gap: blockMargin,
        }}
        {...props}
      >
        {data.map((activity, index) => (
          <Fragment key={activity.date}>
            {children({ activity, dayIndex: index, weekIndex: 0 })}
          </Fragment>
        ))}
      </div>
    );
  }

  const weekdays = labels.weekdays ?? localizedWeekdays(locale);

  return (
    <div
      ref={ref}
      onKeyDown={onKeyDown}
      className={cn('max-w-full overflow-x-auto overflow-y-hidden', className)}
      {...props}
    >
      <svg
        role="group"
        aria-label={labels.title}
        className="block overflow-visible"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
      >
        {!hideMonthLabels && (
          <g className="fill-muted-foreground" aria-hidden="true">
            {monthLabels.map(({ label, weekIndex }) => (
              <text
                dominantBaseline="hanging"
                key={weekIndex}
                x={labelWidth + (blockSize + blockMargin) * weekIndex}
              >
                {label}
              </text>
            ))}
          </g>
        )}
        {!hideWeekdayLabels && (
          // Every other row, as GitHub does: all seven would crowd a 12px row.
          <g className="fill-muted-foreground" aria-hidden="true">
            {[1, 3, 5].map((row) => (
              <text
                key={row}
                dominantBaseline="middle"
                x={0}
                y={labelHeight + (blockSize + blockMargin) * row + blockSize / 2}
              >
                {weekdays[(weekStart + row) % 7]}
              </text>
            ))}
          </g>
        )}
        {weeks.map((week, weekIndex) =>
          week.map((activity, dayIndex) =>
            activity ? (
              <Fragment key={`${weekIndex}-${dayIndex}`}>
                {children({ activity, dayIndex, weekIndex })}
              </Fragment>
            ) : null
          )
        )}
      </svg>
    </div>
  );
};

export type ContributionGraphAxisProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  /** Label under a given day of the strip, or nothing to leave it blank. */
  children: (props: { activity: Activity; index: number }) => ReactNode;
};

/** Day labels under the strip layout, aligned to its columns. */
export const ContributionGraphAxis = ({
  className,
  children,
  ...props
}: ContributionGraphAxisProps) => {
  const { data, blockMargin } = useContributionGraph();

  return (
    <div
      aria-hidden="true"
      className={cn('grid w-full text-muted-foreground', className)}
      style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))`, gap: blockMargin }}
      {...props}
    >
      {data.map((activity, index) => (
        <span key={activity.date} className="min-w-0 overflow-visible whitespace-nowrap">
          {children({ activity, index })}
        </span>
      ))}
    </div>
  );
};

export type ContributionGraphFooterProps = HTMLAttributes<HTMLDivElement>;

export const ContributionGraphFooter = ({ className, ...props }: ContributionGraphFooterProps) => (
  <div
    className={cn('flex flex-wrap items-center gap-1 whitespace-nowrap sm:gap-x-4', className)}
    {...props}
  />
);

export type ContributionGraphTotalCountProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  children?: (props: { totalCount: number }) => ReactNode;
};

export const ContributionGraphTotalCount = ({
  className,
  children,
  ...props
}: ContributionGraphTotalCountProps) => {
  const { totalCount, labels } = useContributionGraph();

  if (children) {
    return <>{children({ totalCount })}</>;
  }

  return (
    <div className={cn('text-muted-foreground', className)} {...props}>
      {(labels.totalCount ?? '{{count}}').replace('{{count}}', String(totalCount))}
    </div>
  );
};

export type ContributionGraphLegendProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  children?: (props: { level: number }) => ReactNode;
};

export const ContributionGraphLegend = ({
  className,
  children,
  ...props
}: ContributionGraphLegendProps) => {
  const { labels, maxLevel, blockRadius } = useContributionGraph();
  const size = 11;

  return (
    <div className={cn('ml-auto flex items-center gap-[3px]', className)} {...props}>
      <span className="mr-1 text-muted-foreground">{labels.legend?.less}</span>
      {Array.from({ length: maxLevel + 1 }, (_, level) =>
        children ? (
          <Fragment key={level}>{children({ level })}</Fragment>
        ) : (
          <svg height={size} key={level} width={size} aria-hidden="true">
            <rect
              data-level={level}
              height={size}
              rx={Math.min(blockRadius, 3)}
              ry={Math.min(blockRadius, 3)}
              width={size}
              style={{ fill: `var(--cg-level-${level})` }}
            />
          </svg>
        )
      )}
      <span className="ml-1 text-muted-foreground">{labels.legend?.more}</span>
    </div>
  );
};
