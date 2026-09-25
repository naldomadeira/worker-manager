import type { PgBossSchedule } from '@worker-manager/api/typings/app';
import type { UpsertPgBossScheduleBody } from '@worker-manager/api/typings/requests';
import { CalendarClockIcon, Loader2Icon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormDialog } from '../../../components/FormDialog/FormDialog';
import { JsonEditor } from '../../../components/JsonEditor/JsonEditor';
import { useUIConfig } from '../../../hooks/useUIConfig';
import { toastManager } from '../../../services/toastManager';
import { translateMessage } from '../../../utils/translateMessage';
import { isErrorBody } from '../hooks/query';
import { usePgBossActions } from '../hooks/usePgBossActions';
import { usePgBossApi } from '../hooks/usePgBossApi';
import { usePgBossQueues } from '../hooks/usePgBossQueues';
import { formatIso } from '../utils/format';

const MISSED_DEFAULT = 'default';

export interface PgBossScheduleEditModalProps {
  open: boolean;
  onClose(): void;
  /** The schedule to edit; without one the form creates a schedule. */
  schedule?: PgBossSchedule | null;
  /** The queue a new schedule starts on. */
  queueName?: string;
  /** Whether the pg-boss in use can work out the next runs. */
  canPreview: boolean;
}

/**
 * Creates or replaces a schedule. pg-boss keys a schedule by queue and key, so both are fixed
 * while editing; changing them is a new schedule.
 */
export const PgBossScheduleEditModal = ({
  open,
  onClose,
  schedule,
  queueName,
  canPreview,
}: PgBossScheduleEditModalProps) => {
  const { t, i18n } = useTranslation();
  const api = usePgBossApi();
  const actions = usePgBossActions();
  const { queues } = usePgBossQueues();
  const dateFormats = useUIConfig()?.dateFormats;
  const editing = !!schedule;
  const [target, setTarget] = useState(schedule?.queueName ?? queueName ?? queues?.[0]?.name ?? '');
  const [key, setKey] = useState(schedule?.key ?? '');
  const [expression, setExpression] = useState(schedule?.expression ?? '');
  const [tz, setTz] = useState(schedule?.timezone ?? '');
  const initialMissed = schedule?.options?.missed;
  const [missed, setMissed] = useState<string>(
    initialMissed === 'skip' || initialMissed === 'once' ? initialMissed : MISSED_DEFAULT
  );
  const [preview, setPreview] = useState<{ runs: string[] } | { error: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const runPreview = async () => {
    if (!expression.trim()) return;
    setPreviewing(true);
    try {
      const result = await api.previewSchedule({
        expression: expression.trim(),
        tz: tz.trim() || undefined,
      });
      setPreview(isErrorBody(result) ? { error: translateMessage(result.error) } : result);
    } finally {
      setPreviewing(false);
    }
  };

  const submit = async (evt: FormEvent<HTMLFormElement>) => {
    evt.preventDefault();
    const form = evt.currentTarget;
    const read = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? '';

    let data: unknown;
    let options: Record<string, unknown>;
    try {
      data = JSON.parse(read('scheduleData'));
      options = JSON.parse(read('scheduleOptions'));
    } catch {
      toastManager.add({ type: 'error', title: t('ERRORS.INVALID_JSON') });
      return;
    }
    // `missed` is its own field in the form; the options document never carries it.
    delete options.missed;

    const body: UpsertPgBossScheduleBody = {
      key,
      cron: expression.trim(),
      tz: tz.trim() || undefined,
      data,
      options,
      missed: missed === MISSED_DEFAULT ? undefined : (missed as 'skip' | 'once'),
    };

    if (await actions.upsertSchedule(target, body)()) {
      onClose();
    }
  };

  const templateOptions = Object.fromEntries(
    Object.entries(schedule?.options ?? {}).filter(([name]) => name !== 'missed')
  );

  return (
    <FormDialog
      size="lg"
      open={open}
      onClose={onClose}
      title={editing ? t('PGBOSS.SCHEDULES.EDIT') : t('PGBOSS.SCHEDULES.CREATE')}
      formId="pgboss-schedule-form"
      submitLabel={t('PGBOSS.SCHEDULES.SAVE')}
      onSubmit={submit}
    >
      <FieldGroup className="gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="pgboss-schedule-queue">{t('PGBOSS.SCHEDULES.QUEUE')}</FieldLabel>
            <Select value={target} onValueChange={setTarget} disabled={editing}>
              <SelectTrigger id="pgboss-schedule-queue" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="max-h-72">
                {(queues ?? []).map((queue) => (
                  <SelectItem key={queue.name} value={queue.name}>
                    {queue.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="pgboss-schedule-key">{t('PGBOSS.SCHEDULES.KEY')}</FieldLabel>
            <Input
              id="pgboss-schedule-key"
              value={key}
              onChange={(evt) => setKey(evt.target.value)}
              disabled={editing}
              placeholder={t('PGBOSS.SCHEDULES.DEFAULT_KEY')}
              className="font-mono"
            />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="pgboss-schedule-expression">
              {t('PGBOSS.SCHEDULES.EXPRESSION')}
            </FieldLabel>
            <div className="flex gap-2">
              <Input
                id="pgboss-schedule-expression"
                value={expression}
                onChange={(evt) => {
                  setExpression(evt.target.value);
                  setPreview(null);
                }}
                required
                placeholder="0 * * * *"
                className="font-mono"
              />
              {canPreview && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={runPreview}
                  disabled={previewing || !expression.trim()}
                >
                  {previewing ? (
                    <Loader2Icon data-icon="inline-start" className="animate-spin" />
                  ) : (
                    <CalendarClockIcon data-icon="inline-start" />
                  )}
                  {t('PGBOSS.SCHEDULES.PREVIEW')}
                </Button>
              )}
            </div>
            <FieldDescription>
              {canPreview
                ? t('PGBOSS.SCHEDULES.EXPRESSION_HINT')
                : t('PGBOSS.SCHEDULES.PREVIEW_UNAVAILABLE')}
            </FieldDescription>
            {preview && (
              <div
                role="status"
                className="rounded-lg border bg-muted/30 px-3 py-2 text-xs animate-fade-in-up"
              >
                {'error' in preview ? (
                  <span className="text-destructive">{preview.error}</span>
                ) : (
                  <>
                    <span className="mb-1 block font-medium text-muted-foreground">
                      {t('PGBOSS.SCHEDULES.NEXT_RUNS')}
                    </span>
                    <ol className="m-0 flex list-none flex-col gap-0.5 p-0 font-mono tabular-nums">
                      {preview.runs.map((run) => (
                        <li key={run}>{formatIso(run, i18n.language, dateFormats)}</li>
                      ))}
                    </ol>
                  </>
                )}
              </div>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor="pgboss-schedule-tz">{t('PGBOSS.SCHEDULES.TIMEZONE')}</FieldLabel>
            <Input
              id="pgboss-schedule-tz"
              value={tz}
              onChange={(evt) => {
                setTz(evt.target.value);
                setPreview(null);
              }}
              placeholder="UTC"
              className="font-mono"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="pgboss-schedule-missed">{t('PGBOSS.SCHEDULES.MISSED')}</FieldLabel>
            <Select value={missed} onValueChange={setMissed}>
              <SelectTrigger id="pgboss-schedule-missed" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value={MISSED_DEFAULT}>
                  {t('PGBOSS.SCHEDULES.MISSED_DEFAULT')}
                </SelectItem>
                <SelectItem value="skip">{t('PGBOSS.SCHEDULES.MISSED_SKIP')}</SelectItem>
                <SelectItem value="once">{t('PGBOSS.SCHEDULES.MISSED_ONCE')}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="pgboss-schedule-data">{t('PGBOSS.SCHEDULES.DATA')}</FieldLabel>
          <JsonEditor id="pgboss-schedule-data" name="scheduleData" doc={schedule?.data ?? {}} />
        </Field>
        <Field>
          <FieldLabel htmlFor="pgboss-schedule-options">{t('PGBOSS.SCHEDULES.OPTIONS')}</FieldLabel>
          <JsonEditor id="pgboss-schedule-options" name="scheduleOptions" doc={templateOptions} />
        </Field>
      </FieldGroup>
    </FormDialog>
  );
};
