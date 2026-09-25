import type { PgBossJob } from '@worker-manager/api/typings/app';
import type { SendPgBossJobBody } from '@worker-manager/api/typings/requests';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { FormDialog } from '../../../components/FormDialog/FormDialog';
import { JsonEditor } from '../../../components/JsonEditor/JsonEditor';
import { toastManager } from '../../../services/toastManager';
import { usePgBossActions } from '../hooks/usePgBossActions';
import { usePgBossQueues } from '../hooks/usePgBossQueues';

export interface PgBossSendJobModalProps {
  open: boolean;
  onClose(): void;
  queueName: string;
  /** Prefills the form from this job, to send a copy of it. */
  job?: PgBossJob | null;
}

type Options = NonNullable<SendPgBossJobBody['options']>;

const toText = (value: number | string | null | undefined) =>
  value === null || value === undefined ? '' : String(value);

/** An integer typed into a field, or nothing when it is empty. */
const toInteger = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
};

/**
 * Sends a job with the options pg-boss's `send` takes, or a copy of an existing job. Only the
 * basic options are offered; throttling, debouncing and the rest stay in application code.
 */
export const PgBossSendJobModal = ({ open, onClose, queueName, job }: PgBossSendJobModalProps) => {
  const { t } = useTranslation();
  const { queues } = usePgBossQueues();
  const actions = usePgBossActions();
  const [target, setTarget] = useState(queueName);
  const [fields, setFields] = useState({
    priority: toText(job?.priority || null),
    startAfter: '',
    singletonKey: job?.singletonKey ?? '',
    retryLimit: toText(job?.retryLimit),
    retryDelay: toText(job?.retryDelay),
    expireInSeconds: toText(job?.expireInSeconds),
  });
  const [retryBackoff, setRetryBackoff] = useState(job?.retryBackoff ?? false);
  const set = (name: keyof typeof fields) => (evt: React.ChangeEvent<HTMLInputElement>) =>
    setFields((current) => ({ ...current, [name]: evt.target.value }));

  const submit = async (evt: FormEvent<HTMLFormElement>) => {
    evt.preventDefault();
    const form = evt.currentTarget;
    const rawData = (form.elements.namedItem('jobData') as HTMLInputElement | null)?.value ?? '';

    // The editor blanks its field while it has lint errors, so an invalid document arrives empty.
    let data: unknown;
    try {
      data = JSON.parse(rawData);
    } catch {
      toastManager.add({ type: 'error', title: t('ERRORS.INVALID_JSON') });
      return;
    }

    const startAfter = fields.startAfter.trim();
    const options: Options = {
      priority: toInteger(fields.priority),
      startAfter:
        startAfter === '' ? undefined : /^\d+$/.test(startAfter) ? Number(startAfter) : startAfter,
      singletonKey: fields.singletonKey.trim() || undefined,
      retryLimit: toInteger(fields.retryLimit),
      retryDelay: toInteger(fields.retryDelay),
      retryBackoff: retryBackoff || undefined,
      expireInSeconds: toInteger(fields.expireInSeconds),
    };
    const cleaned = Object.fromEntries(
      Object.entries(options).filter(([, value]) => value !== undefined)
    ) as Options;

    if (await actions.sendJob(target, { data, options: cleaned }, !!job)()) {
      onClose();
    }
  };

  const numberField = (
    name: 'priority' | 'retryLimit' | 'retryDelay' | 'expireInSeconds',
    label: string
  ) => (
    <Field>
      <FieldLabel htmlFor={`pgboss-send-${name}`}>{label}</FieldLabel>
      <Input
        id={`pgboss-send-${name}`}
        type="number"
        inputMode="numeric"
        step={1}
        min={name === 'priority' ? undefined : 0}
        value={fields[name]}
        onChange={set(name)}
        placeholder={t('PGBOSS.SEND.QUEUE_DEFAULT')}
        className="font-mono"
      />
    </Field>
  );

  return (
    <FormDialog
      size="lg"
      open={open}
      onClose={onClose}
      title={job ? t('PGBOSS.SEND.DUPLICATE_TITLE') : t('PGBOSS.SEND.TITLE')}
      formId="pgboss-send-job-form"
      submitLabel={t('PGBOSS.SEND.SUBMIT')}
      onSubmit={submit}
    >
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="pgboss-send-queue">{t('PGBOSS.SEND.QUEUE')}</FieldLabel>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger id="pgboss-send-queue" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="max-h-72">
              {(queues ?? [{ name: queueName }]).map((queue) => (
                <SelectItem key={queue.name} value={queue.name}>
                  {queue.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="pgboss-send-data">{t('PGBOSS.SEND.DATA')}</FieldLabel>
          <JsonEditor id="pgboss-send-data" name="jobData" doc={job?.data ?? {}} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {numberField('priority', t('PGBOSS.SEND.PRIORITY'))}
          <Field>
            <FieldLabel htmlFor="pgboss-send-startAfter">{t('PGBOSS.SEND.START_AFTER')}</FieldLabel>
            <Input
              id="pgboss-send-startAfter"
              value={fields.startAfter}
              onChange={set('startAfter')}
              className="font-mono"
            />
            <FieldDescription>{t('PGBOSS.SEND.START_AFTER_HINT')}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="pgboss-send-singletonKey">
              {t('PGBOSS.SEND.SINGLETON_KEY')}
            </FieldLabel>
            <Input
              id="pgboss-send-singletonKey"
              value={fields.singletonKey}
              onChange={set('singletonKey')}
              className="font-mono"
            />
          </Field>
          {numberField('expireInSeconds', t('PGBOSS.SEND.EXPIRE_IN'))}
          {numberField('retryLimit', t('PGBOSS.SEND.RETRY_LIMIT'))}
          {numberField('retryDelay', t('PGBOSS.SEND.RETRY_DELAY'))}
        </div>
        <Field orientation="horizontal">
          <Switch
            id="pgboss-send-retryBackoff"
            checked={retryBackoff}
            onCheckedChange={setRetryBackoff}
          />
          <FieldLabel htmlFor="pgboss-send-retryBackoff">
            {t('PGBOSS.SEND.RETRY_BACKOFF')}
          </FieldLabel>
        </Field>
      </FieldGroup>
    </FormDialog>
  );
};
