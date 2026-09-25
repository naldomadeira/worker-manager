import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3011);
  await app.listen(port);
  console.log(`Worker Manager: http://localhost:${port}/queues`);
}

bootstrap();
