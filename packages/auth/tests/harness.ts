import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createAuthMiddleware, type AuthOptions, type RequestWithUser } from '../src';

export interface Harness {
  url: string;
  close(): Promise<void>;
}

/**
 * A plain `http` server with the middleware in front of a stub board that echoes the user,
 * so the tests exercise the middleware exactly as a framework would call it.
 */
export async function startBoard(options: AuthOptions, basePath = '/queues'): Promise<Harness> {
  const middleware = createAuthMiddleware(options, { basePath });
  const server: Server = createServer((req, res) => {
    middleware(req, res, (error) => {
      if (error) {
        res.statusCode = 500;
        res.end(String(error));
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ board: true, user: (req as RequestWithUser).user ?? null }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export const basicHeader = (user: string, password: string) =>
  `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

/** Collects `Set-Cookie` values into a `Cookie` header, dropping cleared cookies. */
export class CookieJar {
  private cookies = new Map<string, string>();

  store(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (value === '' || /Max-Age=0/i.test(header)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }

  set(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}
