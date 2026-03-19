import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-items.entity';
import { Product } from 'src/products/entities/product.entity';
import { Idempotency } from 'src/Idempotency/entities/idempotency.entity';
import { IdempotencyModule } from 'src/Idempotency/idempotency.module';
import { DatabaseModule } from 'src/db/db.module';
import {
  OrderResolver,
  OrderItemResolver,
  OrderNaiveResolver,
  OrderItemNaiveResolver,
} from './order.resovler';
import { ProductsModule } from 'src/products/products.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, Product, Idempotency]),
    IdempotencyModule,
    DatabaseModule,
    ProductsModule,
  ],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    OrderResolver,
    OrderItemResolver,
    OrderNaiveResolver,
    OrderItemNaiveResolver,
  ],
})
export class OrdersModule {}
