import { Module } from '@nestjs/common';
import { SmokeResolver } from './smoke.resolver';

@Module({
  providers: [SmokeResolver],
})
export class SmokeModule {}
