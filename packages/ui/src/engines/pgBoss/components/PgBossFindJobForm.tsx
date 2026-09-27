import { ArrowRightIcon, SearchIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { usePgBossFindJob } from '../hooks/usePgBossFindJob';
import { isJobId } from '../utils/jobs';

/** Opens a job by id from the overview, without knowing its queue first. */
export const PgBossFindJobForm = ({ className }: { className?: string }) => {
  const { t } = useTranslation();
  const { open, pending } = usePgBossFindJob();
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);

  const submit = async (evt: FormEvent) => {
    evt.preventDefault();
    const id = value.trim();
    if (!isJobId(id)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    await open(id);
  };

  return (
    <form
      role="search"
      aria-label={t('PGBOSS.FIND.LABEL')}
      onSubmit={submit}
      className={cn('flex min-w-0 flex-wrap items-center gap-1.5', className)}
    >
      <div className="relative min-w-0 flex-1 sm:flex-none">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-label={t('PGBOSS.FIND.LABEL')}
          aria-invalid={invalid || undefined}
          placeholder={t('PGBOSS.FIND.PLACEHOLDER')}
          value={value}
          onChange={(evt) => {
            setValue(evt.target.value);
            if (invalid) setInvalid(false);
          }}
          className="h-8 w-full pl-8 font-mono text-xs placeholder:font-sans sm:w-80"
        />
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={pending || !value.trim()}>
        {t('PGBOSS.FIND.SUBMIT')}
        <ArrowRightIcon data-icon="inline-end" />
      </Button>
      {invalid && (
        <span role="alert" className="px-1 text-xs text-destructive">
          {t('PGBOSS.FILTER.INVALID_ID')}
        </span>
      )}
    </form>
  );
};
