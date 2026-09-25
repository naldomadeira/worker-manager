import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from 'jose';

export class FakeOidcProvider {
  readonly realm = 'test';
  readonly clientId = 'board';
  readonly clientSecret = 'client-secret';
  url = '';

  private server!: Server;
  private privateKey!: KeyLike;

  get issuer(): string {
    return `${this.url}/realms/${this.realm}`;
  }

  get authorizationEndpoint(): string {
    return `${this.issuer}/protocol/openid-connect/auth`;
  }

  async start(): Promise<void> {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    this.privateKey = privateKey;
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };

    this.server = createServer((req, res) => {
      const path = new URL(req.url ?? '/', this.url).pathname;
      const body =
        path === `/realms/${this.realm}/.well-known/openid-configuration`
          ? {
              issuer: this.issuer,
              authorization_endpoint: this.authorizationEndpoint,
              token_endpoint: `${this.issuer}/protocol/openid-connect/token`,
              jwks_uri: `${this.issuer}/protocol/openid-connect/certs`,
              end_session_endpoint: `${this.issuer}/protocol/openid-connect/logout`,
            }
          : path === `/realms/${this.realm}/protocol/openid-connect/certs`
            ? { keys: [jwk] }
            : undefined;
      res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body ?? { error: 'not_found' }));
    });

    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  accessToken(username: string, roles: string[]): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      sub: `id-${username}`,
      preferred_username: username,
      aud: 'account',
      azp: this.clientId,
      realm_access: { roles },
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(this.issuer)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(this.privateKey);
  }
}
