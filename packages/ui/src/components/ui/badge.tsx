import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import * as React from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground [a]:hover:bg-primary/80',
        secondary: 'bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80',
        destructive:
          'bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20',
        outline: 'border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground',
        ghost: 'hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50',
        link: 'text-primary underline-offset-4 hover:underline',
        success: 'bg-status-completed/12 text-status-completed dark:bg-status-completed/20',
        warning: 'bg-status-delayed/12 text-status-delayed dark:bg-status-delayed/20',
        failed: 'bg-status-failed/12 text-status-failed dark:bg-status-failed/20',
        completed: 'bg-status-completed/12 text-status-completed dark:bg-status-completed/20',
        waiting: 'bg-status-waiting/12 text-status-waiting dark:bg-status-waiting/20',
        'waiting-children':
          'bg-status-waiting-children/12 text-status-waiting-children dark:bg-status-waiting-children/20',
        prioritized:
          'bg-status-prioritized/12 text-status-prioritized dark:bg-status-prioritized/20',
        active: 'bg-status-active/12 text-status-active dark:bg-status-active/20',
        delayed: 'bg-status-delayed/12 text-status-delayed dark:bg-status-delayed/20',
        paused: 'bg-status-paused/12 text-status-paused dark:bg-status-paused/20',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

function Badge({
  className,
  variant = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span';

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
