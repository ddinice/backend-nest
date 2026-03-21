import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { OrdersController } from '../src/app-service/orders/orders.controller';
import { OrdersService } from '../src/app-service/orders/orders.service';
import { PaymentsGrpcClient } from '../src/app-service/grpc-client/payments-grpc.client';
import type { AuthorizeRequest, AuthorizeResponse } from '../src/app-service/grpc-client/interfaces/payments.interface';
import { Order, OrderStatus } from '../src/app-service/orders/entities/order.entity';

describe('Orders -> Payments.Authorize (e2e)', () => {
  let app: INestApplication;

  const orderId = '33333333-3333-3333-3333-333333333333';

  const existingOrder: Order = {
    id: orderId,
    items: [],
    status: OrderStatus.PENDING,
    createdAt: new Date(),
    processedAt: null,
    updatedAt: new Date(),
  };

  const authorizeMock = jest.fn(
    async (payload: AuthorizeRequest): Promise<AuthorizeResponse> => ({
      paymentId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      status: 'PAYMENT_STATUS_AUTHORIZED',
      message: 'Payment authorized',
      providerRef: `card-${payload.orderId.slice(0, 8)}`,
      schemaVersion: 2,
    }),
  );

  const ordersServiceMock = {
    createOrder: jest.fn().mockResolvedValue(existingOrder),
    findById: jest.fn().mockImplementation((id: string) =>
      id === orderId ? Promise.resolve(existingOrder) : Promise.resolve(null),
    ),
    markOrderPaymentResult: jest.fn().mockResolvedValue(undefined),
    findAll: jest.fn(),
    deleteById: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        { provide: OrdersService, useValue: ordersServiceMock },
        {
          provide: PaymentsGrpcClient,
          useValue: {
            onModuleInit: () => {},
            authorize: authorizeMock,
            getStatus: jest.fn(),
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('POST /orders then POST /orders/:id/pay calls Authorize and returns payment', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/orders')
      .send({
        items: [
          {
            productId: '11111111-1111-1111-1111-111111111111',
            quantity: 1,
          },
        ],
      })
      .expect(201);

    expect(createRes.body.id).toBe(orderId);

    const payRes = await request(app.getHttpServer())
      .post(`/orders/${orderId}/pay`)
      .send({
        amount: '100.00',
        currency: 'USD',
        paymentMethod: 'card',
      })
      .expect(201);

    expect(payRes.body.paymentId).toBeDefined();
    expect(payRes.body.status).toBeDefined();

    expect(authorizeMock).toHaveBeenCalledTimes(1);
    expect(authorizeMock.mock.calls[0][0]).toMatchObject({
      orderId,
      total: { amount: '100.00', currency: 'USD' },
      paymentMethod: 'card',
    });
    expect(ordersServiceMock.markOrderPaymentResult).toHaveBeenCalled();
  });
});
