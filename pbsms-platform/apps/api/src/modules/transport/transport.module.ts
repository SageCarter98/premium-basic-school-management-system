import { Module } from '@nestjs/common';
import { TransportController } from './transport.controller';
import { TransportService } from './transport.service';

@Module({
  controllers: [TransportController],
  providers: [TransportService],
})
export class TransportModule {}
