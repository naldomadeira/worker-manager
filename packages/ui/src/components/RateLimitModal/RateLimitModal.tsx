import type { AppQueue } from '@worker-manager/api/typings/app';
import { TimerIcon } from 'lucide-react';
import { FormEvent, RefObject, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useQueueRateLimit } from '../../hooks/useQueueRateLimit';
import { useQueues } from '../../hooks/useQueues';
import { Modal } from '../Modal/Modal';

export interface RateLimitModalProps {
  open: boolean;
  queue: AppQueue;
  finalFocus?: RefObject<HTMLElement | null>;
  onClose(): void;
}

export const RateLimitModal = ({ open, onClose, queue, finalFocus }: RateLimitModalProps) => {
  const { actions } = useQueues();
  const { t } = useTranslation();
  const { rateLimit, loading } = useQueueRateLimit(queue.name, open);

  const [max, setMax] = useState('');
  const [duration, setDuration] = useState('');

  useEffect(() => {
    setMax(rateLimit ? String(rateLimit.max) : '');
    setDuration(rateLimit ? String(rateLimit.duration) : '');
  }, [rateLimit, open]);

  const handleSubmit = async (evt: FormEvent) => {
    evt.preventDefault();

    if (max === '' && duration === '') {
      await actions.setQueueRateLimit(queue.name, null)();
      onClose();
      return;
    }

    const parsedMax = parseInt(max, 10);
    const parsedDuration = parseInt(duration, 10);

    if (!Number.isInteger(parsedMax) || !Number.isInteger(parsedDuration)) return;
    if (parsedMax <= 0 || parsedDuration <= 0) return;

    await actions.setQueueRateLimit(queue.name, {
      max: parsedMax,
      duration: parsedDuration,
    })();
    onClose();
  };

  return (
    <Modal
      width="small"
      open={open}
      onClose={onClose}
      title={t('RATE_LIMIT.TITLE')}
      finalFocus={finalFocus}
      actionButton={
        <Button type="submit" form="rate-limit-form" disabled={loading}>
          {t('RATE_LIMIT.SAVE')}
        </Button>
      }
    >
      <form id="rate-limit-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        <p className="m-0 text-sm leading-relaxed text-muted-foreground">
          {t('RATE_LIMIT.DESCRIPTION')}
        </p>

        {queue.activeRateLimitTtl > 0 && (
          <div
            role="status"
            className="flex items-center gap-3 rounded-lg border border-status-delayed/30 bg-status-delayed/10 px-3 py-2 text-sm text-status-delayed animate-in fade-in-0 slide-in-from-top-1"
          >
            <TimerIcon aria-hidden="true" className="size-4 shrink-0" />
            <span className="flex-1 font-medium">
              {t('RATE_LIMIT.ACTIVE_FOR', {
                seconds: Math.ceil(queue.activeRateLimitTtl / 1000),
              })}
            </span>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={async () => {
                await actions.releaseQueueRateLimit(queue.name)();
                onClose();
              }}
            >
              {t('RATE_LIMIT.RELEASE')}
            </Button>
          </div>
        )}

        <FieldGroup className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="rate-limit-max">{t('RATE_LIMIT.MAX')}</FieldLabel>
            <Input
              id="rate-limit-max"
              name="max"
              type="number"
              inputMode="numeric"
              autoFocus
              min={1}
              className="font-mono tabular-nums"
              value={max}
              onChange={(e) => setMax(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="rate-limit-duration">{t('RATE_LIMIT.DURATION')}</FieldLabel>
            <Input
              id="rate-limit-duration"
              name="duration"
              type="number"
              inputMode="numeric"
              min={1}
              className="font-mono tabular-nums"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </Field>
        </FieldGroup>
        {rateLimit && (
          <FieldDescription className="font-mono text-xs">
            {t('RATE_LIMIT.VALUE', { max: rateLimit.max, duration: rateLimit.duration })}
          </FieldDescription>
        )}
      </form>
    </Modal>
  );
};
