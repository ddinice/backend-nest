import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Channel, ChannelModel, Options } from 'amqplib';
import * as amqp from 'amqplib';
import {
  ORDERS_DLQ_QUEUE,
  ORDERS_DLQ_ROUTING_KEY,
  ORDERS_EXCHANGE,
  ORDERS_PROCESS_QUEUE,
  ORDERS_PROCESS_ROUTING_KEY,
  ORDERS_RETRY_ROUTING_KEYS,
} from './rabbitmq.constants';

@Injectable()
export class RabbitmqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitmqService.name);
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const url = this.configService.getOrThrow<string>('RABBITMQ_URL');
    const prefetch = Number(
      this.configService.get<string>('RABBITMQ_PREFETCH') ?? '10',
    );

    const client = await amqp.connect(url);
    const ch = await client.createChannel();

    this.connection = client;
    this.channel = ch;

    await ch.prefetch(prefetch);

    await this.assertInfrastructure();

    this.logger.log(`RabbitMQ connected (prefetch=${prefetch})`);
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.channel?.close();
    } finally {
      await this.connection?.close();
    }
  }

  publishToQueue(
    queueName: string,
    message: any,
    headers: Record<string, any>,
  ): boolean {
    const channel = this.getChannel();
    const body = Buffer.from(JSON.stringify(message));

    return channel.sendToQueue(queueName, body, { headers });
  }

  publishToExchange(
    exchange: string,
    routingKey: string,
    message: unknown,
    options?: Options.Publish,
  ): boolean {
    const channel = this.getChannel();
    const body = Buffer.from(JSON.stringify(message));

    return channel.publish(exchange, routingKey, body, {
      persistent: true,
      contentType: 'application/json',
      ...options,
    });
  }

  getChannel(): Channel {
    if (!this.channel) {
      throw new Error('Channel not connected');
    }
    return this.channel;
  }

  private async assertInfrastructure(): Promise<void> {
    const ch = this.getChannel();
    const retryDelaysMs = this.getRetryDelaysMs();

    await ch.assertExchange(ORDERS_EXCHANGE, 'direct', { durable: true });
    await ch.assertQueue(ORDERS_PROCESS_QUEUE, { durable: true });
    await ch.assertQueue(ORDERS_DLQ_QUEUE, { durable: true });
    await ch.bindQueue(
      ORDERS_PROCESS_QUEUE,
      ORDERS_EXCHANGE,
      ORDERS_PROCESS_ROUTING_KEY,
    );
    await ch.bindQueue(
      ORDERS_DLQ_QUEUE,
      ORDERS_EXCHANGE,
      ORDERS_DLQ_ROUTING_KEY,
    );

    for (let idx = 0; idx < ORDERS_RETRY_ROUTING_KEYS.length; idx += 1) {
      const routingKey = ORDERS_RETRY_ROUTING_KEYS[idx];
      const ttl = retryDelaysMs[idx];
      await ch.assertQueue(routingKey, {
        durable: true,
        arguments: {
          'x-message-ttl': ttl,
          'x-dead-letter-exchange': ORDERS_EXCHANGE,
          'x-dead-letter-routing-key': ORDERS_PROCESS_ROUTING_KEY,
        },
      });
      await ch.bindQueue(routingKey, ORDERS_EXCHANGE, routingKey);
    }

    await ch.assertQueue('payments.jobs', { durable: true });
    await ch.assertQueue('payments.dlq', { durable: true });

    await ch.assertQueue('domain.events', { durable: true });
  }

  private getRetryDelaysMs(): number[] {
    const raw =
      this.configService.get<string>('ORDERS_RETRY_DELAY_MS') ??
      '5000,15000,30000';
    const parsed = raw
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value) && value > 0);

    if (parsed.length >= ORDERS_RETRY_ROUTING_KEYS.length) {
      return parsed.slice(0, ORDERS_RETRY_ROUTING_KEYS.length);
    }

    const fallback = [5000, 15000, 30000];
    return fallback.slice(0, ORDERS_RETRY_ROUTING_KEYS.length);
  }
}
