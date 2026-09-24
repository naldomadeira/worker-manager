import { useTranslation } from 'react-i18next';
import { Toaster as UIToaster } from '@/components/ui/sonner';

/**
 * The app-wide toast outlet. Toasts are raised imperatively through `toastManager`
 * (services/toastManager.ts) and rendered here by sonner, stacked bottom right with swipe to
 * dismiss and animated enter/exit.
 */
export const Toaster = () => {
  const { t } = useTranslation();

  return (
    <UIToaster
      position="bottom-right"
      closeButton
      visibleToasts={5}
      gap={8}
      containerAriaLabel={t('TOAST.REGION_LABEL')}
      toastOptions={{
        closeButtonAriaLabel: t('MODAL.CLOSE_BTN'),
        classNames: {
          toast:
            'cn-toast group/toast !items-start !gap-2.5 !rounded-xl !border-border !bg-popover !text-popover-foreground !shadow-popover',
          title: '!font-medium !leading-snug',
          description: '!text-muted-foreground !leading-snug [overflow-wrap:anywhere]',
          icon: '!mt-0.5',
          success: '[&_[data-icon]]:!text-status-completed',
          error:
            '!border-status-failed/30 [&_[data-icon]]:!text-status-failed before:absolute before:inset-y-3 before:left-0 before:w-0.5 before:rounded-full before:bg-status-failed',
          warning: '[&_[data-icon]]:!text-status-delayed',
          info: '[&_[data-icon]]:!text-status-active',
          loading: '[&_[data-icon]]:!text-muted-foreground',
          closeButton:
            '!border-border !bg-popover !text-muted-foreground hover:!text-foreground hover:!bg-muted',
        },
      }}
    />
  );
};
