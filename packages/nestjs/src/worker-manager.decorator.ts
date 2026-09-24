import { Inject } from '@nestjs/common';
import { WORKER_MANAGER_INSTANCE } from './worker-manager.constants';

export const InjectWorkerManager = (): ParameterDecorator => Inject(WORKER_MANAGER_INSTANCE);
