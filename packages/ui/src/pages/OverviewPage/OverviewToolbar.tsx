import type { AppQueue } from '@worker-manager/api/typings/app';
import {
  ArrowDownWideNarrowIcon,
  ArrowUpNarrowWideIcon,
  FolderTreeIcon,
  LayoutGridIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { QueueActions } from '../../../typings/app';
import { OverviewControls } from '../../components/OverviewControls/OverviewControls';
import OverviewDropDownActions from '../../components/OverviewDropDownActions/OverviewDropDownActions';
import { useQueueSearch } from '../../hooks/useQueueSearch';
import { useSettingsStore } from '../../hooks/useSettings';
import type { QueueSortKey, SortDirection } from '../../hooks/useSortQueues';
import { dynamicTranslationKey } from '../../utils/dynamicTranslationKey';

const sortOptions: QueueSortKey[] = [
  'alphabetical',
  'failed',
  'completed',
  'active',
  'waiting',
  'delayed',
];

interface OverviewToolbarProps {
  actions: QueueActions;
  queues: AppQueue[] | null;
  grouped: boolean;
  hasGroups: boolean;
  groupPaths: string[];
  onSort: (sortKey: QueueSortKey) => void;
  sortKey: QueueSortKey;
  sortDirection: SortDirection;
}

/** Search, sort, view mode and bulk actions for the overview, in one responsive row. */
export const OverviewToolbar = ({
  actions,
  queues,
  grouped,
  hasGroups,
  groupPaths,
  onSort,
  sortKey,
  sortDirection,
}: OverviewToolbarProps) => {
  const { t } = useTranslation();
  const { searchTerm, setSearchTerm } = useQueueSearch();
  const setSettings = useSettingsStore((state) => state.setSettings);
  const searchLabel = t('MENU.SEARCH_INPUT_PLACEHOLDER');
  const directionLabel =
    sortDirection === 'asc' ? t('DASHBOARD.SORTING.ASC') : t('DASHBOARD.SORTING.DESC');

  return (
    <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <InputGroup className="bg-background sm:max-w-xs">
        <InputGroupAddon>
          <SearchIcon aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          value={searchTerm}
          placeholder={searchLabel}
          aria-label={searchLabel}
          onChange={(event) => setSearchTerm(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && searchTerm) {
              event.preventDefault();
              setSearchTerm('');
            }
          }}
          className="[&::-webkit-search-cancel-button]:hidden"
        />
        {!!searchTerm && (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              aria-label={t('DASHBOARD.CLEAR_SEARCH')}
              title={t('DASHBOARD.CLEAR_SEARCH')}
              onClick={() => setSearchTerm('')}
              className="animate-in fade-in-0 zoom-in-75"
            >
              <XIcon />
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>

      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {!grouped && (
          <ButtonGroup>
            <Select value={sortKey} onValueChange={(value) => onSort(value as QueueSortKey)}>
              <SelectTrigger
                aria-label={t('DASHBOARD.SORTING.TITLE')}
                className="min-w-44 bg-background"
              >
                <span className="text-muted-foreground">{t('DASHBOARD.SORTING.TITLE')}</span>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="end">
                {sortOptions.map((key) => (
                  <SelectItem key={key} value={key}>
                    {t(dynamicTranslationKey(`DASHBOARD.SORTING.${key.toUpperCase()}`))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              className="bg-background"
              aria-label={directionLabel}
              title={directionLabel}
              onClick={() => onSort(sortKey)}
            >
              {sortDirection === 'asc' ? <ArrowUpNarrowWideIcon /> : <ArrowDownWideNarrowIcon />}
            </Button>
          </ButtonGroup>
        )}

        {hasGroups && (
          <ToggleGroup
            type="single"
            variant="outline"
            aria-label={t('DASHBOARD.VIEW.TITLE')}
            value={grouped ? 'grouped' : 'flat'}
            onValueChange={(value) => {
              if (value) setSettings({ overview: { grouped: value === 'grouped' } });
            }}
            className="bg-background"
          >
            <ToggleGroupItem value="flat" aria-label={t('DASHBOARD.VIEW.FLAT')}>
              <LayoutGridIcon />
              <span className="max-sm:sr-only">{t('DASHBOARD.VIEW.FLAT')}</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="grouped" aria-label={t('DASHBOARD.VIEW.GROUPED')}>
              <FolderTreeIcon />
              <span className="max-sm:sr-only">{t('DASHBOARD.VIEW.GROUPED')}</span>
            </ToggleGroupItem>
          </ToggleGroup>
        )}

        <OverviewControls grouped={grouped} groupPaths={groupPaths} />
        <OverviewDropDownActions actions={actions} queues={queues} />
      </div>
    </div>
  );
};
