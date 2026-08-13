import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { LibraryService } from './library.service';
import { CreateItemDto } from './dto/create-item.dto';
import { CreateMemberDto } from './dto/create-member.dto';
import { IssueLoanDto } from './dto/issue-loan.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { LIBRARY_TEAM } from '../../common/auth/role-groups';

/** library.controller.ts — SRS Chapter 28 (FR-OPS-010). LIBRARY_TEAM
 * (LEADERSHIP + 'librarian', Chapter 3.2's dedicated role for this
 * domain) for every endpoint, read and write alike — least-privilege
 * default (Chapter 33.1) rather than guessing at a broader read
 * requirement the SRS doesn't state; widen later if a real need surfaces. */
@Controller('v1/library')
export class LibraryController {
  constructor(private readonly library: LibraryService) {}

  @Roles(...LIBRARY_TEAM)
  @Post('items')
  createItem(@Body() body: CreateItemDto) {
    return this.library.createItem(body);
  }

  @Roles(...LIBRARY_TEAM)
  @Get('items')
  findAllItems() {
    return this.library.findAllItems();
  }

  @Roles(...LIBRARY_TEAM)
  @Get('items/:id')
  findItem(@Param('id') id: string) {
    return this.library.findItem(id);
  }

  @Roles(...LIBRARY_TEAM)
  @Post('members')
  createMember(@Body() body: CreateMemberDto) {
    return this.library.createMember(body);
  }

  @Roles(...LIBRARY_TEAM)
  @Get('members')
  findAllMembers() {
    return this.library.findAllMembers();
  }

  @Roles(...LIBRARY_TEAM)
  @Get('members/:id')
  findMember(@Param('id') id: string) {
    return this.library.findMember(id);
  }

  @Roles(...LIBRARY_TEAM)
  @Post('loans')
  issueLoan(@Body() body: IssueLoanDto) {
    return this.library.issueLoan(body);
  }

  @Roles(...LIBRARY_TEAM)
  @Get('loans')
  findAllLoans() {
    return this.library.findAllLoans();
  }

  @Roles(...LIBRARY_TEAM)
  @Get('loans/:id')
  findLoan(@Param('id') id: string) {
    return this.library.findLoan(id);
  }

  @Roles(...LIBRARY_TEAM)
  @Post('loans/:id/renew')
  renewLoan(@Param('id') id: string) {
    return this.library.renewLoan(id);
  }

  @Roles(...LIBRARY_TEAM)
  @Post('loans/:id/return')
  returnLoan(@Param('id') id: string) {
    return this.library.returnLoan(id);
  }

  @Roles(...LIBRARY_TEAM)
  @Post('loans/:id/pay-fine')
  payFine(@Param('id') id: string) {
    return this.library.payFine(id);
  }
}
