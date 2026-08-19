import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { FinanceService } from './finance.service';
import { Roles } from '../../common/auth/roles.decorator';
import { SensitiveAction } from '../../common/auth/sensitive-action.decorator';
import { CreateFeeStructureDto } from './dto/create-fee-structure.dto';
import { AddFeeStructureItemDto } from './dto/add-fee-structure-item.dto';
import { AddInstalmentDto } from './dto/add-instalment.dto';
import { GenerateInvoiceDto } from './dto/generate-invoice.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { AllocatePaymentDto } from './dto/allocate-payment.dto';
import { RequestAssistanceDto } from './dto/request-assistance.dto';
import { RejectAssistanceDto } from './dto/reject-assistance.dto';
import { ReversePaymentDto } from './dto/reverse-payment.dto';
import { ReverseAssistanceDto } from './dto/reverse-assistance.dto';
import { CancelInvoiceDto } from './dto/cancel-invoice.dto';
import { CreatePenaltyRuleDto } from './dto/create-penalty-rule.dto';
import { ApplyPenaltyDto } from './dto/apply-penalty.dto';
import { ReversePenaltyChargeDto } from './dto/reverse-penalty-charge.dto';
import { CreateSettlementBatchDto } from './dto/create-settlement-batch.dto';
import { AddSettlementLineDto } from './dto/add-settlement-line.dto';
import { MatchSettlementLineDto } from './dto/match-settlement-line.dto';

/** finance.controller.ts — SRS Chapter 23 / 24. Chapter 13's role model
 * only enumerates 'Accountant/Bursar', not a separate 'Cashier' — so this
 * pass treats 'accountant' as the day-to-day recording role and reserves
 * the approval/reversal tier for 'proprietor'/'administrator'/'headmaster',
 * which is what actually operationalizes Chapter 33.3's "Cashier cannot
 * approve own reversal" / "high-privilege role assignment receives extra
 * review" examples with the roles this codebase's seed data actually has.
 * FR-PAY-040's maker-checker separation between recording and allocating
 * itself (a different user must record vs. allocate) is still a Phase 1
 * build item — this only adds the role-tier check on top of it. */
const READ_ROLES = ['proprietor', 'administrator', 'headmaster', 'accountant'];
const RECORD_ROLES = ['proprietor', 'administrator', 'headmaster', 'accountant'];
const APPROVE_ROLES = ['proprietor', 'administrator', 'headmaster'];

@Controller('v1/finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Roles(...RECORD_ROLES)
  @Post('fee-structures')
  createFeeStructure(@Body() body: CreateFeeStructureDto) {
    return this.finance.createFeeStructure(body);
  }

  @Roles(...READ_ROLES)
  @Get('fee-structures')
  findAllFeeStructures() {
    return this.finance.findAllFeeStructures();
  }

  @Roles(...READ_ROLES)
  @Get('fee-structures/:id')
  findFeeStructure(@Param('id') id: string) {
    return this.finance.findFeeStructure(id);
  }

  @Roles(...RECORD_ROLES)
  @Post('fee-structures/:id/items')
  addFeeStructureItem(@Param('id') id: string, @Body() body: AddFeeStructureItemDto) {
    return this.finance.addFeeStructureItem(id, body);
  }

  @Roles(...READ_ROLES)
  @Get('fee-structures/:id/items')
  findFeeStructureItems(@Param('id') id: string) {
    return this.finance.findFeeStructureItems(id);
  }

  @Roles(...RECORD_ROLES)
  @Post('fee-structures/:id/instalments')
  addInstalment(@Param('id') id: string, @Body() body: AddInstalmentDto) {
    return this.finance.addInstalment(id, body);
  }

  @Roles(...READ_ROLES)
  @Get('fee-structures/:id/instalments')
  findInstalments(@Param('id') id: string) {
    return this.finance.findInstalments(id);
  }

  @Roles(...RECORD_ROLES)
  @Post('fee-structures/:id/activate')
  activateFeeStructure(@Param('id') id: string) {
    return this.finance.activateFeeStructure(id);
  }

  @Roles(...RECORD_ROLES)
  @Post('invoices')
  generateInvoice(@Body() body: GenerateInvoiceDto) {
    return this.finance.generateInvoice(body);
  }

  @Roles(...READ_ROLES)
  @Get('invoices')
  findAllInvoices() {
    return this.finance.findAllInvoices();
  }

  @Roles(...READ_ROLES)
  @Get('invoices/:id')
  findInvoice(@Param('id') id: string) {
    return this.finance.findInvoice(id);
  }

  @Roles(...READ_ROLES)
  @Get('invoices/:id/items')
  findInvoiceItems(@Param('id') id: string) {
    return this.finance.findInvoiceItems(id);
  }

  @Roles(...READ_ROLES)
  @Get('invoices/:id/balance')
  findInvoiceBalance(@Param('id') id: string) {
    return this.finance.findInvoiceBalance(id);
  }

  @Roles(...READ_ROLES)
  @Get('invoices/:id/allocations')
  findAllocationsForInvoice(@Param('id') id: string) {
    return this.finance.findAllocationsForInvoice(id);
  }

  @Roles(...RECORD_ROLES)
  @Post('fee-structures/:id/penalty-rules')
  createPenaltyRule(@Param('id') id: string, @Body() body: CreatePenaltyRuleDto) {
    return this.finance.createPenaltyRule(id, body);
  }

  @Roles(...READ_ROLES)
  @Get('fee-structures/:id/penalty-rules')
  findPenaltyRulesForStructure(@Param('id') id: string) {
    return this.finance.findPenaltyRulesForStructure(id);
  }

  @Roles(...READ_ROLES)
  @Get('invoices/:id/penalties')
  findPenaltiesForInvoice(@Param('id') id: string) {
    return this.finance.findPenaltiesForInvoice(id);
  }

  @Roles(...RECORD_ROLES)
  @Post('invoices/:id/penalties/apply')
  applyPenalty(@Param('id') id: string, @Body() body: ApplyPenaltyDto) {
    return this.finance.applyPenalty(id, body);
  }

  @Roles(...APPROVE_ROLES)
  @SensitiveAction('financial_reversal')
  @Post('penalties/:id/reverse')
  reversePenaltyCharge(@Param('id') id: string, @Body() body: ReversePenaltyChargeDto) {
    return this.finance.reversePenaltyCharge(id, body);
  }

  @Roles(...RECORD_ROLES)
  @Post('payments')
  recordPayment(@Body() body: RecordPaymentDto) {
    return this.finance.recordPayment(body);
  }

  @Roles(...READ_ROLES)
  @Get('payments')
  findAllPayments() {
    return this.finance.findAllPayments();
  }

  @Roles(...READ_ROLES)
  @Get('payments/:id')
  findPayment(@Param('id') id: string) {
    return this.finance.findPayment(id);
  }

  @Roles(...READ_ROLES)
  @Get('payments/:id/allocations')
  findAllocationsForPayment(@Param('id') id: string) {
    return this.finance.findAllocationsForPayment(id);
  }

  @Roles(...RECORD_ROLES)
  @Post('payments/:id/allocate')
  allocate(@Param('id') id: string, @Body() body: AllocatePaymentDto) {
    return this.finance.allocate(id, body);
  }

  @Roles(...APPROVE_ROLES)
  @Post('invoices/:id/cancel')
  cancelInvoice(@Param('id') id: string, @Body() body: CancelInvoiceDto) {
    return this.finance.cancelInvoice(id, body);
  }

  @Roles(...RECORD_ROLES)
  @Post('assistance')
  requestAssistance(@Body() body: RequestAssistanceDto) {
    return this.finance.requestAssistance(body);
  }

  @Roles(...READ_ROLES)
  @Get('assistance')
  findAllAssistance() {
    return this.finance.findAllAssistance();
  }

  @Roles(...READ_ROLES)
  @Get('assistance/:id')
  findAssistance(@Param('id') id: string) {
    return this.finance.findAssistance(id);
  }

  @Roles(...APPROVE_ROLES)
  @Post('assistance/:id/approve')
  approveAssistance(@Param('id') id: string) {
    return this.finance.approveAssistance(id);
  }

  @Roles(...APPROVE_ROLES)
  @Post('assistance/:id/second-approve')
  secondApproveAssistance(@Param('id') id: string) {
    return this.finance.secondApproveAssistance(id);
  }

  @Roles(...APPROVE_ROLES)
  @Post('assistance/:id/reject')
  rejectAssistance(@Param('id') id: string, @Body() body: RejectAssistanceDto) {
    return this.finance.rejectAssistance(id, body);
  }

  @Roles(...APPROVE_ROLES)
  @SensitiveAction('financial_reversal')
  @Post('assistance/:id/reverse')
  reverseAssistance(@Param('id') id: string, @Body() body: ReverseAssistanceDto) {
    return this.finance.reverseAssistance(id, body);
  }

  @Roles(...APPROVE_ROLES)
  @SensitiveAction('financial_reversal')
  @Post('payments/:id/reverse')
  reversePayment(@Param('id') id: string, @Body() body: ReversePaymentDto) {
    return this.finance.reversePayment(id, body);
  }

  @Roles(...READ_ROLES)
  @Get('reversals')
  findAllReversals() {
    return this.finance.findAllReversals();
  }

  @Roles(...READ_ROLES)
  @Get('reversals/:id')
  findReversal(@Param('id') id: string) {
    return this.finance.findReversal(id);
  }

  @Roles(...READ_ROLES)
  @Get('dashboard/outstanding-balances')
  outstandingBalances() {
    return this.finance.outstandingBalances();
  }

  // ---------------------------------------------------------------------
  // Settlement reconciliation (spec §8.8)
  // ---------------------------------------------------------------------

  @Roles(...RECORD_ROLES)
  @Post('settlement-batches')
  createSettlementBatch(@Body() body: CreateSettlementBatchDto) {
    return this.finance.createSettlementBatch(body);
  }

  @Roles(...READ_ROLES)
  @Get('settlement-batches')
  findAllSettlementBatches() {
    return this.finance.findAllSettlementBatches();
  }

  @Roles(...READ_ROLES)
  @Get('settlement-batches/:id')
  findSettlementBatch(@Param('id') id: string) {
    return this.finance.findSettlementBatch(id);
  }

  @Roles(...RECORD_ROLES)
  @Post('settlement-batches/:id/lines')
  addSettlementLine(@Param('id') id: string, @Body() body: AddSettlementLineDto) {
    return this.finance.addSettlementLine(id, body);
  }

  @Roles(...READ_ROLES)
  @Get('settlement-batches/:id/lines')
  findLinesForBatch(@Param('id') id: string) {
    return this.finance.findLinesForBatch(id);
  }

  @Roles(...RECORD_ROLES)
  @Post('settlement-batches/:id/auto-match')
  autoMatchSettlementBatch(@Param('id') id: string) {
    return this.finance.autoMatchSettlementBatch(id);
  }

  @Roles(...APPROVE_ROLES)
  @Post('settlement-batches/:id/close')
  closeSettlementBatch(@Param('id') id: string) {
    return this.finance.closeSettlementBatch(id);
  }

  @Roles(...RECORD_ROLES)
  @Post('settlement-lines/:id/match')
  matchSettlementLine(@Param('id') id: string, @Body() body: MatchSettlementLineDto) {
    return this.finance.matchSettlementLine(id, body);
  }

  @Roles(...RECORD_ROLES)
  @Post('settlement-lines/:id/unmatch')
  unmatchSettlementLine(@Param('id') id: string) {
    return this.finance.unmatchSettlementLine(id);
  }
}
