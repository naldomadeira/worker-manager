import type { AppQueue } from '@worker-manager/api/typings/app';
import { GaugeIcon } from 'lucide-react';
import { FormEvent, RefObject, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { useQueues } from '../../hooks/useQueues';
import { Modal } from '../Modal/Modal';

export interface ConcurrencyModalProps {
  open: boolean;
  queue: AppQueue;
  finalFocus?: RefObject<HTMLElement | null>;
  onClose(): void;
}

export const ConcurrencyModal = ({ open, onClose, queue, finalFocus }: ConcurrencyModalProps) => {
  const { actions } = useQueues();
  const { t } = useTranslation();
  const [value, setValue] = useState<string>(
    queue.globalConcurrency != null ? String(queue.globalConcurrency) : ''
  );

  const handleSubmit = async (evt: FormEvent) => {
    evt.preventDefault();
    const concurrency = value === '' ? 0 : parseInt(value, 10);
    if (isNaN(concurrency) || concurrency < 0) return;
    await actions.setGlobalConcurrency(queue.name, concurrency)();
    onClose();
  };

  return (
    <Modal
      width="small"
      open={open}
      onClose={onClose}
      title={t('CONCURRENCY.TITLE')}
      finalFocus={finalFocus}
      actionButton={
        <Button type="submit" form="concurrency-form">
          {t('CONCURRENCY.SAVE')}
        </Button>
      }
    >
      <form id="concurrency-form" onSubmit={handleSubmit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="concurrency">{t('CONCURRENCY.CONCURRENCY')}</FieldLabel>
            <InputGroup>
              <InputGroupAddon>
                <GaugeIcon aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                id="concurrency"
                name="concurrency"
                type="number"
                inputMode="numeric"
                min={0}
                autoFocus
                className="font-mono tabular-nums"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </InputGroup>
            <FieldDescription>{t('CONCURRENCY.DESCRIPTION')}</FieldDescription>
          </Field>
        </FieldGroup>
      </form>
    </Modal>
  );
};
