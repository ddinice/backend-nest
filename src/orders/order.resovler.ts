import { Resolver, Query, Args, Mutation, ResolveField, Parent } from '@nestjs/graphql';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrdersService } from './orders.service';
import { ProductLoader } from '../products/product.loader';
import { Product } from '../products/entities/product.entity';

@Resolver('Order')
export class OrderResolver {
  private readonly logger = new Logger(OrderResolver.name);

  constructor(private readonly ordersService: OrdersService) {}

  @Query('orders')
  async orders(
    @Args('filter') filter?: Record<string, any>,
    @Args('pagination') pagination?: Record<string, any>,
  ) {
    this.logger.log('orders query (DataLoader)');
    return this.ordersService.findOrders(filter, pagination);
  }

  @Mutation('createOrder')
  async createOrder(@Args('input') input: any) {
    return this.ordersService.createOrderFromGraphQL(input);
  }
}

// DataLoader (batched)
@Resolver('OrderItem')
export class OrderItemResolver {
  constructor(private readonly productLoader: ProductLoader) {}

  @ResolveField('product')
  async product(@Parent() orderItem: { productId: string }) {
    return this.productLoader.load(orderItem.productId);
  }
}

// ─── Naive Order Resolver (N+1 demo)
@Resolver('OrderNaive')
export class OrderNaiveResolver {
  private readonly logger = new Logger(OrderNaiveResolver.name);

  constructor(private readonly ordersService: OrdersService) {}

  @Query('ordersNaive')
  async ordersNaive(
    @Args('filter') filter?: Record<string, any>,
    @Args('pagination') pagination?: Record<string, any>,
  ) {
    this.logger.warn('ordersNaive query (N+1 — no DataLoader)');
    return this.ordersService.findOrders(filter, pagination);
  }
}

// N+1
@Resolver('OrderItemNaive')
export class OrderItemNaiveResolver {
  private readonly logger = new Logger(OrderItemNaiveResolver.name);

  constructor(
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
  ) {}

  @ResolveField('product')
  async product(@Parent() orderItem: { productId: string }) {
    this.logger.debug(`N+1 hit → SELECT product WHERE id = ${orderItem.productId}`);
    return this.productsRepository.findOneByOrFail({ id: orderItem.productId });
  }
}
