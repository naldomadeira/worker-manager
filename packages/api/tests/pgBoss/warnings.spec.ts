import { depthWindow, mentionsQueue, warningQueueName } from '@worker-manager/api/engine';

describe('pg-boss warning visibility', () => {
  it('reads the queue out of the keys pg-boss stores it under', () => {
    const known = new Set(['emails', 'reports']);

    expect(warningQueueName({ name: 'emails', queuedCount: 3 }, known)).toBe('emails');
    expect(warningQueueName({ queue: 'reports', key: '' }, known)).toBe('reports');
    expect(warningQueueName({ name: 'job_common' }, known)).toBeNull();
    expect(warningQueueName(null, known)).toBeNull();
  });

  it.each([
    ['its queue', { message: '', data: { name: 'secret' } }, true],
    ['a quoted mention in the message', { message: 'queue "secret" is big', data: {} }, true],
    ['a query parameter', { message: 'slow', data: { values: ['secret', 3] } }, true],
    ['a literal in a query', { message: 'slow', data: { sql: "WHERE name = 'secret'" } }, true],
    ['a quoted mention inside a string', { message: '', data: { note: 'see "secret"' } }, true],
    ['a longer name', { message: 'queue "secret-2"', data: { name: 'secret-2' } }, false],
    ['a bare word', { message: 'no secret here', data: { text: 'secretive' } }, false],
  ])('%s -> %s', (_label, warning, hidden) => {
    expect(mentionsQueue(warning, 'secret')).toBe(hidden);
  });
});

describe('depthWindow', () => {
  it('ends now and keeps the chart under about a hundred points', () => {
    for (const range of ['1h', '6h', '24h', '7d'] as const) {
      const window = depthWindow(range, 'max', 1_000_000_000_000);
      const points = (window.to - window.from) / 1000 / window.bucketSeconds;

      expect(window.to).toBe(1_000_000_000_000);
      expect(points).toBeGreaterThanOrEqual(60);
      expect(points).toBeLessThanOrEqual(100);
    }
  });
});
