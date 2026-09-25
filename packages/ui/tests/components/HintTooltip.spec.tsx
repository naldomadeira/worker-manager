import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HintTooltip } from '../../src/components/HintTooltip/HintTooltip';
import { render } from '../testUtils';

// Radix mirrors the tooltip text into a visually hidden `role="tooltip"` node for screen
// readers, so the text appears twice while open; the role is the stable handle.

it('opens on hover and names the trigger', async () => {
  const user = userEvent.setup();
  render(
    <HintTooltip title="Retry this job">
      <button type="button">Retry</button>
    </HintTooltip>
  );

  await user.hover(screen.getByRole('button', { name: 'Retry' }));

  await waitFor(() => expect(screen.getByRole('tooltip').textContent).toBe('Retry this job'));
});

it('opens on keyboard focus', async () => {
  const user = userEvent.setup();
  render(
    <HintTooltip title="Retry this job">
      <button type="button">Retry</button>
    </HintTooltip>
  );

  await user.tab();

  await waitFor(() => expect(screen.getByRole('tooltip').textContent).toBe('Retry this job'));
});

it('closes on escape', async () => {
  const user = userEvent.setup();
  render(
    <HintTooltip title="Retry this job">
      <button type="button">Retry</button>
    </HintTooltip>
  );

  await user.hover(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.getByRole('tooltip').textContent).toBe('Retry this job'));

  await user.keyboard('{Escape}');

  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  expect(screen.queryByText('Retry this job')).toBeNull();
});
