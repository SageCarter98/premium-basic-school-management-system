import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { DelegationsService } from './delegations.service';
import { CreateDelegationDto } from './dto/create-delegation.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { ALL_STAFF } from '../../common/auth/role-groups';

/**
 * delegations.controller.ts — Chapter 13.4. Broad ALL_STAFF access for
 * create/revoke/list, same "the service's own checks are the real gate"
 * shape as guardians.controller.ts — create() itself already refuses to
 * let anyone delegate a role they don't hold, so a narrower controller-
 * level role list would only add friction, not safety.
 */
@Controller('v1/delegations')
export class DelegationsController {
  constructor(private readonly delegations: DelegationsService) {}

  @Roles(...ALL_STAFF)
  @Post()
  create(@Body() body: CreateDelegationDto) {
    return this.delegations.create(body);
  }

  @Roles(...ALL_STAFF)
  @Post(':id/revoke')
  revoke(@Param('id') id: string) {
    return this.delegations.revoke(id);
  }

  @Roles(...ALL_STAFF)
  @Get()
  list(@Query('recipientId') recipientId?: string, @Query('delegatorId') delegatorId?: string) {
    return this.delegations.list({ recipientId, delegatorId });
  }
}
