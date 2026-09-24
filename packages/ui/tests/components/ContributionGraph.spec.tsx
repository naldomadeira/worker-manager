import { fireEvent, render, screen } from '@testing-library/react';
import {
  type Activity,
  ContributionGraph,
  ContributionGraphBlock,
  ContributionGraphCalendar,
  ContributionGraphLegend,
  localeWeekStart,
  localizedMonths,
} from '../../src/components/ui/contribution-graph';

const days = (count: number, start = '2026-06-01'): Activity[] => {
  const first = new Date(`${start}T00:00:00`);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + index);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate()
    ).padStart(2, '0')}`;
    return { date: iso, count: index, level: index % 5 };
  });
};

const renderGraph = (
  data: Activity[],
  props: Partial<Parameters<typeof ContributionGraph>[0]> = {}
) =>
  render(
    <ContributionGraph
      data={data}
      labels={{ title: 'Activity', legend: { less: 'Less', more: 'More' } }}
      {...props}
    >
      <ContributionGraphCalendar>
        {({ activity, dayIndex, weekIndex }) => (
          <ContributionGraphBlock
            activity={activity}
            dayIndex={dayIndex}
            weekIndex={weekIndex}
            aria-label={`${activity.date}: ${activity.count}`}
          />
        )}
      </ContributionGraphCalendar>
      <ContributionGraphLegend />
    </ContributionGraph>
  );

it('draws one labelled cell per day, filling the days the data skips', () => {
  const data = [
    { date: '2026-06-01', count: 3, level: 2 },
    { date: '2026-06-04', count: 1, level: 1 },
  ];
  renderGraph(data);

  const cells = screen.getAllByRole('img');
  expect(cells).toHaveLength(4);
  expect(screen.getByRole('img', { name: '2026-06-01: 3' }).getAttribute('data-level')).toBe('2');
  // The gap days are drawn as empty days, not left out.
  expect(screen.getByRole('img', { name: '2026-06-02: 0' }).getAttribute('data-level')).toBe('0');
});

it('clamps a level outside the scale instead of throwing', () => {
  renderGraph([{ date: '2026-06-01', count: 9, level: 12 }]);
  expect(screen.getByRole('img').getAttribute('data-level')).toBe('4');
});

it('uses a single strip of cells for a short range', () => {
  const { container } = renderGraph(days(7), { layout: 'strip' });
  expect(container.querySelector('svg rect[data-slot=contribution-graph-block]')).toBeNull();
  expect(screen.getAllByRole('img')).toHaveLength(7);
  expect(screen.getByRole('group', { name: 'Activity' })).toBeTruthy();
});

it('folds a long range into weeks with localized month names', () => {
  const { container } = renderGraph(days(90), { locale: 'de-DE' });
  expect(container.querySelectorAll('rect[data-slot=contribution-graph-block]')).toHaveLength(90);
  const monthLabels = Array.from(container.querySelectorAll('text')).map(
    (node) => node.textContent
  );
  expect(monthLabels).toEqual(expect.arrayContaining([localizedMonths('de-DE')[6]]));
});

it('is one tab stop, with the arrow keys moving between days', () => {
  renderGraph(days(7), { layout: 'strip' });
  const cells = screen.getAllByRole('img');
  // Only the latest day is in the tab order.
  expect(cells.filter((cell) => cell.getAttribute('tabindex') === '0')).toEqual([cells[6]]);

  cells[6].focus();
  fireEvent.keyDown(cells[6], { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(cells[5]);
  fireEvent.keyDown(cells[5], { key: 'Home' });
  expect(document.activeElement).toBe(cells[0]);
  expect(cells[0].getAttribute('tabindex')).toBe('0');
});

it('labels the legend with the given words', () => {
  renderGraph(days(3));
  expect(screen.getByText('Less')).toBeTruthy();
  expect(screen.getByText('More')).toBeTruthy();
});

it("starts the week on the locale's first day", () => {
  expect(localeWeekStart('en-US')).toBe(0);
  expect(localeWeekStart('de-DE')).toBe(1);
});
