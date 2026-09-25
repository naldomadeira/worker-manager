import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { CheckboxField } from '../Form/CheckboxField/CheckboxField';

/** An extra opt-in the confirm can ask for, e.g. forcing an obliterate past its active jobs. */
export interface ConfirmCheckbox {
  label: string;
  description?: string;
  defaultChecked?: boolean;
}

export interface ConfirmResult {
  /** State of the confirm's checkbox, `false` whenever it did not render one. */
  checked: boolean;
}

export interface ConfirmProps {
  open: boolean;
  title: string;
  description: string;
  checkbox?: ConfirmCheckbox;
  onCancel: () => void;
  /** Omitting the result is the same as confirming with the checkbox left unchecked. */
  onConfirm: (result?: ConfirmResult) => void;
}

export const ConfirmModal = ({
  open,
  onConfirm,
  title,
  onCancel,
  description,
  checkbox,
}: ConfirmProps) => (
  <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
    <AlertDialogContent className="sm:max-w-[450px]">
      {/*
       * The body lives in its own component so that the checkbox state is created fresh on
       * every open: the content unmounts on close, which is what resets a checkbox someone
       * ticked and then cancelled.
       */}
      <ConfirmContent
        title={title}
        description={description}
        checkbox={checkbox}
        onConfirm={onConfirm}
      />
    </AlertDialogContent>
  </AlertDialog>
);

const ConfirmContent = ({
  title,
  description,
  checkbox,
  onConfirm,
}: Omit<ConfirmProps, 'open' | 'onCancel'>) => {
  const { t } = useTranslation();
  const [checked, setChecked] = useState(checkbox?.defaultChecked ?? false);

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogMedia className="bg-status-delayed/12 text-status-delayed">
          <TriangleAlert />
        </AlertDialogMedia>
        <AlertDialogTitle className="font-semibold">{title}</AlertDialogTitle>
        {/* Always rendered so the dialog stays described; empty text renders nothing. */}
        <AlertDialogDescription className="whitespace-pre-wrap">
          {description}
        </AlertDialogDescription>
      </AlertDialogHeader>
      {!!checkbox && (
        <div className="animate-in rounded-lg border bg-muted/40 p-3 duration-200 fade-in-0">
          <CheckboxField
            id="confirm-checkbox"
            label={checkbox.label}
            description={checkbox.description}
            checked={checked}
            onCheckedChange={setChecked}
          />
        </div>
      )}
      <AlertDialogFooter>
        <AlertDialogCancel>{t('CONFIRM.CANCEL_BTN')}</AlertDialogCancel>
        <Button type="button" onClick={() => onConfirm({ checked })}>
          {t('CONFIRM.CONFIRM_BTN')}
        </Button>
      </AlertDialogFooter>
    </>
  );
};
