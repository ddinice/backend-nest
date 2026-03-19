import { Injectable, Scope } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import * as DataLoader from 'dataloader';
import { Product } from './entities/product.entity';

@Injectable({ scope: Scope.REQUEST })
export class ProductLoader {
  private readonly loader: DataLoader<string, Product>;

  constructor(
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
  ) {
    this.loader = new DataLoader<string, Product>(async (ids) => {
      const products = await this.productsRepository.find({
        where: { id: In(ids as string[]) },
      });

      const productMap = new Map(products.map((p) => [p.id, p]));

      return ids.map(
        (id) =>
          productMap.get(id) ??
          new Error(`Product with id "${id}" not found`),
      );
    });
  }

  load(id: string): Promise<Product> {
    return this.loader.load(id);
  }

  loadMany(ids: string[]): Promise<(Product | Error)[]> {
    return this.loader.loadMany(ids);
  }
}
