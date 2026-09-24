import { InputHTMLAttributes, useId } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Field } from '../Field/Field';

interface InputFieldProps extends InputHTMLAttributes<any> {
  label?: string;
  description?: string;
}

export const InputField = ({
  label,
  id,
  description,
  className,
  ...inputProps
}: InputFieldProps) => {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const descriptionId = description ? `${controlId}-description` : undefined;

  return (
    <Field
      label={label}
      description={description}
      htmlFor={controlId}
      descriptionId={descriptionId}
    >
      <Input
        id={controlId}
        type="text"
        aria-describedby={descriptionId}
        className={cn('h-9 bg-background shadow-xs', className)}
        {...inputProps}
      />
    </Field>
  );
};
