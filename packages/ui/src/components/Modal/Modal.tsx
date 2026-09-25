import React, { PropsWithChildren } from 'react';
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

export interface ModalProps {
  open: boolean;
  title?: string;
  width?: 'small' | 'medium' | 'wide';
  /** Rendered in the sticky footer, to the right of the close button. */
  actionButton?: React.ReactNode;
  /** Receives focus when the modal closes, instead of the element that opened it. */
  finalFocus?: React.RefObject<HTMLElement | null>;
  className?: string;
  onClose(): void;
}

const widths: Record<NonNullable<ModalProps['width']>, string> = {
  small: 'sm:max-w-[550px]',
  medium: 'sm:max-w-[650px]',
  wide: 'sm:max-w-[850px]',
};

/**
 * Modal dialog with a fixed header and footer around a scrolling body, so long forms keep their
 * submit button in reach. Zooms and fades in over a blurred backdrop.
 */
export const Modal = ({
  open,
  title,
  onClose,
  children,
  width,
  actionButton,
  finalFocus,
  className,
}: PropsWithChildren<ModalProps>) => {
  const { t } = useTranslation();

  return (
    <Dialog open={open} modal onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          if (finalFocus?.current) {
            event.preventDefault();
            finalFocus.current.focus();
          }
        }}
        className={cn(
          'flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0',
          widths[width || 'small'],
          className
        )}
      >
        <DialogHeader className={cn('shrink-0 px-5 pt-5', !title && 'sr-only')}>
          <DialogTitle className="text-lg leading-tight font-semibold tracking-tight">
            {title}
          </DialogTitle>
        </DialogHeader>
        <DialogDescription asChild>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm text-foreground">
            {children}
          </div>
        </DialogDescription>
        <DialogFooter className="m-0 shrink-0 rounded-b-xl px-5 py-3.5">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t('MODAL.CLOSE_BTN')}
            </Button>
          </DialogClose>
          {actionButton}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
