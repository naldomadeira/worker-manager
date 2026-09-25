import type { ConfirmCheckbox, ConfirmResult } from '../components/ConfirmModal/ConfirmModal';

/** What the action sees when no confirm was shown, or when the confirm had no checkbox. */
const NOT_CHECKED: ConfirmResult = { checked: false };

export interface ConfirmActionOptions {
  description: string;
  shouldConfirm: boolean;
  /** Extra opt-in offered alongside the confirmation, resolved into the action's result. */
  checkbox?: ConfirmCheckbox;
}

/** The interceptor resolves 4xx/5xx bodies rather than throwing, so a failed action arrives as one. */
function isErrorBody(value: unknown): boolean {
  return !!value && typeof value === 'object' && 'error' in value;
}

export function getConfirmFor(
  afterAction: () => any,
  openConfirm: (params: {
    description: string;
    checkbox?: ConfirmCheckbox;
  }) => Promise<ConfirmResult>
) {
  return function withConfirmAndFn(
    action: (result: ConfirmResult) => Promise<any>,
    { description, shouldConfirm, checkbox }: ConfirmActionOptions
  ) {
    /** Resolves `true` only when the action ran and succeeded; a cancel or a failure is `false`. */
    return async (): Promise<boolean> => {
      try {
        const result = shouldConfirm ? await openConfirm({ description, checkbox }) : NOT_CHECKED;

        const outcome = await action(result);
        await afterAction();
        return !isErrorBody(outcome);
      } catch (e) {
        if (e) {
          // eslint-disable-next-line no-console
          console.error(e);
        }
        return false;
      }
    };
  };
}
