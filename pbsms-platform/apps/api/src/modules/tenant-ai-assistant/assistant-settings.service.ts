import { ForbiddenException, Injectable } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { TenantContextStore } from '../../common/tenant/tenant-context';

/**
 * The "disableable by a tenant administrator, globally or per role, taking
 * effect immediately on active sessions" NFR (§47.13). Checked fresh on
 * every retrieval call — no cache, which is what makes "immediately" true
 * without any invalidation machinery.
 */
@Injectable()
export class AssistantSettingsService {
  constructor(private readonly db: TenantDatabaseService) {}

  async get(): Promise<{ isEnabled: boolean; disabledRoleCodes: string[] }> {
    const rows = await this.db.query<{ is_enabled: boolean; disabled_role_codes: string[] }>(
      `select is_enabled, disabled_role_codes from assistant_settings where tenant_id = current_tenant_id()`,
    );
    return rows[0]
      ? { isEnabled: rows[0].is_enabled, disabledRoleCodes: rows[0].disabled_role_codes }
      : { isEnabled: true, disabledRoleCodes: [] };
  }

  async update(input: { isEnabled?: boolean; disabledRoleCodes?: string[] }): Promise<void> {
    const { userId } = TenantContextStore.current();
    await this.db.query(
      `insert into assistant_settings (tenant_id, is_enabled, disabled_role_codes, updated_by)
       values (current_tenant_id(), coalesce($1, true), coalesce($2::text[], '{}'::text[]), $3)
       on conflict (tenant_id) do update
         set is_enabled = coalesce($1, assistant_settings.is_enabled),
             disabled_role_codes = coalesce($2::text[], assistant_settings.disabled_role_codes),
             updated_at = now(), updated_by = $3`,
      [input.isEnabled ?? null, input.disabledRoleCodes ?? null, userId],
    );
  }

  async assertEnabledForCaller(): Promise<void> {
    const { roles } = TenantContextStore.current();
    const s = await this.get();
    if (!s.isEnabled) throw new ForbiddenException('The Assistant is disabled for this tenant.');
    if (roles.some((r) => s.disabledRoleCodes.includes(r))) {
      throw new ForbiddenException('The Assistant is disabled for your role.');
    }
  }
}
