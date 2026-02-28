import { Resolver, Query } from '@nestjs/graphql';

@Resolver()
export class SmokeResolver {
  @Query(() => String)
  hello(): string {
    return 'Hello world!';
  }
}
