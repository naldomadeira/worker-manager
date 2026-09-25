import { BookOpen, Database, Maximize, Minimize, Search, Settings } from 'lucide-react';
import React, { Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Separator } from '@/components/ui/separator';
import { useBoardNavigation } from '../../hooks/useBoardNavigation';
import { useModal } from '../../hooks/useModal';
import { useUIConfig } from '../../hooks/useUIConfig';
import { useCommandPalette } from '../CommandPalette/CommandPalette';
import { CustomLinksDropdown } from '../CustomLinksDropdown/CustomLinksDropdown';
import { HintTooltip } from '../HintTooltip/HintTooltip';
import { searchShortcut } from '../Menu/Menu';
import { ThemeToggle } from '../ThemeToggle/ThemeToggle';
import { UserMenu } from '../UserMenu/UserMenu';

type ModalTypes = 'redis' | 'settings';

const RedisStatsModalLazy = React.lazy(() =>
  import('../RedisStatsModal/RedisStatsModal').then(({ RedisStatsModal }) => ({
    default: RedisStatsModal,
  }))
);

const SettingsModalLazy = React.lazy(() =>
  import('../SettingsModal/SettingsModal').then(({ SettingsModal }) => ({
    default: SettingsModal,
  }))
);

const onClickFullScreen = async () => {
  const el = document.documentElement;
  if (!!el && document.fullscreenElement !== el) return await el.requestFullscreen();
  return document.exitFullscreen();
};

const DOCS_URL = 'https://naldomadeira.github.io/worker-manager/';

const iconButtonClass = 'text-muted-foreground hover:text-foreground';

function useIsFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  return isFullscreen;
}

export const HeaderActions = () => {
  const { t } = useTranslation();
  const { miscLinks = [], hideRedisDetails = false, hideDocsLink = false } = useUIConfig();
  const modal = useModal<ModalTypes>();
  const openPalette = useCommandPalette((state) => state.setOpen);
  const isFullscreen = useIsFullscreen();
  const navigation = useBoardNavigation();
  const DatastoreModal = navigation.DatastoreModal ?? RedisStatsModalLazy;
  const datastoreTitle = navigation.datastoreTitle ?? t('REDIS.TITLE');

  return (
    <>
      <div className="flex shrink-0 items-center gap-0.5 md:gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => openPalette(true)}
          aria-label={t('HEADER.SEARCH')}
          aria-keyshortcuts="Meta+K Control+K"
          className="hidden h-8 w-52 justify-start gap-2 rounded-lg bg-muted/40 px-2.5 font-normal text-muted-foreground shadow-none hover:text-foreground lg:flex xl:w-64"
        >
          <Search aria-hidden="true" />
          <span className="flex-1 text-left">{t('HEADER.SEARCH')}…</span>
          <Kbd className="border bg-background font-mono text-[0.65rem]">{searchShortcut}</Kbd>
        </Button>
        <HintTooltip title={t('HEADER.SEARCH')} side="bottom">
          <Button
            variant="ghost"
            size="icon-sm"
            className={`${iconButtonClass} lg:hidden`}
            onClick={() => openPalette(true)}
            aria-label={t('HEADER.SEARCH')}
          >
            <Search aria-hidden="true" />
          </Button>
        </HintTooltip>

        <Separator orientation="vertical" className="mx-1 h-5! max-md:hidden" />

        {!hideRedisDetails && (
          <HintTooltip title={datastoreTitle} side="bottom">
            <Button
              variant="ghost"
              size="icon-sm"
              className={iconButtonClass}
              onClick={() => modal.open('redis')}
              aria-label={datastoreTitle}
            >
              <Database aria-hidden="true" />
            </Button>
          </HintTooltip>
        )}
        {!hideDocsLink && (
          <HintTooltip title={t('HEADER.DOCS')} side="bottom">
            <Button variant="ghost" size="icon-sm" className={iconButtonClass} asChild>
              <a
                href={DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('HEADER.DOCS')}
              >
                <BookOpen aria-hidden="true" />
              </a>
            </Button>
          </HintTooltip>
        )}
        <HintTooltip title={t('HEADER.FULLSCREEN')} side="bottom">
          <Button
            variant="ghost"
            size="icon-sm"
            className={`${iconButtonClass} max-md:hidden`}
            onClick={onClickFullScreen}
            aria-label={t('HEADER.FULLSCREEN')}
            aria-pressed={isFullscreen}
          >
            {isFullscreen ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}
          </Button>
        </HintTooltip>
        <ThemeToggle />
        <HintTooltip title={t('SETTINGS.TITLE')} side="bottom">
          <Button
            variant="ghost"
            size="icon-sm"
            className={`${iconButtonClass} [&_svg]:transition-transform [&_svg]:duration-500 hover:[&_svg]:rotate-90`}
            onClick={() => modal.open('settings')}
            aria-label={t('SETTINGS.TITLE')}
          >
            <Settings aria-hidden="true" />
          </Button>
        </HintTooltip>
        {miscLinks.length > 0 && <CustomLinksDropdown options={miscLinks} />}
        <UserMenu />
      </div>
      <Suspense fallback={null}>
        {!hideRedisDetails && modal.isMounted('redis') && (
          <DatastoreModal open={modal.isOpen('redis')} onClose={modal.close('redis')} />
        )}
        {modal.isMounted('settings') && (
          <SettingsModalLazy open={modal.isOpen('settings')} onClose={modal.close('settings')} />
        )}
      </Suspense>
    </>
  );
};
