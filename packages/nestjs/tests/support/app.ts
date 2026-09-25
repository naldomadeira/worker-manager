import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import request from 'supertest';

export type Platform = 'express' | 'fastify';

export const platforms: Platform[] = ['express', 'fastify'];

export async function boot(
  AppModule: any,
  platform: Platform = 'express',
  configure?: (app: INestApplication) => void
): Promise<INestApplication> {
  const httpAdapter = platform === 'express' ? new ExpressAdapter() : new FastifyAdapter();
  const app = await NestFactory.create(AppModule, httpAdapter as any, { logger: false });
  configure?.(app);
  await app.init();
  if (platform === 'fastify') await app.getHttpAdapter().getInstance().ready();
  return app;
}

export const http = (app: INestApplication) => request(app.getHttpServer());

export const basic = (username: string, password: string) =>
  `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

export const queueNames = (res: { text: string }): string[] =>
  JSON.parse(res.text).queues.map((queue: { name: string }) => queue.name);
