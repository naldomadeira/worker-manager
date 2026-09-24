import { PropsWithChildren } from 'react';
import {
  FieldContent,
  FieldDescription,
  FieldLabel,
  Field as UIField,
} from '@/components/ui/field';
import { cn } from '@/lib/utils';

export interface FieldProps {
  label?: string;
  /** Control first, label beside it (checkboxes, switches). */
  inline?: boolean;
  description?: string;
  /** Id of the control the label names. */
  htmlFor?: string;
  /** Id given to the description, for the control's `aria-describedby`. */
  descriptionId?: string;
  className?: string;
}

// Consecutive fields are spaced apart, a lone field (e.g. a toolbar filter) adds no margin.
const fieldSpacing = '[[data-slot=field]+&]:mt-4';

export const Field = ({
  label,
  inline,
  description,
  htmlFor,
  descriptionId,
  className,
  children,
}: PropsWithChildren<FieldProps>) => {
  const labelElement = !!label && (
    <FieldLabel htmlFor={htmlFor} className={cn(!inline && 'text-muted-foreground')}>
      {label}
    </FieldLabel>
  );
  const descriptionElement = !!description && (
    <FieldDescription id={descriptionId} className="text-xs">
      {description}
    </FieldDescription>
  );

  if (inline) {
    return (
      <UIField
        orientation="horizontal"
        className={cn(fieldSpacing, 'items-start gap-3', className)}
      >
        {children}
        {(labelElement || descriptionElement) && (
          <FieldContent className="gap-1">
            {labelElement}
            {descriptionElement}
          </FieldContent>
        )}
      </UIField>
    );
  }

  return (
    <UIField className={cn(fieldSpacing, 'gap-1.5', className)}>
      {labelElement}
      {children}
      {descriptionElement}
    </UIField>
  );
};
