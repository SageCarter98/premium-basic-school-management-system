# Chapter 47 Tenant AI Assistant — Stage 1 Implementation Spec

## Who can implement this, and why this file exists

This is a design/handoff specification, not code, and that distinction matters here specifically. CLAUDE.md's EC-005 ("Internal Engineering Agent" section) bars the Internal Engineering Agent (Claude Code, operating on this repository) from authoring Chapter 47's prompts, scope configuration, retrieval rules, or evaluation gates — a prohibition, not a review requirement, and not amendable except by whole-document re-adoption of the governing spec. Most of what this file describes falls squarely in those categories: the retrieval service's scope-enforcement logic, the DP-100 category allowlist, and the isolation test suite. **A human engineer must author those pieces.** This document exists so that work doesn't have to start from a blank page — it's a complete, concrete spec, not a starting point for negotiation about shape.

What the Agent *has* built, because it's plain schema rather than scope/retrieval logic: `pbsms-platform/infra/migrations/0049_assistant_interactions.sql` (the `assistant_interactions` audit table and `assistant_settings` toggle). See that file for the actual, merged DDL.

What the Agent built and then removed: the module/controller wiring (`tenant-ai-assistant.module.ts`, thin controllers). Building those in isolation from the services they call broke this repo's `apps/api` workspace typecheck entirely — `tsc` checks every file under `src/`, not just imported ones, so a controller importing a not-yet-written service fails the whole build, not just its own module. That means the module/controller/service layer has to be authored together, as one atomic unit, by whoever writes the service logic — it can't be split across two authors the way a pure-schema migration or a DTO can.

## Context

Chapter 47 (`PBSMS_Tenant_AI_Assistant_Ch47_v2_0.pdf`) is an adopted baseline, approved for build. Its own §47.0.2 build-authorization table places "retrieval under RLS, scope enforcement, audit logging, no model in the loop" as Stage 1, explicitly cleared to begin immediately — no external dependency, unlike Stage 3 (the "Ask" capability), which is gated on an unresolved AI model-provider decision (DP-103 zero-retention, DP-107 residency disclosure). This spec covers Stage 1 only: **zero LLM calls, zero natural-language input surfaces**, so nothing here needs those open questions resolved first.

The repo already has every primitive this needs — nothing below is invented from scratch:
- Request-scoped RLS via `TenantDatabaseService` (`pbsms-platform/apps/api/src/common/database/tenant-database.service.ts`) — one `PoolClient` per request, `SELECT set_config('app.current_tenant', ...)`. TEN-050 ("no service account, no elevated role, no bypass path") is satisfied by simply not building an alternate path — this codebase has no such path for anything else either.
- Chapter-13-style scope resolution precedent: `TeacherAssignmentsService.getCallerScope()` (`pbsms-platform/apps/api/src/modules/teacher-assignments/teacher-assignments.service.ts`) — unrestricted unless the caller's roles are exactly `['teacher']`, in which case filter against `scope.classIds`. Already consumed the same way by `AttendanceService.findAll()`/`findOne()`.
- `TenantContextStore` (`pbsms-platform/apps/api/src/common/tenant/tenant-context.ts`) already carries `impersonationGrantId` per request — TEN-055 is a presence check on an existing field, not new plumbing.
- The `WorkerTenantConnection` + `TenantContextStore.run()` harness already used by `finance-invariants.e2e-spec.ts` and `results-immutability.e2e-spec.ts` to exercise a `Scope.REQUEST` service outside HTTP against a real Postgres connection — reuse this for the new isolation suite rather than raw-SQL-only testing.

## Approach

**Vertical slice: attendance-below-a-threshold.** This is §47.3.1's own worked example, `attendance_records` already has Chapter-13.3 scope wired end-to-end, it already has fixtures in `tenant-isolation.e2e-spec.ts` to build on, and it is cleanly *not* a DP-100 category — making it the right "positive" case to pair against health/discipline as the "negative" (excluded) case in the same suite.

**DP-100 as a structural allowlist, not a per-query discipline.** A single `AssistantCategory` type/allowlist (today: exactly `'attendance_below_threshold'`) is the only way any category becomes retrievable. Health and discipline are excluded by *not being in the map*, not by a comment asking future authors to remember a rule.

**DP-102 as column-level minimality enforced by the SQL itself** — never `select *`; the test suite asserts the *absence* of full-profile fields (dob, gender, admission_no) on the returned shape.

**TEN-055 as a guard clause at the top of every assistant entry point**, checking `TenantContextStore.current().impersonationGrantId`.

**The tenant-admin-disable NFR is satisfied by checking a DB row fresh on every call, never a cache** — "takes effect immediately on active sessions" falls out of not introducing a cache, rather than needing invalidation machinery.

## Files to create

All new code under `pbsms-platform/apps/api/src/modules/tenant-ai-assistant/` (this directory).

### `tenant-ai-assistant.module.ts`
```ts
@Module({
  imports: [TeacherAssignmentsModule],
  controllers: [AssistantRetrievalController, AssistantSettingsController],
  providers: [AssistantRetrievalService, AssistantSettingsService, AssistantInteractionLogger],
})
export class TenantAiAssistantModule {}
```

### `assistant-categories.ts` (the DP-100 allowlist)
```ts
/**
 * DP-100: health and discipline records are excluded from Assistant
 * retrieval by default for EVERY role, even one normally authorised to
 * view them directly. Enforced structurally: a category not listed here
 * cannot be retrieved — there is no per-query opt-out.
 */
export type AssistantCategory = 'attendance_below_threshold';

export const ASSISTANT_ALLOWED_CATEGORIES: readonly AssistantCategory[] = ['attendance_below_threshold'];

export function assertCategoryAllowed(category: string): asserts category is AssistantCategory {
  if (!(ASSISTANT_ALLOWED_CATEGORIES as readonly string[]).includes(category)) {
    throw new ForbiddenException(
      `Assistant category '${category}' is excluded from retrieval (DP-100 or not yet built).`,
    );
  }
}
```

### `dto/find-low-attendance.dto.ts`
```ts
export class FindLowAttendanceDto {
  @IsInt() @Min(0) @Max(100) thresholdPercentage!: number;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsOptional() @IsUuidLike() classId?: string;
}
```
(`IsUuidLike` from `../../../common/validation/is-uuid-like` — not `class-validator`'s built-in `@IsUUID()`, which rejects this repo's human-readable seed-data ids like `aaaaaaaa-0000-0000-0000-000000000001`.)

### `assistant-retrieval.service.ts`
```ts
export interface AssistantRecordRef { recordType: 'student' | 'class'; recordId: string; } // FR-AIT-011

export interface LowAttendanceRow {
  studentId: string;
  studentFirstName: string;   // DP-102: minimal projection only
  studentLastName: string;
  classId: string;
  className: string;
  presentDays: number;
  totalDays: number;
  attendancePercentage: number;
  refs: AssistantRecordRef[];
}

export interface AssistantRecordSet<T> { records: T[]; totalCount: number; truncated: boolean; } // FR-AIT-012

const MAX_RECORDS = 50;

@Injectable()
export class AssistantRetrievalService {
  constructor(
    private readonly db: TenantDatabaseService,
    private readonly teacherAssignments: TeacherAssignmentsService,
    private readonly settings: AssistantSettingsService,
    private readonly interactionLogger: AssistantInteractionLogger,
  ) {}

  async findLowAttendance(input: FindLowAttendanceDto): Promise<AssistantRecordSet<LowAttendanceRow>> {
    const category: AssistantCategory = 'attendance_below_threshold';
    assertCategoryAllowed(category);            // DP-100
    await this.assertNotImpersonating();         // TEN-055
    await this.settings.assertEnabledForCaller(); // tenant-admin disable NFR

    const scope = await this.teacherAssignments.getCallerScope(); // TEN-051: reuse, don't reimplement
    const params: unknown[] = [input.thresholdPercentage, input.startDate, input.endDate];
    let classFilter = '';
    if (!scope.unrestricted) {
      if (scope.classIds.size === 0) {
        await this.interactionLogger.log({ category, input, resultCount: 0, recordIds: [] });
        return { records: [], totalCount: 0, truncated: false };
      }
      params.push([...scope.classIds]);
      classFilter = `and ar.class_id = any($${params.length}::uuid[])`;
    }
    if (input.classId) {
      params.push(input.classId);
      classFilter += ` and ar.class_id = $${params.length}`;
    }

    // TEN-050: this.db is the same request-scoped TenantDatabaseService every
    // other module uses — RLS applies exactly as it would to any other request.
    const rows = await this.db.query<LowAttendanceRow & { totalHits: number }>(
      `select s.id as "studentId", s.first_name as "studentFirstName", s.last_name as "studentLastName",
              ar.class_id as "classId", c.name as "className",
              count(*) filter (where ar.status = 'present') as "presentDays",
              count(*) as "totalDays",
              round(100.0 * count(*) filter (where ar.status = 'present') / count(*), 1) as "attendancePercentage",
              count(*) over () as "totalHits"
       from attendance_records ar
       join students s on s.id = ar.student_id
       join classes c on c.id = ar.class_id
       where ar.attendance_date between $2 and $3 and ar.deleted_at is null ${classFilter}
       group by s.id, s.first_name, s.last_name, ar.class_id, c.name
       having round(100.0 * count(*) filter (where ar.status = 'present') / count(*), 1) < $1
       order by "attendancePercentage" asc
       limit ${MAX_RECORDS + 1}`,
      params,
    );

    const truncated = rows.length > MAX_RECORDS;
    const records = rows.slice(0, MAX_RECORDS).map((r) => ({
      ...r,
      refs: [
        { recordType: 'student' as const, recordId: r.studentId },
        { recordType: 'class' as const, recordId: r.classId },
      ],
    }));
    const totalCount = rows[0]?.totalHits ?? 0;

    await this.interactionLogger.log({
      category, input, resultCount: records.length,
      recordIds: records.flatMap((r) => [r.studentId, r.classId]),
    });

    return { records, totalCount, truncated };
  }

  private async assertNotImpersonating(): Promise<void> {
    const { impersonationGrantId } = TenantContextStore.current();
    if (impersonationGrantId) {
      throw new ForbiddenException('The Assistant is disabled for impersonation sessions (TEN-055).');
    }
  }
}
```

### `assistant-settings.service.ts`
```ts
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
       values (current_tenant_id(), coalesce($1, true), coalesce($2, '{}'), $3)
       on conflict (tenant_id) do update
         set is_enabled = coalesce($1, assistant_settings.is_enabled),
             disabled_role_codes = coalesce($2, assistant_settings.disabled_role_codes),
             updated_at = now(), updated_by = $3`,
      [input.isEnabled ?? null, input.disabledRoleCodes ?? null, userId],
    );
  }

  /** Checked fresh on every retrieval call — no cache, which is what makes
   * "takes effect immediately on active sessions" true with no invalidation
   * machinery. */
  async assertEnabledForCaller(): Promise<void> {
    const { roles } = TenantContextStore.current();
    const s = await this.get();
    if (!s.isEnabled) throw new ForbiddenException('The Assistant is disabled for this tenant.');
    if (roles.some((r) => s.disabledRoleCodes.includes(r))) {
      throw new ForbiddenException('The Assistant is disabled for your role.');
    }
  }
}
```

### `assistant-interaction-logger.service.ts`
Writes the FR-AIT-600 row. Model/question/response/cost columns stay `null` at this stage.
```ts
@Injectable()
export class AssistantInteractionLogger {
  constructor(private readonly db: TenantDatabaseService) {}

  async log(entry: {
    category: string; input: unknown; resultCount: number; recordIds: string[];
    denied?: { reason: string };
  }): Promise<void> {
    const { userId, roles } = TenantContextStore.current();
    await this.db.query(
      `insert into assistant_interactions
         (tenant_id, actor_user_id, actor_role_codes, request_category, request_params,
          retrieved_record_ids, result_count, status, denial_reason)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, roles, entry.category, JSON.stringify(entry.input), entry.recordIds, entry.resultCount,
       entry.denied ? 'denied' : 'served', entry.denied?.reason ?? null],
    );
  }
}
```
Call this from a `catch` block too (log denials), not only on success — mirrors the lesson `write-audit-log.ts`'s header already records about `RolesGuard` denials being invisible unless explicitly logged.

### Controllers
```ts
@Controller('v1/assistant/retrieve')
export class AssistantRetrievalController {
  constructor(private readonly retrieval: AssistantRetrievalService) {}
  @Roles(...ACADEMIC_STAFF)
  @Post('attendance-below-threshold')
  findLowAttendance(@Body() body: FindLowAttendanceDto) { return this.retrieval.findLowAttendance(body); }
}

@Controller('v1/assistant/settings')
export class AssistantSettingsController {
  constructor(private readonly settings: AssistantSettingsService) {}
  @Roles(...LEADERSHIP) @Get() get() { return this.settings.get(); }
  @Roles(...LEADERSHIP) @Patch() update(@Body() body: UpdateAssistantSettingsDto) { return this.settings.update(body); }
}
```

## Migration — already built and merged

`pbsms-platform/infra/migrations/0049_assistant_interactions.sql` — the `assistant_interactions` and `assistant_settings` tables. See that file directly for the actual DDL rather than a copy here that could drift out of sync with it.

## New protected suite: `pbsms-platform/apps/api/test/tenant-ai-assistant-isolation.e2e-spec.ts`

Becomes an EC-400 entry the moment it's merged — CLAUDE.md already reserves this slot ("Chapter 47's Assistant isolation and grounding gates"). Uses the `WorkerTenantConnection` + `TenantContextStore.run()` harness from `finance-invariants.e2e-spec.ts`, not raw-SQL-only testing (this suite has to exercise TypeScript-level scope/DP-100/impersonation logic, which raw SQL can't).

Test list:
1. A cross-tenant caller gets zero low-attendance rows, never Tenant A's.
2. A caller scoped to one campus's class doesn't see another campus's rows (needs its own fixtured `teacher_assignments` row, cleaned up in `afterAll`).
3. A pure-teacher caller with no active assignment for the queried class gets zero rows, not another teacher's class.
4. A pure-teacher caller assigned to exactly one class only ever sees that class's rows, matching `getCallerScope()` exactly.
5. A headmaster-tier caller is unrestricted, same as every other attendance read path.
6. A request under an active impersonation grant is refused with TEN-055's message, regardless of role.
7. A request against a tenant-disabled Assistant is refused immediately, no cached prior "enabled" state.
8. A request from a role listed in `disabled_role_codes` is refused even though the tenant's Assistant is globally enabled.
9. A role normally authorised to read health records directly still cannot retrieve a health category through the Assistant (DP-100).
10. A discipline-category attempt is refused for every role tested, including headmaster.
11. A served response never includes full student-profile fields (dob, gender, admission_no) — DP-102.
12. Every record in a served response carries a navigable `recordType`+`recordId` reference (FR-AIT-011).
13. A response states `totalCount` and `truncated`, true once results exceed the cap (FR-AIT-012).
14. A served retrieval writes exactly one `assistant_interactions` row (`status=served`, correct `retrieved_record_ids`, `question_text`/`response_text`/`model_version`/cost all null).
15. A denied retrieval (impersonation, disabled, DP-100) still writes a row with `status=denied` and a `denial_reason` — mirrors `RolesGuard`'s own denial-logging discipline.
16. A raw adversarial structured input (threshold=100, a Tenant-B class id, a spoofed class id the caller has no assignment for) still resolves to zero/forbidden, not a bypass of scope filtering.

## Verification plan (for whoever implements this)

1. Run migrations through `0049_assistant_interactions.sql` (already done on `main`); confirm the trailing sanity-check query in that file returns zero rows.
2. `npm run test:e2e` — auto-discovers the new spec via `test/jest-e2e.json`'s existing `testRegex`, no config change needed. Confirm `tenant-isolation.e2e-spec.ts` still passes unmodified, and every new `it()` above is green.
3. Manually spot-check `apps/api/tools/check-protected-tests.ts` against the PR that adds this file — as a brand-new file it produces zero violations on its own PR; it starts protecting cases from the next PR onward.
4. Hit `POST /v1/assistant/retrieve/attendance-below-threshold` and `GET/PATCH /v1/assistant/settings` locally as a teacher (scoped), a headmaster (unrestricted), and an impersonation-minted token (403). Confirm each produces exactly one `assistant_interactions` row with the right `status`.
5. `grep -ri "openai\|anthropic\|api_key\|fetch(" src/modules/tenant-ai-assistant` — should return nothing. "No model in the loop" is the entire point of this stage.

## Explicitly out of scope for this increment

- No natural-language input anywhere — `FindLowAttendanceDto` is fully structured, no `question: string` field, no free-text endpoint.
- No "Ask" endpoint, no Draft/Explain/Find, no Demo mode, no billing metering, no Parent View — all later §47.17 stages.
- `question_text`/`response_text`/`model_version`/`validation_outcome`/`latency_ms`/`cost_*` stay null forever in this increment — populated starting at the "Ask" stage, additive not breaking.
- Only one entity type (attendance) — the DP-100 allowlist is built specifically so a second category is a one-line addition later, not a rearchitecture.
- No new frontend surface in `apps/web`.
- `AssistantSettingsController` is included (cheap to fully satisfy the disable NFR now) but has no UI and isn't wired into onboarding/subscription flows.

## Remaining steps for the human implementer

1. **Author the files above** — this Agent will not, per EC-005.
2. **`.github/CODEOWNERS` addition** for the new e2e file as its own explicit line (matching the other three EC-400 files), and **`apps/api/tools/check-protected-tests.ts`'s `PROTECTED_FILES` array** gains a fourth entry. Both are ordinary protected-zone edits (draft-with-review), not EC-201-tier — should land in the same PR as the new test file's addition, reviewed together.
3. Fixture data for the "another campus, same tenant" case needs its own test-created `teacher_assignments` row, cleaned up in `afterAll` — no existing seed data covers this case.
4. Once merged, add the new e2e file to branch protection's required-status-checks list consideration alongside the other three EC-400 suites, if/when that gets tightened.
