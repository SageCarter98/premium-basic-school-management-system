import { Module } from '@nestjs/common';
import { NaccaController } from './nacca.controller';
import { NaccaService } from './nacca.service';

@Module({
  controllers: [NaccaController],
  providers: [NaccaService],
})
export class NaccaModule {}
