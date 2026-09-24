import { fireEvent, screen, waitFor } from '@testing-library/react';
import { UserMenu } from '../../src/components/UserMenu/UserMenu';
import { createWrapper, render } from '../testUtils';

const originalFetch = global.fetch;

function mockFetch(status: number, body?: unknown) {
  const fetchMock = jest.fn(() =>
    Promise.resolve({ status, ok: status < 300, json: () => Promise.resolve(body) } as Response)
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

afterEach(() => {
  global.fetch = originalFetch;
});

function renderMenu() {
  const { Wrapper } = createWrapper({ api: {} });
  return render(<UserMenu />, { wrapper: Wrapper });
}

it('asks auth/me next to the document base, with same-origin credentials', async () => {
  const fetchMock = mockFetch(404);
  renderMenu();

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
  expect(String(url)).toBe(new URL('auth/me', document.baseURI).toString());
  expect(init.credentials).toBe('same-origin');
});

it('renders nothing when auth is not configured', async () => {
  const fetchMock = mockFetch(404);
  const { container } = renderMenu();

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(container.innerHTML).toBe('');
});

it('shows the signed-in user with roles and a sign-out link', async () => {
  mockFetch(200, {
    strategy: 'keycloak',
    user: { username: 'jdoe', name: 'Jane Doe', email: 'jane@example.com', roles: ['admin'] },
    logoutUrl: '/auth/logout',
  });
  renderMenu();

  const trigger = await screen.findByRole('button', { name: 'USER.MENU' });
  expect(trigger.textContent).toContain('JD');

  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });

  expect(await screen.findByText('jane@example.com')).toBeTruthy();
  expect(screen.getByText('admin')).toBeTruthy();
  expect(screen.getByText('USER.SIGN_OUT').closest('a')?.getAttribute('href')).toBe('/auth/logout');
});

it('hides sign-out when there is no logout URL', async () => {
  mockFetch(200, {
    strategy: 'basic',
    user: { username: 'ops', roles: [] },
    logoutUrl: null,
  });
  renderMenu();

  fireEvent.pointerDown(await screen.findByRole('button', { name: 'USER.MENU' }), {
    button: 0,
    ctrlKey: false,
    pointerType: 'mouse',
  });

  await screen.findByRole('menu');
  expect(screen.queryByText('USER.SIGN_OUT')).toBeNull();
});
