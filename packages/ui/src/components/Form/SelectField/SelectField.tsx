import { useId, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Field } from '../Field/Field';

export interface SelectItem {
  text: string;
  value: string;
}

interface SelectFieldProps {
  label?: string;
  id?: string;
  name?: string;
  className?: string;
  options: SelectItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

// Radix reserves the empty string for "nothing selected", but an empty value is a real option
// here (e.g. "All queues"), so it travels through the primitive under a sentinel.
const EMPTY = '__wm_empty__';
const encode = (value: string | undefined) => (value === '' ? EMPTY : value);
const decode = (value: string) => (value === EMPTY ? '' : value);

export const SelectField = ({
  label,
  id,
  name,
  className,
  options,
  value,
  defaultValue,
  onChange,
  required,
  disabled,
  placeholder,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: SelectFieldProps) => {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  const current = value !== undefined ? value : uncontrolled;
  const hasOption = options.some((option) => option.value === current);

  return (
    <Field label={label} htmlFor={controlId}>
      <Select
        value={hasOption ? encode(current) : ''}
        onValueChange={(next) => {
          const decoded = decode(next);
          setUncontrolled(decoded);
          onChange?.(decoded);
        }}
        required={required}
        disabled={disabled}
      >
        <SelectTrigger
          id={controlId}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          className={cn(
            'h-9 w-full min-w-0 bg-background shadow-xs data-[size=default]:h-9 [&>svg]:transition-transform [&>svg]:duration-200 data-[state=open]:[&>svg]:rotate-180',
            className
          )}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        {/* Anchored below the trigger rather than laid over it, so a long list (the twelve
            languages) scrolls inside its own max height instead of outgrowing the modal. */}
        <SelectContent
          position="popper"
          sideOffset={4}
          className="max-h-72 min-w-(--radix-select-trigger-width)"
        >
          {options.map((option) => (
            <SelectItem key={option.value} value={encode(option.value)!}>
              {option.text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* The submitted value, decoded, since the primitive's own form input would carry the
          sentinel for an empty option. */}
      {!!name && <input type="hidden" name={name} value={current ?? ''} />}
    </Field>
  );
};
