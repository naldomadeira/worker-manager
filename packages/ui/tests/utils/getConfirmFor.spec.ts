import { getConfirmFor } from '../../src/utils/getConfirmFor';

const confirmed = () => Promise.resolve({ checked: false });
const cancelled = () => Promise.reject();

it('runs the action and the refresh, and resolves true, when the confirm is accepted', async () => {
  const afterAction = jest.fn();
  const action = jest.fn(() => Promise.resolve());
  const run = getConfirmFor(afterAction, confirmed)(action, {
    description: 'x',
    shouldConfirm: true,
  });

  await expect(run()).resolves.toBe(true);
  expect(action).toHaveBeenCalledTimes(1);
  expect(afterAction).toHaveBeenCalledTimes(1);
});

it('skips the action and resolves false when the confirm is cancelled', async () => {
  const afterAction = jest.fn();
  const action = jest.fn(() => Promise.resolve());
  const run = getConfirmFor(afterAction, cancelled)(action, {
    description: 'x',
    shouldConfirm: true,
  });

  await expect(run()).resolves.toBe(false);
  expect(action).not.toHaveBeenCalled();
  expect(afterAction).not.toHaveBeenCalled();
});

it('resolves false when the API answered with an error body', async () => {
  const afterAction = jest.fn();
  const action = jest.fn(() => Promise.resolve({ error: { key: 'ERRORS.JOB_IS_ACTIVE' } }));
  const run = getConfirmFor(afterAction, confirmed)(action, {
    description: 'x',
    shouldConfirm: false,
  });

  await expect(run()).resolves.toBe(false);
  expect(afterAction).toHaveBeenCalledTimes(1);
});

it('resolves false, without throwing, when the action rejects', async () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const run = getConfirmFor(jest.fn(), confirmed)(() => Promise.reject(new Error('offline')), {
    description: 'x',
    shouldConfirm: false,
  });

  await expect(run()).resolves.toBe(false);
  spy.mockRestore();
});
