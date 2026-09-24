import React, { useId } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '../Field/Field';

type CheckboxProps = React.ComponentProps<typeof Checkbox>;

interface CheckboxFieldProps extends Omit<CheckboxProps, 'checked' | 'onCheckedChange'> {
  label?: string;
  id?: string;
  description?: string;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export const CheckboxField = ({
  label,
  id,
  description,
  onCheckedChange,
  className,
  ...checkboxProps
}: CheckboxFieldProps) => {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const descriptionId = description ? `${controlId}-description` : undefined;

  return (
    <Field
      label={label}
      inline={true}
      description={description}
      htmlFor={controlId}
      descriptionId={descriptionId}
      className={className}
    >
      <Checkbox
        id={controlId}
        aria-describedby={descriptionId}
        className="mt-0.5 [&_svg]:animate-in [&_svg]:duration-150 [&_svg]:zoom-in-50"
        {...checkboxProps}
        onCheckedChange={(checked) => onCheckedChange?.(checked === true)}
      />
    </Field>
  );
};
