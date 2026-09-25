import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { config } from './config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(config.port);

  Logger.log(
    `Dashboard on http://localhost:${config.port}/queues` +
      (config.pgBoss ? ` and http://localhost:${config.port}/pg-boss` : '') +
      ` (auth: ${config.auth}${config.readOnly ? ', read-only' : ''})`,
    'Playground'
  );
}

bootstrap();
