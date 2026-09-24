import { Briefcase, Layers, Settings2 } from 'lucide-react';
import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { languages } from '../../constants/languages';
import { availableJobTabs, DEFAULT_JOB_TAB, JobTabPreference } from '../../hooks/useDetailsTabs';
import { ThemePreference, useSettingsStore } from '../../hooks/useSettings';
import { useUIConfig } from '../../hooks/useUIConfig';
import { dynamicTranslationKey } from '../../utils/dynamicTranslationKey';

export interface SettingsModalProps {
  open: boolean;

  onClose(): void;
}

const pollingIntervals = [-1, 3, 5, 10, 20, 60, 60 * 5, 60 * 15];
const maxJobsPerPage = 300;

const Row = ({
  id,
  label,
  description,
  children,
}: {
  id: string;
  label: string;
  description?: string;
  children: ReactNode;
}) => (
  <Field orientation="horizontal" className="items-center justify-between gap-6">
    <FieldContent>
      <FieldLabel htmlFor={id} className="font-normal">
        {label}
      </FieldLabel>
      {!!description && <FieldDescription className="text-xs">{description}</FieldDescription>}
    </FieldContent>
    {children}
  </Field>
);

const SelectRow = ({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: { text: string; value: string }[];
  onChange: (value: string) => void;
}) => (
  <Row id={id} label={label}>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-44 shrink-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="end">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </Row>
);

const SwitchRow = ({
  id,
  label,
  description,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) => (
  <Row id={id} label={label} description={description}>
    <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
  </Row>
);

const NumberRow = ({
  id,
  label,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) => (
  <Row id={id} label={label}>
    <Input
      id={id}
      type="number"
      className="w-24 shrink-0 text-right tabular-nums"
      value={value}
      min={min}
      max={max}
      maxLength={3}
      onChange={(event) => onChange(+event.target.value)}
    />
  </Row>
);

export const SettingsModal = ({ open, onClose }: SettingsModalProps) => {
  const {
    language,
    pollingInterval,
    jobsPerPage,
    confirmQueueActions,
    confirmJobActions,
    collapseJob,
    collapseJobData,
    collapseJobProgress,
    collapseJobOptions,
    collapseJobError,
    defaultCollapseDepth,
    useCollapsibleJson,
    defaultJobTab,
    sortQueues,
    overview,
    theme,
    showEnvBadge,
    setSettings,
  } = useSettingsStore((state) => state);
  const {
    pollingInterval: uiConfigPollingInterval,
    overview: overviewConfig,
    environment,
  } = useUIConfig();
  const groupedDefault = overviewConfig?.groupByDelimiter ?? false;
  const { t, i18n } = useTranslation();

  const sections = [
    { value: 'general', label: t('SETTINGS.SECTIONS.GENERAL'), icon: Settings2 },
    { value: 'queues', label: t('SETTINGS.SECTIONS.QUEUES'), icon: Layers },
    { value: 'jobs', label: t('SETTINGS.SECTIONS.JOBS'), icon: Briefcase },
  ];

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="border-b px-5 pt-5 pb-4">
          <DialogTitle className="text-base font-semibold">{t('SETTINGS.TITLE')}</DialogTitle>
          <DialogDescription className="sr-only">{t('SETTINGS.TITLE')}</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="general" className="gap-0">
          <div className="border-b px-5 py-3">
            <TabsList className="w-full">
              {sections.map(({ value, label, icon: Icon }) => (
                <TabsTrigger key={value} value={value} className="gap-1.5">
                  <Icon aria-hidden="true" />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <div className="max-h-[min(60vh,32rem)] overflow-y-auto px-5 py-4">
            <TabsContent value="general" className="animate-in duration-200 fade-in-0">
              <FieldGroup className="gap-4">
                <SelectRow
                  label={t('SETTINGS.LANGUAGE')}
                  id="language"
                  options={languages.map((lng) => ({ text: lng, value: lng }))}
                  /* The stored setting starts empty, which matched no option and left the control
                     blank until you picked something. initI18n narrows to a supported language, so
                     falling back to the active one shows what the board is actually rendering in. */
                  value={language || i18n.language}
                  onChange={(value) => {
                    i18n.changeLanguage(value);
                    setSettings({ language: value });
                  }}
                />
                {uiConfigPollingInterval?.showSetting !== false && (
                  <SelectRow
                    label={t('SETTINGS.POLLING_INTERVAL')}
                    id="polling-interval"
                    options={pollingIntervals.map((interval) => ({
                      text:
                        interval < 0
                          ? t('SETTINGS.POLLING_OPTIONS.OFF')
                          : Math.floor(interval / 60) === 0
                            ? t('SETTINGS.POLLING_OPTIONS.SECS', { count: interval })
                            : t('SETTINGS.POLLING_OPTIONS.MINS', { count: interval / 60 }),
                      value: `${interval}`,
                    }))}
                    value={`${pollingInterval}`}
                    onChange={(value) => setSettings({ pollingInterval: +value })}
                  />
                )}
                <SelectRow
                  label={t('SETTINGS.THEME')}
                  id="theme"
                  options={[
                    { text: t('SETTINGS.THEME_OPTIONS.SYSTEM'), value: 'system' },
                    { text: t('SETTINGS.THEME_OPTIONS.LIGHT'), value: 'light' },
                    { text: t('SETTINGS.THEME_OPTIONS.DARK'), value: 'dark' },
                  ]}
                  value={theme}
                  onChange={(value) => setSettings({ theme: value as ThemePreference })}
                />
                {!!environment && (
                  <SwitchRow
                    label={t('SETTINGS.SHOW_ENV_BADGE')}
                    id="show-env-badge"
                    checked={showEnvBadge}
                    onCheckedChange={(checked) => setSettings({ showEnvBadge: checked })}
                  />
                )}
              </FieldGroup>
            </TabsContent>

            <TabsContent value="queues" className="animate-in duration-200 fade-in-0">
              <FieldGroup className="gap-4">
                <SwitchRow
                  label={t('SETTINGS.GROUP_QUEUES')}
                  id="group-queues"
                  description={t('SETTINGS.GROUP_QUEUES_HELP')}
                  checked={overview.grouped ?? groupedDefault}
                  onCheckedChange={(checked) => setSettings({ overview: { grouped: checked } })}
                />
                <SwitchRow
                  label={t('SETTINGS.SORT_QUEUES')}
                  id="sort-queues"
                  checked={sortQueues}
                  onCheckedChange={(checked) => setSettings({ sortQueues: checked })}
                />
                <SwitchRow
                  label={t('SETTINGS.CONFIRM_QUEUE_ACTIONS')}
                  id="confirm-queue-actions"
                  checked={confirmQueueActions}
                  onCheckedChange={(checked) => setSettings({ confirmQueueActions: checked })}
                />
              </FieldGroup>
            </TabsContent>

            <TabsContent value="jobs" className="animate-in duration-200 fade-in-0">
              <FieldGroup className="gap-4">
                <SelectRow
                  label={t('SETTINGS.DEFAULT_JOB_TAB')}
                  id="default-job-tab"
                  options={[DEFAULT_JOB_TAB, ...availableJobTabs].map((tab) => ({
                    text: t(dynamicTranslationKey(`JOB.TABS.${tab.toUpperCase()}`)),
                    value: tab,
                  }))}
                  value={defaultJobTab}
                  onChange={(value) => setSettings({ defaultJobTab: value as JobTabPreference })}
                />
                <NumberRow
                  label={t('SETTINGS.JOBS_PER_PAGE')}
                  id="jobs-per-page"
                  value={jobsPerPage}
                  min={1}
                  max={maxJobsPerPage}
                  onChange={(value) =>
                    setSettings({ jobsPerPage: Math.min(value, maxJobsPerPage) })
                  }
                />
                <SwitchRow
                  label={t('SETTINGS.CONFIRM_JOB_ACTIONS')}
                  id="confirm-job-actions"
                  checked={confirmJobActions}
                  onCheckedChange={(checked) => setSettings({ confirmJobActions: checked })}
                />
                <FieldSeparator />
                <SwitchRow
                  label={t('SETTINGS.COLLAPSE_JOB')}
                  id="collapse-job"
                  checked={collapseJob}
                  onCheckedChange={(checked) => setSettings({ collapseJob: checked })}
                />
                <SwitchRow
                  label={t('SETTINGS.COLLAPSE_JOB_DATA')}
                  id="collapse-job-data"
                  checked={collapseJobData}
                  onCheckedChange={(checked) => setSettings({ collapseJobData: checked })}
                />
                <SwitchRow
                  label={t('SETTINGS.COLLAPSE_JOB_PROGRESS')}
                  id="collapse-job-progress"
                  checked={collapseJobProgress}
                  onCheckedChange={(checked) => setSettings({ collapseJobProgress: checked })}
                />
                <SwitchRow
                  label={t('SETTINGS.COLLAPSE_JOB_OPTIONS')}
                  id="collapse-job-options"
                  checked={collapseJobOptions}
                  onCheckedChange={(checked) => setSettings({ collapseJobOptions: checked })}
                />
                <SwitchRow
                  label={t('SETTINGS.COLLAPSE_JOB_ERROR')}
                  id="collapse-job-error"
                  checked={collapseJobError}
                  onCheckedChange={(checked) => setSettings({ collapseJobError: checked })}
                />
                <FieldSeparator />
                <SwitchRow
                  label={t('SETTINGS.USE_COLLAPSIBLE_JSON')}
                  id="use-collapsible-json"
                  checked={useCollapsibleJson}
                  onCheckedChange={(checked) => setSettings({ useCollapsibleJson: checked })}
                />
                {useCollapsibleJson && (
                  <NumberRow
                    label={t('SETTINGS.DEFAULT_COLLAPSE_DEPTH')}
                    id="default-collapse-depth"
                    value={defaultCollapseDepth}
                    min={0}
                    max={10}
                    onChange={(value) =>
                      setSettings({ defaultCollapseDepth: Math.max(0, Math.min(10, value)) })
                    }
                  />
                )}
              </FieldGroup>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
