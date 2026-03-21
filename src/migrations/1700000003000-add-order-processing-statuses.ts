import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderProcessingStatuses1700000003000 implements MigrationInterface {
  name = 'AddOrderProcessingStatuses1700000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "orders_status_enum" ADD VALUE IF NOT EXISTS 'PENDING'`,
    );
    await queryRunner.query(
      `ALTER TYPE "orders_status_enum" ADD VALUE IF NOT EXISTS 'PROCESSED'`,
    );
  }

  public async down(): Promise<void> {}
}
