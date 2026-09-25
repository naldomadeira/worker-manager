import { INestApplication, Module } from '@nestjs/common';
import { uiFixtureBasePath } from '@worker-manager/test-utils';
import { WorkerManagerModule } from '../../src';
import { boot, http, platforms } from '../support/app';
import { FakeOidcProvider } from '../support/fake-oidc';

describe.each(platforms)('Keycloak scenario on %s', (platform) => {
  const idp = new FakeOidcProvider();
  let app: INestApplication;

  beforeAll(async () => {
    await idp.start();

    @Module({
      imports: [
        WorkerManagerModule.forRoot({
          boardOptions: { uiBasePath: uiFixtureBasePath },
          auth: {
            strategy: 'keycloak',
            url: idp.url,
            realm: idp.realm,
            clientId: idp.clientId,
            clientSecret: idp.clientSecret,
            requiredRoles: ['wm-admin'],
            cookie: { secret: 'a-test-secret-that-is-long-enough-123456' },
          },
        }),
      ],
    })
    class AppModule {}

    app = await boot(AppModule, platform);
  });

  afterAll(async () => {
    await app?.close();
    await idp.stop();
  });

  it('redirects a browser navigation to the authorize endpoint with PKCE', async () => {
    const res = await http(app).get('/queues').set('Accept', 'text/html');
    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(`${location.origin}${location.pathname}`).toBe(idp.authorizationEndpoint);
    expect(location.searchParams.get('code_challenge')).toBeTruthy();
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('answers 401 JSON to an API call without a token', async () => {
    const res = await http(app).get('/queues/api/queues');
    expect(res.status).toBe(401);
    expect(JSON.parse(res.text).error).toEqual({ key: 'ERRORS.UNAUTHORIZED' });
  });

  it('accepts a bearer token carrying the required role', async () => {
    const token = await idp.accessToken('alice', ['wm-admin']);
    const res = await http(app).get('/queues/api/queues').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('answers 403 to a bearer token without the required role', async () => {
    const token = await idp.accessToken('bob', ['wm-viewer']);
    const res = await http(app).get('/queues/api/queues').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.text).error).toEqual({ key: 'ERRORS.FORBIDDEN' });
  });
});
