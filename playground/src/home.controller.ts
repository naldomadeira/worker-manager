import { Controller, Get, Header } from '@nestjs/common';
import { config } from './config';

@Controller()
export class HomeController {
  @Get()
  @Header('content-type', 'text/html; charset=utf-8')
  home() {
    return `<!doctype html><meta charset="utf-8"><title>Worker Manager playground</title>
<body style="font-family:system-ui;max-width:40rem;margin:4rem auto;line-height:1.6">
<h1>Worker Manager playground</h1>
<p>Auth mode: <b>${config.auth}</b>. Open the <a href="/queues">dashboard</a>.</p>
<ul>
  <li>basic: <code>${config.basic.username}</code> / <code>${config.basic.password}</code></li>
  <li>keycloak: <code>admin/admin</code> (has <code>wm-admin</code>), <code>viewer/viewer</code> (forbidden)</li>
</ul></body>`;
  }

  @Get('health')
  health() {
    return { status: 'ok', auth: config.auth };
  }
}
