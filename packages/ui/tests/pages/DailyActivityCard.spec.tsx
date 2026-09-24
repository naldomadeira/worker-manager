import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  DailyActivityCard,
  toDayActivities,
} from '../../src/pages/MetricsHistoryPage/DailyActivityCard';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 24, 15, 0, 0);
const today = Math.floor(NOW / DAY) * DAY;

beforeAll(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'queueMicrotask',
      'nextTick',
      'setImmediate',
    ],
  });
});
afterAll(() => {
  jest.useRealTimers();
});

const rows = [
  { x: today - 6 * DAY, completed: 100, failed: 0 },
  { x: today - 5 * DAY, completed: 200, failed: 10 },
  { x: today - 4 * DAY, completed: 300, failed: 30 },
  { x: today - 2 * DAY, completed: 400, failed: 40 },
  { x: today, completed: 50, failed: 1 },
];

describe('toDayActivities', () => {
  it('spans the whole range, oldest first, with today last and marked in progress', () => {
    const cells = toDayActivities(rows, 7, 'completed', NOW);
    expect(cells).toHaveLength(7);
    expect(cells[0].date).toBe(new Date(today - 6 * DAY).toISOString().slice(0, 10));
    expect(cells[6].partial).toBe(true);
    // A day without a bucket is a real zero.
    expect(cells[3]).toMatchObject({ count: 0, level: 0 });
  });

  it('grades the busy days by quartile', () => {
    const levels = toDayActivities(rows, 7, 'completed', NOW).map((cell) => cell.level);
    expect(levels).toEqual([1, 2, 3, 0, 4, 0, 1]);
  });

  it('measures failures and the failure rate from the same buckets', () => {
    const failed = toDayActivities(rows, 7, 'failed', NOW);
    expect(failed.map((cell) => cell.count)).toEqual([0, 10, 30, 0, 40, 0, 1]);
    const rate = toDayActivities(rows, 7, 'failureRate', NOW);
    expect(rate[2].count).toBeCloseTo(30 / 330);
  });
});

it('shows the card with its measure toggle and one labelled cell per day', () => {
  render(<DailyActivityCard rows={rows} days={7} />);

  const card = screen.getByTestId('daily-activity');
  expect(within(card).getByText('METRICS_HISTORY.ACTIVITY.TITLE')).toBeTruthy();
  expect(
    within(card).getByRole('group', { name: 'METRICS_HISTORY.ACTIVITY.MEASURE' })
  ).toBeTruthy();
  // Seven days in a strip, each named for assistive tech.
  const cells = within(card).getAllByRole('img');
  expect(cells).toHaveLength(7);
  expect(cells[0].getAttribute('aria-label')).toContain('METRICS_HISTORY.BAR_LABEL');
  expect(within(card).getByText('METRICS_HISTORY.ACTIVITY.PARTIAL_HINT')).toBeTruthy();
  expect(within(card).getByText('METRICS_HISTORY.ACTIVITY.LESS')).toBeTruthy();
});

it('switches the colour and the statistics when another measure is picked', () => {
  render(<DailyActivityCard rows={rows} days={7} />);
  const graph = () => document.querySelector('[data-slot=contribution-graph]') as HTMLElement;

  expect(graph().style.getPropertyValue('--cg-tone')).toBe('var(--status-completed)');
  expect(screen.getByText('METRICS_HISTORY.ACTIVITY.AVERAGE')).toBeTruthy();

  fireEvent.click(
    screen.getByRole('button', { name: 'METRICS_HISTORY.ACTIVITY.MODE_FAILURE_RATE' })
  );

  expect(graph().style.getPropertyValue('--cg-tone')).toBe('var(--status-failed)');
  expect(screen.getByText('METRICS_HISTORY.ACTIVITY.AVERAGE_RATE')).toBeTruthy();
  expect(
    screen
      .getByRole('button', { name: 'METRICS_HISTORY.ACTIVITY.MODE_FAILURE_RATE' })
      .getAttribute('aria-pressed')
  ).toBe('true');
});

it('folds 90 days into a week grid', () => {
  const { container } = render(<DailyActivityCard rows={rows} days={90} />);
  expect(container.querySelectorAll('svg rect[data-slot=contribution-graph-block]')).toHaveLength(
    90
  );
});
