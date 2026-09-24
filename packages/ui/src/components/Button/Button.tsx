import type { VariantProps } from 'class-variance-authority';
import React from 'react';
import { Button as UIButton, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type UIVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
type UISize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

export interface ButtonProps extends React.ComponentProps<'button'> {
  /** Highlights the button as the selected one of a group (tabs, toggles). */
  isActive?: boolean;
  /** Legacy look: `default` is a quiet ghost button, `basic` outlined, `primary` filled. */
  theme?: 'basic' | 'primary' | 'default';
  /** Square padding, for icon-only buttons and dense toolbars. */
  compact?: boolean;
  /** Any shadcn variant; wins over `theme` when both are given. */
  variant?: UIVariant;
  /** Any shadcn size; wins over `compact` when both are given. */
  size?: UISize;
  /** Renders the single child with the button's styling instead of a `<button>`. */
  asChild?: boolean;
}

const themeToVariant: Record<NonNullable<ButtonProps['theme']>, UIVariant> = {
  default: 'ghost',
  basic: 'outline',
  primary: 'default',
};

export const Button = React.forwardRef<HTMLElement, ButtonProps>(
  (
    {
      children,
      className,
      isActive = false,
      theme = 'default',
      compact,
      variant,
      size,
      asChild,
      type = 'button',
      ...rest
    },
    forwardedRef
  ) => {
    const resolvedVariant = variant ?? themeToVariant[theme];

    return (
      <UIButton
        ref={forwardedRef as React.Ref<HTMLButtonElement>}
        type={asChild ? undefined : type}
        asChild={asChild}
        variant={resolvedVariant}
        size={size ?? (compact ? 'sm' : 'default')}
        data-legacy-button=""
        data-active={isActive || undefined}
        className={cn(
          compact && !size && 'min-w-7 px-1.5',
          resolvedVariant === 'ghost' &&
            'text-foreground/80 hover:bg-state-hover hover:text-foreground [&_svg]:text-muted-foreground hover:[&_svg]:text-foreground',
          isActive &&
            'bg-state-selected text-state-selected-foreground hover:bg-state-selected-hover hover:text-state-selected-foreground [&_svg]:text-state-selected-foreground hover:[&_svg]:text-state-selected-foreground',
          className
        )}
        {...rest}
      >
        {children}
      </UIButton>
    );
  }
);

Button.displayName = 'Button';
