import { Logger, MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { UsersModule } from './users/users.module';
import { OrdersModule } from './orders/orders.module';
import { ProductsModule } from './products/products.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { IdempotencyModule } from './Idempotency/idempotency.module';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { SmokeModule } from './smoke/smoke.module';
import { RequestContextMiddleware } from './common/request-context.middleware';
import { GraphQLError, GraphQLFormattedError } from 'graphql';

const logger = new Logger('GraphQL');

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env.${process.env.NODE_ENV || 'example'}`,
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 5432,
      username: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      autoLoadEntities: true,
      synchronize: false,
      logging: ['query'],
    }),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      typePaths: ['src/graphql/*.graphql', 'dist/src/graphql/*.graphql'],
      resolvers: {
        OrderStatus: {
          CREATED: 'CREATED',
          PAID: 'PAID',
          CANCELLED: 'CANCELLED',
        },
      },
      playground: {
        tabs: [
          {
            endpoint: '/graphql',
            query: `query { hello }`,
          },
        ],
      },
      formatError: (formattedError: GraphQLFormattedError, error: unknown) => {
        const originalError =
          error instanceof GraphQLError ? error.originalError : error;

        logger.error(
          formattedError.message,
          originalError instanceof Error ? originalError.stack : undefined,
        );

        const extensions = formattedError.extensions;

        if (
          extensions?.code === 'BAD_USER_INPUT' ||
          extensions?.code === 'GRAPHQL_VALIDATION_FAILED' ||
          extensions?.code === 'BAD_REQUEST'
        ) {
          return formattedError;
        }

        if (extensions?.code === 'INTERNAL_SERVER_ERROR') {
          return {
            message: formattedError.message,
            extensions: { code: 'INTERNAL_SERVER_ERROR' },
          };
        }

        return formattedError;
      },
    }),
    SmokeModule,
    OrdersModule,
    ProductsModule,
    UsersModule,
    IdempotencyModule,
  ],
})

export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes({
      path: 'graphql',
      method: RequestMethod.ALL
    });
  }
}
