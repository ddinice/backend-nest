import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Order, OrderStatus } from './entities/order.entity';
import { Repository, DataSource, In } from 'typeorm';
import { CreateOrderDto } from './dto/create-order.dto';
import { GetOrdersQueryDto } from './dto/get-orders-query.dto';
import { OrderItem } from './entities/order-items.entity';
import { Product } from 'src/products/entities/product.entity';

export interface OrdersFilterInput {
  status?: OrderStatus;
  dateFrom?: string;
  dateTo?: string;
}

export interface OrdersPaginationInput {
  limit?: number;
  offset?: number;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,

    private readonly dataSource: DataSource,
  ) {}

  async findOrders(
    filter?: OrdersFilterInput,
    pagination?: OrdersPaginationInput,
  ) {
    const rawLimit = pagination?.limit ?? 20;
    const rawOffset = pagination?.offset ?? 0;

    if (rawLimit < 1) {
      throw new BadRequestException(
        `Invalid pagination.limit: ${rawLimit}. Must be >= 1.`,
      );
    }
    if (rawOffset < 0) {
      throw new BadRequestException(
        `Invalid pagination.offset: ${rawOffset}. Must be >= 0.`,
      );
    }

    const limit = Math.min(rawLimit, 100);
    const offset = rawOffset;

    const qb = this.ordersRepository
      .createQueryBuilder('orders')
      .leftJoinAndSelect('orders.items', 'order_items');

    if (filter?.status) {
      qb.andWhere('orders.status = :status', { status: filter.status });
    }

    if (filter?.dateFrom) {
      const dateFrom = new Date(filter.dateFrom);
      if (isNaN(dateFrom.getTime())) {
        throw new BadRequestException(
          `Invalid dateFrom value: "${filter.dateFrom}".`,
        );
      }
      qb.andWhere('orders.createdAt >= :dateFrom', { dateFrom });
    }

    if (filter?.dateTo) {
      const dateTo = new Date(filter.dateTo);
      if (isNaN(dateTo.getTime())) {
        throw new BadRequestException(
          `Invalid dateTo value: "${filter.dateTo}".`,
        );
      }
      qb.andWhere('orders.createdAt <= :dateTo', { dateTo });
    }

    qb.orderBy('orders.createdAt', 'DESC');

    const [nodes, totalCount] = await qb
      .skip(offset)
      .take(limit)
      .getManyAndCount();

    this.logger.log(`Found ${nodes.length} orders (total: ${totalCount})`);

    return {
      nodes,
      totalCount,
      pageInfo: {
        hasNextPage: offset + limit < totalCount,
        hasPreviousPage: offset > 0,
      },
    };
  }

  async getOrders(query: GetOrdersQueryDto) {
    const {
      page = 1,
      limit = 20,
      status,
      userId,
      createdFrom,
      createdTo,
      sortBy = 'createdAt',
      sortOrder = 'DESC',
    } = query;

    const qb = this.ordersRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.items', 'items');

    if (status) {
      qb.andWhere('order.status = :status', { status });
    }

    if (userId) {
      qb.andWhere('order.userId = :userId', { userId });
    }

    if (createdFrom) {
      qb.andWhere('order.createdAt >= :createdFrom', { createdFrom });
    }

    if (createdTo) {
      qb.andWhere('order.createdAt <= :createdTo', { createdTo });
    }

    qb.orderBy(`order.${sortBy}`, sortOrder);

    const [data, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async createOrder(
    dto: CreateOrderDto,
    idempotencyKey: string,
  ): Promise<Order> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const newOrder = queryRunner.manager.create(Order, {
        userId: dto.userId,
        status: OrderStatus.CREATED,
        idempotencyKey,
      });
      await queryRunner.manager.save(newOrder);

      const products = await queryRunner.manager.find(Product, {
        where: { id: In(dto.items.map((i) => i.id)) },
        lock: { mode: 'pessimistic_write' },
      });

      for (const item of dto.items) {
        const product = products.find((p) => p.id === item.id);
        if (!product)
          throw new BadRequestException(`Product ${item.id} not found`);

        const result = await queryRunner.query(
          `UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1`,
          [item.quantity, item.id],
        );

        if (result[1] === 0) {
          throw new BadRequestException(
            `Insufficient stock for product "${product.title}" (available: ${product.stock}, requested: ${item.quantity})`,
          );
        }
      }

      const orderItems = dto.items.map((item) => {
        const product = products.find((p) => p.id === item.id)!;

        return queryRunner.manager.create(OrderItem, {
          orderId: newOrder.id,
          productId: item.id,
          quantity: item.quantity,
          priceAtPurchase: product.price,
        });
      });
      await queryRunner.manager.save(orderItems);
      newOrder.items = orderItems;

      await queryRunner.commitTransaction();

      return newOrder;
    } catch (error: any) {
      await queryRunner.rollbackTransaction();

      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async createOrderFromGraphQL(input: {
    userId: string;
    idempotencyKey: string;
    items: { productId: string; quantity: number }[];
  }): Promise<Order> {
    const dto: CreateOrderDto = {
      userId: input.userId,
      items: input.items.map((item) => ({
        id: item.productId,
        quantity: item.quantity,
      })),
    };

    return this.createOrder(dto, input.idempotencyKey);
  }
}
