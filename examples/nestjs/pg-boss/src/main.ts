import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { boss } from './boss';

async function bootstrap() {
  await boss.start();
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3013);
  await app.listen(port);
  console.log(`Worker Manager: http://localhost:${port}/pg-boss`);
}

bootstrap();
