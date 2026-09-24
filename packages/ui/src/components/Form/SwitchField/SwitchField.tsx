import React, { useId } from 'react';
import { Switch } from '@/components/ui/switch';
import { Field } from '../Field/Field';

type SwitchProps = React.ComponentProps<typeof Switch>;

interface SwitchFieldProps extends SwitchProps {
  label?: string;
  id?: string;
  description?: string;
}

export const SwitchField = ({
  label,
  id,
  description,
  className,
  ...switchProps
}: SwitchFieldProps) => {
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
      <Switch id={controlId} aria-describedby={descriptionId} className="mt-px" {...switchProps} />
    </Field>
  );
};
