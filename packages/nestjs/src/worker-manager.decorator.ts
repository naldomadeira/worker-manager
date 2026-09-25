import { Inject } from '@nestjs/common';
import { getWorkerManagerToken } from './worker-manager.constants';

/** Injects the board registered by `forRoot`, or the one registered with `forRoot({ name })`. */
export const InjectWorkerManager = (name?: string): ParameterDecorator =>
  Inject(getWorkerManagerToken(name));
