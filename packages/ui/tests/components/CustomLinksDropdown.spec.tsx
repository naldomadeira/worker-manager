import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { UIConfig } from '@worker-manager/api/typings/app';
import { CustomLinksDropdown } from '../../src/components/CustomLinksDropdown/CustomLinksDropdown';
import { render } from '../testUtils';

// Radix menus open on pointerdown (a mouse press), not on click.
const openMenu = (trigger: HTMLElement) =>
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });

async function openDropdown(options: UIConfig['miscLinks']) {
  render(<CustomLinksDropdown className="trigger" options={options} />);

  openMenu(screen.getAllByRole('button')[0]);
  await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
}

function itemNamed(text: string) {
  return screen.getByText(text).closest('[role="menuitem"]');
}

it('renders a link per option', async () => {
  await openDropdown([
    { text: 'Logout', url: '/logout' },
    { text: 'Docs', url: 'https://example.com/docs' },
  ]);

  expect(itemNamed('Logout')?.getAttribute('href')).toBe('/logout');
  expect(itemNamed('Docs')?.getAttribute('href')).toBe('https://example.com/docs');
});

it('shows the icon of an option that has one', async () => {
  await openDropdown([
    { text: 'Logout', url: '/logout', icon: 'https://cdn.example.com/logout.svg' },
  ]);

  const icon = itemNamed('Logout')?.querySelector('img');

  expect(icon?.getAttribute('src')).toBe('https://cdn.example.com/logout.svg');
  expect(icon?.getAttribute('alt')).toBe('');
});

it('renders no image for an option without an icon', async () => {
  await openDropdown([{ text: 'Logout', url: '/logout' }]);

  expect(itemNamed('Logout')?.querySelector('img')).toBeNull();
});
