import fs from 'fs';
import path from 'path';
import { render, screen } from '@testing-library/react';
import type { AppJob } from '@worker-manager/api/typings/app';
import i18next, { type i18n as I18n } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { Timeline } from '../src/components/JobCard/Timeline/Timeline';
import { languages } from '../src/constants/languages';
import { UIConfigContext } from '../src/hooks/useUIConfig';

const localesDir = path.resolve(__dirname, '../src/static/locales');

function instanceFor(lng: string): I18n {
  const instance = i18next.createInstance();
  void instance.init({
    lng,
    fallbackLng: 'en-US',
    defaultNS: 'messages',
    ns: ['messages'],
    initAsync: false,
    interpolation: { escapeValue: false },
    resources: {
      [lng]: {
        messages: JSON.parse(fs.readFileSync(path.join(localesDir, lng, 'messages.json'), 'utf8')),
      },
    },
  });
  return instance;
}

// Every key that interpolates a count, with the options its call site passes.
const counted: Array<[string, (count: number) => Record<string, unknown>]> = [
  ['JOB.DIAGNOSTICS.ATTEMPTS_STARTED', (count) => ({ count })],
  ['JOB.DIAGNOSTICS.STALLED', (count) => ({ count })],
  ['JOB.DURATION.MILLI_SECS', (count) => ({ count })],
  ['DASHBOARD.KPI.PAUSED', (count) => ({ count })],
  ['JOB.FLOW.PROCESSED', (count) => ({ count })],
  ['JOB.FLOW.UNPROCESSED', (count) => ({ count })],
  ['JOB.FLOW.FAILED', (count) => ({ count })],
  ['JOB.FLOW.IGNORED', (count) => ({ count })],
  ['JOB.LOGS.LINES', (count) => ({ shown: count, count })],
  ['QUEUE.ACTIONS.RETRY_ALL_FAILED', (count) => ({ count })],
  ['QUEUE.ACTIONS.RETRY_FAILED_IN_ALL_QUEUES', (count) => ({ count })],
  ['QUEUE.ACTIONS.RETRY_FAILED_IN_GROUP', (count) => ({ count })],
  ['QUEUE.ACTIONS.CONFIRM.RETRY_FAILED_QUEUES', (count) => ({ count, queues: count })],
  ['QUEUE.ACTIONS.TOAST.RETRY_QUEUES_PENDING', (count) => ({ count, queues: count })],
  ['QUEUE.ACTIONS.TOAST.RETRY_QUEUES_DONE', (count) => ({ count, queues: count })],
  ['QUEUE.ACTIONS.CONFIRM.OBLITERATE_FORCE_DESCRIPTION', (count) => ({ count })],
  ['QUEUE.ACTIONS.CONFIRM.PAUSE_GROUP', (count) => ({ count })],
  ['QUEUE.ACTIONS.CONFIRM.RESUME_GROUP', (count) => ({ count })],
  ['QUEUE.ACTIONS.TOAST.RETRY_SKIPPED', (count) => ({ count })],
  ['SETTINGS.POLLING_OPTIONS.SECS', (count) => ({ count })],
  ['SETTINGS.POLLING_OPTIONS.MINS', (count) => ({ count })],
  ['SCHEDULERS.TIMELINE.OVERLAP', (count) => ({ count })],
  ['SCHEDULERS.TIMELINE.RUNS_IN_VIEW', (count) => ({ count, total: count })],
  ['SCHEDULERS.TIMELINE.SHOW_ALL', (count) => ({ count, total: count })],
  ['PGBOSS.ACTIONS.AFFECTED', (count) => ({ affected: count, count })],
];

// Adjectives that do not inflect in English, but do in pt-BR, es-ES, fr-FR and da-DK.
const invariantInEnglish = new Set([
  'DASHBOARD.KPI.PAUSED',
  'JOB.FLOW.PROCESSED',
  'JOB.FLOW.UNPROCESSED',
  'JOB.FLOW.FAILED',
  'JOB.FLOW.IGNORED',
]);

describe('i18n plurals', () => {
  it.each([
    ['en-US', 1, '1 attempt started'],
    ['en-US', 2, '2 attempts started'],
    ['pt-BR', 1, '1 tentativa iniciada'],
    ['pt-BR', 2, '2 tentativas iniciadas'],
  ])('%s: JOB.DIAGNOSTICS.ATTEMPTS_STARTED with count %d', (lng, count, expected) => {
    expect(instanceFor(lng).t('JOB.DIAGNOSTICS.ATTEMPTS_STARTED', { count })).toBe(expected);
  });

  it.each([
    ['en-US', 1, '1 millisecond'],
    ['en-US', 2, '2 milliseconds'],
    ['pt-BR', 1, '1 milissegundo'],
    ['pt-BR', 2, '2 milissegundos'],
    ['ru-RU', 3, '3 мс'],
  ])('%s: JOB.DURATION.MILLI_SECS with count %d', (lng, count, expected) => {
    expect(instanceFor(lng).t('JOB.DURATION.MILLI_SECS', { count })).toBe(expected);
  });

  it('pluralizes the job count and the nested queue count independently', () => {
    const en = instanceFor('en-US');
    expect(en.t('QUEUE.ACTIONS.TOAST.RETRY_QUEUES_DONE', { count: 1, queues: 1 })).toBe(
      '1 failed job in 1 queue was sent back to its queue'
    );
    expect(en.t('QUEUE.ACTIONS.TOAST.RETRY_QUEUES_DONE', { count: 5, queues: 2 })).toBe(
      '5 failed jobs in 2 queues were sent back to their queues'
    );

    const pt = instanceFor('pt-BR');
    expect(pt.t('QUEUE.ACTIONS.CONFIRM.RETRY_FAILED_QUEUES', { count: 1, queues: 3 })).toBe(
      'Tem certeza de que deseja tentar novamente 1 tarefa com falha em 3 filas?'
    );

    const ru = instanceFor('ru-RU');
    expect(ru.t('QUEUE.ACTIONS.TOAST.RETRY_QUEUES_PENDING', { count: 2, queues: 1 })).toBe(
      'Повтор 2 неудачных задач в 1 очереди...'
    );
    expect(ru.t('QUEUE.ACTIONS.CONFIRM.RETRY_FAILED_QUEUES', { count: 3, queues: 5 })).toBe(
      'Вы уверены, что хотите повторить 3 неудачные задачи в 5 очередях?'
    );
  });

  it('uses the few and many forms in ru-RU', () => {
    const ru = instanceFor('ru-RU');
    expect(ru.t('SETTINGS.POLLING_OPTIONS.SECS', { count: 1 })).toBe('1 секунда');
    expect(ru.t('SETTINGS.POLLING_OPTIONS.SECS', { count: 3 })).toBe('3 секунды');
    expect(ru.t('SETTINGS.POLLING_OPTIONS.SECS', { count: 10 })).toBe('10 секунд');
  });

  // A key that renders a count must read differently for 1 and for 2 in English, and every
  // locale must resolve it without leaving a raw `{{...}}` or `$t(...)` behind.
  it.each(counted)('%s has singular and plural forms', (key, options) => {
    const en = instanceFor('en-US');
    if (!invariantInEnglish.has(key)) {
      expect(en.t(key, options(1))).not.toBe(en.t(key, options(2)).replace(/2/g, '1'));
    }

    for (const lng of languages) {
      const instance = instanceFor(lng);
      for (const count of [1, 2, 5]) {
        const text = instance.t(key, options(count));
        expect(text).not.toBe(key);
        expect(text).not.toMatch(/\{\{|\$t\(/);
        expect(text).toContain(String(count));
      }
    }
  });
});

describe('Timeline durations', () => {
  const job = (ms: number) =>
    ({
      id: '1',
      name: 'job',
      timestamp: 1_000,
      processedOn: 1_000,
      finishedOn: 1_000 + ms,
      opts: {},
      data: {},
    }) as unknown as AppJob;

  it.each([
    ['en-US', 1, '1 millisecond'],
    ['en-US', 2, '2 milliseconds'],
    ['pt-BR', 1, '1 milissegundo'],
    ['pt-BR', 2, '2 milissegundos'],
  ])('%s renders %d ms as "%s"', (lng, ms, expected) => {
    render(
      <I18nextProvider i18n={instanceFor(lng)}>
        <UIConfigContext.Provider value={{}}>
          <Timeline job={job(ms)} status="completed" />
        </UIConfigContext.Provider>
      </I18nextProvider>
    );
    expect(screen.getByText(expected)).toBeTruthy();
  });
});
