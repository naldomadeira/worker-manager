import { SearchIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CommandGroup, CommandItem } from '@/components/ui/command';
import type { CommandPaletteExtrasProps } from '../../../hooks/useBoardNavigation';
import { usePgBossFindJob } from '../hooks/usePgBossFindJob';
import { isJobId } from '../utils/jobs';

/**
 * A pasted job id in the command palette: one entry that opens the job wherever it lives,
 * since a pg-boss id alone does not say which queue it belongs to.
 */
export const PgBossCommandExtras = ({ search, run }: CommandPaletteExtrasProps) => {
  const { t } = useTranslation();
  const { open } = usePgBossFindJob();
  const id = search.trim();

  if (!isJobId(id)) {
    return null;
  }

  return (
    <CommandGroup heading={t('PGBOSS.FIND.GROUP')}>
      <CommandItem value={`job:${id}`} keywords={[id]} onSelect={() => run(() => void open(id))}>
        <SearchIcon aria-hidden="true" className="text-muted-foreground" />
        <span className="min-w-0 truncate">
          {t('PGBOSS.FIND.OPEN_JOB', { id: id.toLowerCase() })}
        </span>
      </CommandItem>
    </CommandGroup>
  );
};
