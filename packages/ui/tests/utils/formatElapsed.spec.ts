import { formatElapsed } from '../../src/utils/formatElapsed';

it('labels the amount with its unit in the given language, with no "ago" framing', () => {
  expect(formatElapsed(5, 'en-US')).toBe('5 seconds');
  expect(formatElapsed(5, 'pt-BR')).toBe('5 segundos');
  expect(formatElapsed(90, 'en-US')).toBe('2 minutes');
  expect(formatElapsed(3600, 'en-US')).toBe('1 hour');
  expect(formatElapsed(2 * 86_400, 'en-US')).toBe('2 days');
});
