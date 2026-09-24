import type { AppJob } from '@worker-manager/api/typings/app';
import { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, FieldLabel } from '@/components/ui/field';
import { useActiveQueue } from '../../hooks/useActiveQueue';
import { useJob } from '../../hooks/useJob';
import { useQueues } from '../../hooks/useQueues';
import { FormDialog } from '../FormDialog/FormDialog';
import { JsonEditor } from '../JsonEditor/JsonEditor';

export interface UpdateJobModalProps {
  open: boolean;

  job: AppJob;

  onClose(): void;
}

export const UpdateJobDataModal = ({ open, onClose, job }: UpdateJobModalProps) => {
  const { queues } = useQueues();
  const { actions: jobActions } = useJob();
  const activeQueue = useActiveQueue();
  const { t } = useTranslation();

  if (!queues || !activeQueue) {
    return null;
  }

  const updateJobData = async (evt: FormEvent) => {
    evt.preventDefault();
    const form = evt.target as HTMLFormElement;
    const formData = Object.fromEntries(
      Array.from(form.elements)
        .filter((input: any) => input.name)
        .map((input: any) => [input.name, input.value])
    );

    try {
      formData.jobData = JSON.parse(formData.jobData);

      await jobActions.updateJobData(activeQueue.name, job, formData)();
      onClose();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <FormDialog
      size="lg"
      open={open}
      onClose={onClose}
      title={t('UPDATE_JOB_DATA.TITLE')}
      formId="edit-job-data-form"
      submitLabel={t('UPDATE_JOB_DATA.UPDATE')}
      onSubmit={updateJobData}
    >
      <Field>
        <FieldLabel htmlFor="job-data">{t('UPDATE_JOB_DATA.JOB_DATA')}</FieldLabel>
        <JsonEditor doc={job?.data || {}} id="job-data" name="jobData" />
      </Field>
    </FormDialog>
  );
};
