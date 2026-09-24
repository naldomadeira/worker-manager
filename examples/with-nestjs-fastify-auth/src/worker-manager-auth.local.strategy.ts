import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Strategy } from 'passport-local';

const { WORKER_MANAGER_USER, WORKER_MANAGER_PASSWORD } = process.env;

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super();
  }

  validate(username: string, password: string, done: any): void {
    if (username === WORKER_MANAGER_USER && password === WORKER_MANAGER_PASSWORD) {
      return done(null, { user: username });
    }
    return done(new UnauthorizedException('Invalid credentials'), false);
  }
}
