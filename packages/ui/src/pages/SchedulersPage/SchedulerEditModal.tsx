import type { AppJobScheduler, JobSchedulerRepeatOptions } from '@worker-manager/api/typings/app';
import { CalendarClock, Info, Loader2 } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { formatInterval } from './schedule';

type ScheduleKind = 'pattern' | 'every';

export interface SchedulerEditModalProps {
  open: boolean;
  scheduler: AppJobScheduler;
  onClose(): void;
  /** Resolves to whether the schedule was accepted. */
  onSubmit(repeat: JobSchedulerRepeatOptions): Promise<boolean>;
}

const toDateTimeLocal = (ts?: number): string => {
  if (!ts) {
    return '';
  }
  const date = new Date(ts - new Date(ts).getTimezoneOffset() * 60 * 1000);
  return date.toISOString().slice(0, 16);
};

export const SchedulerEditModal = ({
  open,
  scheduler,
  onClose,
  onSubmit,
}: SchedulerEditModalProps) => {
  const { t } = useTranslation();
  const [kind, setKind] = useState<ScheduleKind>(scheduler.every ? 'every' : 'pattern');
  const [pattern, setPattern] = useState(scheduler.pattern ?? '');
  const [every, setEvery] = useState(scheduler.every ? String(scheduler.every) : '');
  const [tz, setTz] = useState(scheduler.tz ?? '');
  const [limit, setLimit] = useState(scheduler.limit ? String(scheduler.limit) : '');
  const [endDate, setEndDate] = useState(toDateTimeLocal(scheduler.endDate));
  const [submitting, setSubmitting] = useState(false);

  const everyMs = Number(every);
  const everyPreview =
    every && Number.isFinite(everyMs) && everyMs > 0
      ? t('SCHEDULERS.EVERY', { interval: formatInterval(everyMs, t) })
      : null;

  const handleSubmit = async (evt: FormEvent) => {
    evt.preventDefault();

    const repeat: JobSchedulerRepeatOptions = {
      ...(kind === 'pattern' ? { pattern: pattern.trim() } : { every: Number(every) }),
      ...(kind === 'pattern' && tz.trim() ? { tz: tz.trim() } : {}),
      ...(limit ? { limit: Number(limit) } : {}),
      ...(endDate ? { endDate: new Date(endDate).getTime() } : {}),
    };

    setSubmitting(true);
    try {
      // A schedule the server refuses leaves the form open on what was typed, so it can be fixed
      // rather than retyped.
      if (await onSubmit(repeat)) {
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="gap-0 p-0 sm:max-w-md">
        <form id="scheduler-form" onSubmit={handleSubmit} className="flex flex-col">
          <DialogHeader className="gap-3 p-5 pb-4">
            <div className="flex items-center gap-3 pr-8">
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15">
                <CalendarClock className="size-4.5" aria-hidden="true" />
              </span>
              <DialogTitle className="text-base leading-snug font-semibold break-all">
                {t('SCHEDULERS.EDIT.TITLE', { id: scheduler.id })}
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs leading-relaxed">
              {t('SCHEDULERS.EDIT.DESCRIPTION')}
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="gap-4 px-5 pb-5">
            <Field>
              <FieldLabel id="scheduler-kind-label">{t('SCHEDULERS.EDIT.KIND')}</FieldLabel>
              <ToggleGroup
                id="scheduler-kind"
                type="single"
                variant="outline"
                spacing={0}
                aria-labelledby="scheduler-kind-label"
                value={kind}
                onValueChange={(value) => value && setKind(value as ScheduleKind)}
                className="w-full"
              >
                <ToggleGroupItem
                  value="pattern"
                  className="flex-1 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground"
                >
                  {t('SCHEDULERS.EDIT.KIND_PATTERN')}
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="every"
                  className="flex-1 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground"
                >
                  {t('SCHEDULERS.EDIT.KIND_EVERY')}
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>

            {kind === 'pattern' ? (
              <div
                key="pattern"
                className="grid gap-4 animate-in duration-200 fade-in-0 slide-in-from-top-1 sm:grid-cols-[3fr_2fr]"
              >
                <Field>
                  <FieldLabel htmlFor="scheduler-pattern">
                    {t('SCHEDULERS.EDIT.PATTERN')}
                  </FieldLabel>
                  <Input
                    id="scheduler-pattern"
                    name="pattern"
                    className="font-mono"
                    value={pattern}
                    placeholder="0 3 * * *"
                    onChange={(e) => setPattern(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="scheduler-tz">{t('SCHEDULERS.EDIT.TZ')}</FieldLabel>
                  <Input
                    id="scheduler-tz"
                    name="tz"
                    value={tz}
                    placeholder="Europe/Warsaw"
                    onChange={(e) => setTz(e.target.value)}
                  />
                </Field>
              </div>
            ) : (
              <Field key="every" className="animate-in duration-200 fade-in-0 slide-in-from-top-1">
                <FieldLabel htmlFor="scheduler-every">{t('SCHEDULERS.EDIT.EVERY')}</FieldLabel>
                <Input
                  id="scheduler-every"
                  name="every"
                  type="number"
                  className="font-mono"
                  min={1}
                  value={every}
                  onChange={(e) => setEvery(e.target.value)}
                />
                {everyPreview && <FieldDescription>{everyPreview}</FieldDescription>}
              </Field>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="scheduler-limit">{t('SCHEDULERS.EDIT.LIMIT')}</FieldLabel>
                <Input
                  id="scheduler-limit"
                  name="limit"
                  type="number"
                  min={1}
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="scheduler-end-date">
                  {t('SCHEDULERS.EDIT.END_DATE')}
                </FieldLabel>
                <Input
                  id="scheduler-end-date"
                  name="endDate"
                  type="datetime-local"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </Field>
            </div>

            <p className="m-0 flex gap-2 rounded-lg border border-status-waiting/25 bg-status-waiting/8 p-3 text-xs leading-relaxed text-muted-foreground">
              <Info className="mt-px size-3.5 shrink-0 text-status-waiting" aria-hidden="true" />
              {t('SCHEDULERS.EDIT.OVERWRITE_NOTE')}
            </p>
          </FieldGroup>

          <DialogFooter className="mx-0 mb-0">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('CONFIRM.CANCEL_BTN')}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="animate-spin" aria-hidden="true" />}
              {t('SCHEDULERS.EDIT.SAVE')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
