import * as constants from '../src/bull-board.constants';

// @bull-board/nestjs registers global providers under these exact strings. Reusing them would
// make one board resolve the other's instance in an app that runs both during a migration.
const LEGACY_TOKENS = [
  'bull_board_options',
  'bull_board_queues',
  'bull_board_adapter',
  'bull_board_instance',
];

describe('DI tokens', () => {
  it('never reuse the legacy @bull-board/nestjs provider tokens', () => {
    const tokens = [
      constants.BULL_BOARD_OPTIONS,
      constants.BULL_BOARD_QUEUES,
      constants.BULL_BOARD_ADAPTER,
      constants.BULL_BOARD_INSTANCE,
    ];

    for (const token of tokens) {
      expect(LEGACY_TOKENS).not.toContain(token);
    }
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});
