import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { UpsertBrandingDto } from './dto/upsert-branding.dto';
import { GenerateReportCardDto } from './dto/generate-report-card.dto';
import { GenerateTranscriptDto } from './dto/generate-transcript.dto';
import { GenerateAdmissionLetterDto } from './dto/generate-admission-letter.dto';
import { GenerateCompletionCertificateDto } from './dto/generate-completion-certificate.dto';
import { GenerateReceiptDto } from './dto/generate-receipt.dto';
import { RevokeDocumentDto } from './dto/revoke-document.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { ACADEMIC_STAFF, ACADEMIC_ADMIN, LEADERSHIP } from '../../common/auth/role-groups';

// Generated documents span academic (report cards, transcripts) and
// finance (receipts) document types — a straight ACADEMIC_STAFF list
// would wrongly exclude accountant from reading their own receipts.
const DOCUMENT_READERS = [...ACADEMIC_STAFF, 'accountant'];
const RECEIPT_ROLES = [...LEADERSHIP, 'accountant'];

/** documents.controller.ts — SRS Chapter 22.1. 'verify' stays
 * unrestricted-by-role — it's a public, unauthenticated route (see
 * tenant.middleware.ts's PUBLIC_PATHS), which never reaches RolesGuard's
 * resolved TenantContextStore in the first place. Issuing an official
 * document (report card/transcript/letter/certificate) is an
 * ACADEMIC_ADMIN act; revoking one already issued is reserved for
 * LEADERSHIP, same seriousness tier as Finance's reversal/approval. */
@Controller('v1/documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('verify')
  verify(@Query('token') token: string) {
    return this.documents.verify(token);
  }

  @Roles(...DOCUMENT_READERS)
  @Get('branding')
  getBranding() {
    return this.documents.getBranding();
  }

  @Roles(...LEADERSHIP)
  @Post('branding')
  upsertBranding(@Body() body: UpsertBrandingDto) {
    return this.documents.upsertBranding(body);
  }

  @Roles(...DOCUMENT_READERS)
  @Get()
  findAll() {
    return this.documents.findAll();
  }

  @Roles(...DOCUMENT_READERS)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.documents.findOne(id);
  }

  @Roles(...LEADERSHIP)
  @Post(':id/revoke')
  revoke(@Param('id') id: string, @Body() body: RevokeDocumentDto) {
    return this.documents.revoke(id, body);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('report-cards')
  generateReportCard(@Body() body: GenerateReportCardDto) {
    return this.documents.generateReportCard(body);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('transcripts')
  generateTranscript(@Body() body: GenerateTranscriptDto) {
    return this.documents.generateTranscript(body);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('admission-letters')
  generateAdmissionLetter(@Body() body: GenerateAdmissionLetterDto) {
    return this.documents.generateAdmissionLetter(body);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('completion-certificates')
  generateCompletionCertificate(@Body() body: GenerateCompletionCertificateDto) {
    return this.documents.generateCompletionCertificate(body);
  }

  @Roles(...RECEIPT_ROLES)
  @Post('receipts')
  generateReceipt(@Body() body: GenerateReceiptDto) {
    return this.documents.generateReceipt(body);
  }
}
