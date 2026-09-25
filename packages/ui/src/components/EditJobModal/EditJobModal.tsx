import type { AppJob } from '@worker-manager/api/typings/app';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { FormDialog } from '../FormDialog/FormDialog';

const PRIORITY_LIMIT = 2 ** 21 - 1;

function toLocalInputValue(ms: number): string {
  const local = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export interface EditJobModalProps {
  open: boolean;
  job: AppJob;
  field: 'delay' | 'priority';
  onClose(): void;
  /** Resolves `true` once the change is saved; the dialog stays open otherwise. */
  onSubmit(value: number): Promise<boolean>;
}

export const EditJobModal = ({ open, job, field, onClose, onSubmit }: EditJobModalProps) => {
  const { t } = useTranslation();
  const runsAt = job.timestamp + (job.delay || 0);

  const [value, setValue] = useState(() =>
    field === 'delay' ? toLocalInputValue(runsAt) : String(job.priority ?? 0)
  );

  const handleSubmit = async (evt: FormEvent) => {
    evt.preventDefault();

    let saved: boolean;
    if (field === 'delay') {
      const runAt = new Date(value).getTime();
      if (Number.isNaN(runAt)) return;
      saved = await onSubmit(runAt);
    } else {
      const priority = parseInt(value, 10);
      if (!Number.isInteger(priority) || priority < 0 || priority > PRIORITY_LIMIT) return;
      saved = await onSubmit(priority);
    }

    if (saved) {
      onClose();
    }
  };

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t(field === 'delay' ? 'JOB.EDIT.DELAY_TITLE' : 'JOB.EDIT.PRIORITY_TITLE')}
      description={t(field === 'delay' ? 'JOB.EDIT.DELAY_HINT' : 'JOB.EDIT.PRIORITY_HINT')}
      formId="edit-job-form"
      submitLabel={t('JOB.EDIT.SAVE')}
      onSubmit={handleSubmit}
    >
      {field === 'delay' ? (
        <Field>
          <FieldLabel htmlFor="edit-job-run-at">{t('JOB.EDIT.RUN_AT')}</FieldLabel>
          <Input
            id="edit-job-run-at"
            name="runAt"
            type="datetime-local"
            autoFocus
            className="font-mono tabular-nums"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
      ) : (
        <Field>
          <FieldLabel htmlFor="edit-job-priority">{t('JOB.EDIT.PRIORITY')}</FieldLabel>
          <Input
            id="edit-job-priority"
            name="priority"
            type="number"
            min={0}
            max={PRIORITY_LIMIT}
            autoFocus
            className="font-mono tabular-nums"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
      )}
    </FormDialog>
  );
};
