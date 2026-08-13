import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { CreateItemDto } from './dto/create-item.dto';
import { ReceiveStockDto } from './dto/receive-stock.dto';
import { IssueStockDto } from './dto/issue-stock.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { INVENTORY_TEAM } from '../../common/auth/role-groups';

/** inventory.controller.ts — SRS Chapter 28 (FR-OPS-050). INVENTORY_TEAM
 * (LEADERSHIP + 'storekeeper') for every endpoint — same least-privilege
 * default as library/transport.controller.ts. */
@Controller('v1/inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Roles(...INVENTORY_TEAM)
  @Post('items')
  createItem(@Body() body: CreateItemDto) {
    return this.inventory.createItem(body);
  }

  @Roles(...INVENTORY_TEAM)
  @Get('items')
  findAllItems() {
    return this.inventory.findAllItems();
  }

  @Roles(...INVENTORY_TEAM)
  @Get('items/:id')
  findItem(@Param('id') id: string) {
    return this.inventory.findItem(id);
  }

  @Roles(...INVENTORY_TEAM)
  @Post('items/:id/receive')
  receiveStock(@Param('id') id: string, @Body() body: ReceiveStockDto) {
    return this.inventory.receiveStock(id, body);
  }

  @Roles(...INVENTORY_TEAM)
  @Post('items/:id/issue')
  issueStock(@Param('id') id: string, @Body() body: IssueStockDto) {
    return this.inventory.issueStock(id, body);
  }

  @Roles(...INVENTORY_TEAM)
  @Get('issuances')
  findAllIssuances() {
    return this.inventory.findAllIssuances();
  }

  @Roles(...INVENTORY_TEAM)
  @Get('alerts')
  findAlerts() {
    return this.inventory.findAlerts();
  }
}
