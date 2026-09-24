import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { BULL_BOARD_INSTANCE, BULL_BOARD_OPTIONS, BULL_BOARD_QUEUES } from './bull-board.constants';
import {
  BullBoardInstance,
  BullBoardModuleOptions,
  BullBoardQueueOptions,
} from './bull-board.types';
import { registerQueues } from './bull-board.util';

@Module({})
export class BullBoardFeatureModule implements OnModuleInit {
  constructor(
    private readonly moduleRef: ModuleRef,
    @Inject(BULL_BOARD_QUEUES) private readonly queues: BullBoardQueueOptions[],
    @Inject(BULL_BOARD_INSTANCE) private readonly board: BullBoardInstance | null,
    @Inject(BULL_BOARD_OPTIONS) private readonly options: BullBoardModuleOptions
  ) {}

  onModuleInit(): any {
    // `enabled: false` leaves no board to register into.
    if (!this.board) return;

    registerQueues(this.board, this.moduleRef, this.queues, this.options?.readOnly);
  }
}
