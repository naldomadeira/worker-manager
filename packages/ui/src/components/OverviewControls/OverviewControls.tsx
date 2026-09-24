import { ChevronsDownUpIcon, ChevronsUpDownIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { useOverviewState } from '../../hooks/useMenuState';

interface OverviewControlsProps {
  grouped: boolean;
  groupPaths: string[];
}

/** Expand / collapse every group of the grouped overview at once. */
export const OverviewControls = ({ grouped, groupPaths }: OverviewControlsProps) => {
  const { t } = useTranslation();
  const expandAll = useOverviewState((state) => state.expandAll);
  const collapseAll = useOverviewState((state) => state.collapseAll);
  const { allExpanded, allCollapsed } = useOverviewState(
    useShallow((state) => ({
      allExpanded: groupPaths.every((path) => state.isMenuOpen(path)),
      allCollapsed: groupPaths.every((path) => !state.isMenuOpen(path)),
    }))
  );

  if (!grouped) {
    return null;
  }

  return (
    <ButtonGroup>
      <Button
        variant="outline"
        size="icon"
        onClick={() => expandAll(groupPaths)}
        title={t('MENU.EXPAND_ALL')}
        aria-label={t('MENU.EXPAND_ALL')}
        disabled={allExpanded}
      >
        <ChevronsUpDownIcon />
      </Button>
      <Button
        variant="outline"
        size="icon"
        onClick={() => collapseAll(groupPaths)}
        title={t('MENU.COLLAPSE_ALL')}
        aria-label={t('MENU.COLLAPSE_ALL')}
        disabled={allCollapsed}
      >
        <ChevronsDownUpIcon />
      </Button>
    </ButtonGroup>
  );
};
