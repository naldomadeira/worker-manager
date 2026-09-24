import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload, type KeyLike } from 'jose';

export interface FakeUser {
  sub: string;
  preferred_username: string;
  name?: string;
  email?: string;
  realmRoles?: string[];
  clientRoles?: string[];
}

interface PendingCode {
  user: FakeUser;
  challenge: string;
  nonce: string;
  redirectUri: string;
}

/**
 * A minimal Keycloak look-alike: discovery, JWKS, and a token endpoint that honours the
 * authorization code grant (checking PKCE) and the refresh token grant. Codes are minted by
 * `issueCode`, standing in for the user typing a password on the login page.
 */
export class FakeOidcProvider {
  public readonly realm = 'test';
  public readonly clientId = 'board';
  public readonly clientSecret = 'client-secret';
  public tokenRequests: URLSearchParams[] = [];
  public accessTokenTtl = 300;

  private server!: Server;
  private privateKey!: KeyLike;
  private kid = 'k1';
  private jwk!: Record<string, unknown>;
  private codes = new Map<string, PendingCode>();
  private refreshTokens = new Map<string, FakeUser>();

  public url = '';

  get issuer(): string {
    return `${this.url}/realms/${this.realm}`;
  }

  async start(): Promise<void> {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    this.privateKey = privateKey;
    this.jwk = { ...(await exportJWK(publicKey)), kid: this.kid, alg: 'RS256', use: 'sig' };

    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', this.url);
      const prefix = `/realms/${this.realm}`;
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };

      if (url.pathname === `${prefix}/.well-known/openid-configuration`) {
        return json(200, {
          issuer: this.issuer,
          authorization_endpoint: `${this.issuer}/protocol/openid-connect/auth`,
          token_endpoint: `${this.issuer}/protocol/openid-connect/token`,
          jwks_uri: `${this.issuer}/protocol/openid-connect/certs`,
          end_session_endpoint: `${this.issuer}/protocol/openid-connect/logout`,
        });
      }
      if (url.pathname === `${prefix}/protocol/openid-connect/certs`) {
        return json(200, { keys: [this.jwk] });
      }
      if (url.pathname === `${prefix}/protocol/openid-connect/token` && req.method === 'POST') {
        let raw = '';
        req.on('data', (chunk) => (raw += chunk));
        req.on('end', () => {
          const params = new URLSearchParams(raw);
          this.tokenRequests.push(params);
          this.handleToken(params).then(
            ([status, body]) => json(status, body),
            (error) => json(500, { error: String(error) })
          );
        });
        return;
      }

      json(404, { error: 'not_found' });
    });

    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** What the login page would do: bind a code to the PKCE challenge of the auth request. */
  issueCode(authorizeUrl: string, user: FakeUser): { code: string; state: string } {
    const url = new URL(authorizeUrl);
    const code = randomBytes(8).toString('hex');
    this.codes.set(code, {
      user,
      challenge: url.searchParams.get('code_challenge')!,
      nonce: url.searchParams.get('nonce')!,
      redirectUri: url.searchParams.get('redirect_uri')!,
    });

    return { code, state: url.searchParams.get('state')! };
  }

  revokeRefreshTokens(): void {
    this.refreshTokens.clear();
  }

  async sign(claims: JWTPayload, { expiresIn = 300, issuer = this.issuer } = {}): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: this.kid })
      .setIssuer(issuer)
      .setIssuedAt(now)
      .setExpirationTime(now + expiresIn)
      .sign(this.privateKey);
  }

  async accessToken(
    user: FakeUser,
    overrides: { expiresIn?: number; issuer?: string; azp?: string } = {}
  ) {
    return this.sign(
      {
        sub: user.sub,
        preferred_username: user.preferred_username,
        name: user.name,
        email: user.email,
        aud: 'account',
        azp: overrides.azp ?? this.clientId,
        realm_access: { roles: user.realmRoles ?? [] },
        resource_access: { [this.clientId]: { roles: user.clientRoles ?? [] } },
      },
      { expiresIn: overrides.expiresIn ?? this.accessTokenTtl, issuer: overrides.issuer }
    );
  }

  private async tokensFor(user: FakeUser, nonce?: string) {
    const refreshToken = randomBytes(24).toString('base64url');
    this.refreshTokens.set(refreshToken, user);

    return {
      access_token: await this.accessToken(user),
      id_token: await this.sign({
        sub: user.sub,
        preferred_username: user.preferred_username,
        email: user.email,
        name: user.name,
        aud: this.clientId,
        nonce,
      }),
      refresh_token: refreshToken,
      expires_in: this.accessTokenTtl,
      refresh_expires_in: 1800,
      token_type: 'Bearer',
    };
  }

  private async handleToken(params: URLSearchParams): Promise<[number, unknown]> {
    if (
      params.get('client_id') !== this.clientId ||
      params.get('client_secret') !== this.clientSecret
    ) {
      return [401, { error: 'invalid_client' }];
    }

    if (params.get('grant_type') === 'authorization_code') {
      const pending = this.codes.get(params.get('code') ?? '');
      this.codes.delete(params.get('code') ?? '');
      if (!pending) return [400, { error: 'invalid_grant' }];
      const verifier = params.get('code_verifier') ?? '';
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      if (challenge !== pending.challenge)
        return [400, { error: 'invalid_grant', error_description: 'PKCE' }];
      if (params.get('redirect_uri') !== pending.redirectUri)
        return [400, { error: 'invalid_grant' }];

      return [200, await this.tokensFor(pending.user, pending.nonce)];
    }

    if (params.get('grant_type') === 'refresh_token') {
      const user = this.refreshTokens.get(params.get('refresh_token') ?? '');
      if (!user) return [400, { error: 'invalid_grant' }];

      return [200, await this.tokensFor(user)];
    }

    return [400, { error: 'unsupported_grant_type' }];
  }
}
