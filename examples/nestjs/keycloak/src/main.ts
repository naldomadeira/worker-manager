import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = Number(app.get(ConfigService).get('PORT', 3012));
  await app.listen(port);
  console.log(`Worker Manager: http://localhost:${port}/queues`);
}

bootstrap();
