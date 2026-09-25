import type { AppJob, AppQueue } from '@worker-manager/api/typings/app';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useActiveQueue } from '../../hooks/useActiveQueue';
import { useQueueJobDataSchema } from '../../hooks/useQueueJobDataSchema';
import { useQueues } from '../../hooks/useQueues';
import bullJobOptionsSchema from '../../schemas/bull/jobOptions.json';
import bullMQJobOptionsSchema from '../../schemas/bullmq/jobOptions.json';
import { toastManager } from '../../services/toastManager';
import { jobDataFromSchema } from '../../utils/jobDataFromSchema';
import { FormDialog } from '../FormDialog/FormDialog';
import { JsonEditor } from '../JsonEditor/JsonEditor';

export interface AddJobModalProps {
  open: boolean;
  job?: AppJob | null;
  queue?: AppQueue | null;
  onClose(): void;
}

const jobOptionsSchema = {
  bull: bullJobOptionsSchema,
  bullmq: bullMQJobOptionsSchema,
} as const;

export const AddJobModal = ({ open, onClose, job, queue: queueProp }: AddJobModalProps) => {
  const { queues, actions } = useQueues();
  const activeQueue = useActiveQueue();
  const effectiveQueue = queueProp ?? activeQueue;
  const [selectedQueue, setSelectedQueue] = useState<AppQueue | null>(effectiveQueue);
  const { t } = useTranslation();
  const { jobDataSchema, loading: jobDataSchemaLoading } = useQueueJobDataSchema(
    selectedQueue?.name ?? null,
    open
  );

  if (!queues || !effectiveQueue || !selectedQueue) {
    return null;
  }

  const addJob = async (evt: FormEvent) => {
    evt.preventDefault();
    const form = evt.target as HTMLFormElement;
    const formData = Object.fromEntries(
      Array.from(form.elements)
        .filter((input: any) => input.name)
        .map((input: any) => [input.name, input.value])
    );

    // The editor blanks its field while it has lint errors, so an invalid document arrives as
    // an empty string here rather than as a parse error the user can see.
    try {
      formData.jobData = JSON.parse(formData.jobData);
      formData.jobOptions = JSON.parse(formData.jobOptions);
    } catch {
      toastManager.add({ type: 'error', title: t('ERRORS.INVALID_JSON') });
      return;
    }

    await actions.addJob(
      formData.queueName,
      formData.jobName || '__default__',
      formData.jobData,
      formData.jobOptions
    )();
    onClose();
  };

  return (
    <FormDialog
      size="lg"
      open={open}
      onClose={onClose}
      title={t('ADD_JOB.TITLE', { context: job ? 'duplicate' : undefined })}
      formId="add-job-form"
      submitLabel={t(`ADD_JOB.${job ? 'DUPLICATE' : 'ADD'}`)}
      onSubmit={addJob}
    >
      <FieldGroup className="gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="queue-name">{t('ADD_JOB.QUEUE_NAME')}</FieldLabel>
            <Select
              value={selectedQueue.name || ''}
              onValueChange={(value) => setSelectedQueue(queues.find((q) => q.name === value)!)}
            >
              <SelectTrigger id="queue-name" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="max-h-72">
                {(queues || []).map((queue) => (
                  <SelectItem key={queue.name} value={queue.name}>
                    {queue.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="queueName" value={selectedQueue.name || ''} />
          </Field>
          <Field>
            <FieldLabel htmlFor="job-name">{t('ADD_JOB.JOB_NAME')}</FieldLabel>
            <Input
              id="job-name"
              name="jobName"
              defaultValue={job?.name}
              placeholder="__default__"
              className="font-mono"
            />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="job-data">{t('ADD_JOB.JOB_DATA')}</FieldLabel>
          <JsonEditor
            key={`job-data-${selectedQueue.name}-${jobDataSchemaLoading ? 'loading' : 'ready'}`}
            id="job-data"
            name="jobData"
            schema={jobDataSchema ?? undefined}
            doc={job?.data ?? jobDataFromSchema(jobDataSchema ?? undefined) ?? {}}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="job-options">{t('ADD_JOB.JOB_OPTIONS')}</FieldLabel>
          <JsonEditor
            id="job-options"
            name="jobOptions"
            schema={jobOptionsSchema[selectedQueue.type]}
            doc={job?.opts || {}}
          />
        </Field>
      </FieldGroup>
    </FormDialog>
  );
};
