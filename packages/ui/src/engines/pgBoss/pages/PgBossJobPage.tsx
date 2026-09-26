import { ArrowLeft } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import React, { Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useHistory, useLocation, useParams } from 'react-router-dom';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Loader } from '../../../components/Loader/Loader';
import { LoadError } from '../../../components/LoadError/LoadError';
import { StickyHeader } from '../../../components/StickyHeader/StickyHeader';
import { useMobileQuery } from '../../../hooks/useMobileQuery';
import { PgBossJobCard } from '../components/PgBossJobCard';
import { PgBossWritesDisabledBanner } from '../components/PgBossWritesDisabledBanner';
import { PgBossLoadError } from '../hooks/query';
import { usePgBossActions } from '../hooks/usePgBossActions';
import { permissionsOf, usePgBossInfo } from '../hooks/usePgBossInfo';
import { usePgBossJob } from '../hooks/usePgBossJob';
import { shortId } from '../utils/jobs';
import { pgBossLinks } from '../utils/links';
import { parseState } from '../utils/states';

const PgBossSendJobModalLazy = React.lazy(() =>
  import('../components/PgBossSendJobModal').then(({ PgBossSendJobModal }) => ({
    default: PgBossSendJobModal,
  }))
);

/** One pg-boss job with its data, output, options, dependencies and dead-letter origin. */
export const PgBossJobPage = () => {
  const { t } = useTranslation();
  const history = useHistory();
  const { search } = useLocation();
  const reduceMotion = useReducedMotion();
  const isMobile = useMobileQuery();
  const params = useParams<{ name: string; jobId: string }>();
  const queueName = decodeURIComponent(params.name ?? '');
  const jobId = decodeURIComponent(params.jobId ?? '');
  const state = parseState(new URLSearchParams(search).get('state'));
  const { info } = usePgBossInfo();
  const permissions = permissionsOf(info);
  const { job, loading, error, refetch } = usePgBossJob(queueName, jobId);
  const actions = usePgBossActions();
  const [duplicating, setDuplicating] = useState(false);
  const queueUrl = pgBossLinks.queuePage(queueName, state);

  if (!job) {
    if (
      error &&
      !(error instanceof PgBossLoadError && error.body.error.key === 'ERRORS.JOB_NOT_FOUND')
    ) {
      return <LoadError error={error} onRetry={refetch} />;
    }
    return (
      <section className="py-10 text-center text-sm text-muted-foreground">
        {loading ? <Loader /> : t('JOB.NOT_FOUND')}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <PgBossWritesDisabledBanner info={info} />
      {/* The header breadcrumb already reads Overview > queue > job and links back to the queue.
          It is hidden below md, so only there does the page draw its own way back. */}
      {isMobile && (
        <StickyHeader
          actions={
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link
                      to={queueUrl}
                      className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 font-medium hover:bg-state-hover"
                    >
                      <ArrowLeft className="size-3.5" />
                      {queueName}
                    </Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage className="font-mono text-xs" title={job.id}>
                    {shortId(job.id)}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          }
        />
      )}
      <motion.div
        key={job.id}
        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      >
        <PgBossJobCard
          job={job}
          detail={job}
          permissions={permissions}
          actions={{
            command: (command) => async () => {
              const done = await actions.jobCommand(command, queueName, job)();
              // Only a deleted job leaves the page; any other outcome keeps it in view.
              if (done && command === 'delete') history.replace(queueUrl);
              return done;
            },
            duplicate: () => setDuplicating(true),
          }}
        />
      </motion.div>
      <Suspense fallback={null}>
        {duplicating && (
          <PgBossSendJobModalLazy
            open
            queueName={queueName}
            job={job}
            onClose={() => setDuplicating(false)}
          />
        )}
      </Suspense>
    </section>
  );
};
