/**
 * product-feedback.service.ts
 *
 * Writes into a platform-category table (0046_product_feedback.sql), not
 * a tenant-owned one — uses PG_POOL directly rather than the request-
 * scoped TenantDatabaseService, since RLS/tenant-scoping doesn't apply
 * here at all. tenant_ref is a one-way HMAC-SHA256 of the caller's real
 * tenant_id, computed here (never the raw id) — same "reuse an existing
 * secret rather than mint a new one just for this" call auth.module.ts's
 * own JWT_SECRET usage already established; no new required env var.
 */

import { createHmac } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/database/tenant-database.service';
import { SubmitProductFeedbackDto } from './dto/submit-product-feedback.dto';

function hashTenantId(tenantId: string): string {
  const pepper = process.env.JWT_SECRET ?? 'CHANGE_ME_IN_ENV_NEVER_COMMIT_A_REAL_SECRET';
  return createHmac('sha256', pepper).update(tenantId).digest('hex');
}

@Injectable()
export class ProductFeedbackService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async submit(tenantId: string, roleCodes: string[], input: SubmitProductFeedbackDto): Promise<void> {
    await this.pool.query(
      `insert into product_feedback (tenant_ref, role_codes, category, subject, message, screen)
       values ($1, $2, $3, $4, $5, $6)`,
      [hashTenantId(tenantId), roleCodes, input.category, input.subject, input.message, input.screen ?? null],
    );
  }
}
