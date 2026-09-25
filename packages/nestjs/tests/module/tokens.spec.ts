import * as constants from '../../src/worker-manager.constants';

const LEGACY_TOKENS = [
  'bull_board_options',
  'bull_board_queues',
  'bull_board_adapter',
  'bull_board_instance',
];

describe('DI tokens', () => {
  it('never reuse the legacy @bull-board/nestjs provider tokens', () => {
    const tokens = [
      constants.WORKER_MANAGER_OPTIONS,
      constants.WORKER_MANAGER_QUEUES,
      constants.WORKER_MANAGER_ADAPTER,
      constants.WORKER_MANAGER_INSTANCE,
    ];

    for (const token of tokens) {
      expect(LEGACY_TOKENS).not.toContain(token);
    }
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});
