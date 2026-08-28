import { Injectable } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { TenantContextStore } from '../../common/tenant/tenant-context';

/**
 * Writes the FR-AIT-600 audit row. Model/question/response/cost columns
 * stay null at this stage (Chapter 47 stage 1, §47.0.2) — no model, no NL
 * question, nothing to populate them with yet. Call this from a `catch`
 * block too (log denials), not only on success — mirrors the lesson
 * write-audit-log.ts's own header already records about RolesGuard
 * denials being invisible unless explicitly logged.
 */
@Injectable()
export class AssistantInteractionLogger {
  constructor(private readonly db: TenantDatabaseService) {}

  async log(entry: {
    category: string;
    input: unknown;
    resultCount: number;
    recordIds: string[];
    denied?: { reason: string };
  }): Promise<void> {
    const { userId, roles } = TenantContextStore.current();
    await this.db.query(
      `insert into assistant_interactions
         (tenant_id, actor_user_id, actor_role_codes, request_category, request_params,
          retrieved_record_ids, result_count, status, denial_reason)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        userId,
        roles,
        entry.category,
        JSON.stringify(entry.input),
        entry.recordIds,
        entry.resultCount,
        entry.denied ? 'denied' : 'served',
        entry.denied?.reason ?? null,
      ],
    );
  }
}
