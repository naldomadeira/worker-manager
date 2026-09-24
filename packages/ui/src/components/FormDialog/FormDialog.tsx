import { FormEvent, PropsWithChildren, ReactNode } from 'react';
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
import { cn } from '@/lib/utils';

interface FormDialogProps {
  open: boolean;
  onClose(): void;
  title: string;
  description?: ReactNode;
  /** The id of the form; the footer's submit button targets it. */
  formId: string;
  submitLabel: string;
  onSubmit(evt: FormEvent<HTMLFormElement>): void;
  size?: 'sm' | 'lg';
}

/**
 * A shadcn Dialog wrapping a single form, with a scrollable body and a sticky footer holding
 * the close and submit buttons. Closing (Escape, overlay, close button) calls `onClose`.
 */
export const FormDialog = ({
  open,
  onClose,
  title,
  description,
  formId,
  submitLabel,
  onSubmit,
  size = 'sm',
  children,
}: PropsWithChildren<FormDialogProps>) => {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          'max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 p-0 shadow-popover',
          size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-md'
        )}
      >
        <DialogHeader className="border-b px-5 pt-5 pb-4">
          <DialogTitle className="text-[0.9375rem] font-semibold">{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">{title}</DialogDescription>
          )}
        </DialogHeader>
        <form
          id={formId}
          onSubmit={onSubmit}
          className="min-h-0 overflow-y-auto px-5 py-4 [scrollbar-width:thin]"
        >
          {children}
        </form>
        <DialogFooter className="mx-0 mb-0 px-5 py-3">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t('MODAL.CLOSE_BTN')}
            </Button>
          </DialogClose>
          <Button type="submit" form={formId}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
