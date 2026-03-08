export const ORDERS_EXCHANGE = 'orders.exchange';
export const ORDERS_PROCESS_QUEUE = 'orders.process';
export const ORDERS_PROCESS_ROUTING_KEY = 'orders.process';
export const ORDERS_DLQ_QUEUE = 'orders.dlq';
export const ORDERS_DLQ_ROUTING_KEY = 'orders.dlq';

export const ORDERS_RETRY_ROUTING_KEYS = [
  'orders.retry.1',
  'orders.retry.2',
  'orders.retry.3'
] as const;
