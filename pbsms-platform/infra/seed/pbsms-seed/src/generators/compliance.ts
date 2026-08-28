import { type SeedConfig, type TenantSpec } from '../config.js';
import { DISCIPLINE_SUMMARIES, HEALTH_CONDITIONS } from '../corpus.js';
import { addDays, at, nextId, type Rng } from '../rng.js';
import type { ConsentRecord, MessageDelivery, MessageTemplate, TenantGraph } from '../types.js';

const TEMPLATES: { name: string; channel: MessageTemplate['channel']; body: string }[] = [
  { name: 'Fees reminder', channel: 'sms', body: 'Dear {{guardian_last_name}}, {{student_first_name}}\u2019s {{term}} balance is GH\u00a2{{balance}}, due {{due_date}}. {{school_name}}.' },
  { name: 'Results published', channel: 'sms', body: '{{term}} results for {{student_first_name}} are ready. View: {{link}} \u2014 {{school_name}}.' },
  { name: 'Absence notice', channel: 'sms', body: '{{student_first_name}} was marked absent on {{date}}. Please contact the school office. {{school_name}}.' },
  { name: 'Reopening date', channel: 'whatsapp', body: 'School reopens on {{date}}. Please settle outstanding fees before reporting. {{school_name}}.' },
];

export function generateCompliance(g: TenantGraph, spec: TenantSpec, cfg: SeedConfig, rng: Rng): void {
  const tid = g.tenant.id;
  const scope = spec.slug;
  const cRng = rng.stream('comms');

  for (const school of g.schools) {
    const staff = g.staff.filter((s) => s.school_id === school.id);
    const head = staff.find((s) => s.roles.includes('headmaster'))!;
    const accountant = staff.find((s) => s.roles.includes('accountant'))!;
    const healthOfficer = staff.find((s) => s.roles.includes('health_officer'))!;
    const students = g.students.filter((s) => s.school_id === school.id);
    const studentIds = new Set(students.map((s) => s.id));
    const links = g.guardian_links.filter((l) => studentIds.has(l.student_id));
    const guardianIds = [...new Set(links.map((l) => l.guardian_id))];

    /* ----------------------------------------------------------- consent */
    for (const gid of guardianIds) {
      for (const channel of ['sms', 'whatsapp', 'email'] as const) {
        g.consent_records.push({
          tenant_id: tid,
          id: nextId('cns', scope),
          guardian_id: gid,
          channel,
          purpose: 'academic',
          granted: channel === 'sms' ? true : cRng.bool(0.6),
          changed_at: at(school.id.length % 2 === 0 ? '2025-09-12' : '2025-09-15', 9, 30),
          source: 'admission_form',
        });
      }
    }

    // Withdrawn SMS consent (DP-070). A send to this guardian must be
    // suppressed, not merely logged as failed — the two states have different
    // legal meanings and the delivery log must distinguish them.
    if (guardianIds.length > 2) {
      const withdrawn = guardianIds[2];
      const rec = g.consent_records.find((c) => c.guardian_id === withdrawn && c.channel === 'sms');
      if (rec) {
        rec.granted = false;
        rec.changed_at = at(addDays(cfg.asOf, -33), 18, 4);
        rec.source = 'parent_view';
      }
    }

    /* --------------------------------------------------------- messaging */
    const templates: MessageTemplate[] = TEMPLATES.map((t) => ({
      tenant_id: tid,
      id: nextId('tpl', scope),
      school_id: school.id,
      name: t.name,
      channel: t.channel,
      version: 1,
      body: t.body,
    }));
    g.message_templates.push(...templates);

    // A second version of the fees template, so version history is non-trivial.
    g.message_templates.push({
      ...templates[0],
      id: nextId('tpl', scope),
      version: 2,
      body: TEMPLATES[0].body.replace('Dear', 'Good afternoon'),
    });

    const batchSpecs = [
      { tpl: templates[0], audience: 'Guardians of students with an outstanding balance', by: accountant.id, ago: 9 },
      { tpl: templates[1], audience: 'All guardians, Term 1 results', by: head.id, ago: 62 },
      { tpl: templates[2], audience: 'Guardians of students absent yesterday', by: head.id, ago: 2 },
    ];

    for (const b of batchSpecs) {
      const eligible = links.filter((l) => l.receives_communication);
      const recipients = eligible.slice(0, Math.max(3, Math.round(eligible.length * 0.6)));
      const batch = {
        tenant_id: tid,
        id: nextId('mbt', scope),
        template_id: b.tpl.id,
        audience_description: b.audience,
        channel: b.tpl.channel,
        recipient_count: recipients.length,
        estimated_cost: recipients.length * 6, // GH¢0.06 per SMS segment
        sent_by: b.by,
        sent_at: at(addDays(cfg.asOf, -b.ago), 13, 5),
      };
      g.message_batches.push(batch);

      for (const l of recipients) {
        const consent = g.consent_records.find((c) => c.guardian_id === l.guardian_id && c.channel === b.tpl.channel);
        const suppressed = consent ? !consent.granted : false;
        const failed = !suppressed && cRng.bool(0.05);
        const delivery: MessageDelivery = {
          tenant_id: tid,
          id: nextId('mdl', scope),
          batch_id: batch.id,
          guardian_id: l.guardian_id,
          student_id: l.student_id,
          state: suppressed ? 'suppressed_no_consent' : failed ? 'failed' : cRng.bool(0.93) ? 'delivered' : 'sent',
          failure_reason: failed ? cRng.pick(['Number not in service', 'Handset off — retry window expired', 'Rejected by carrier']) : null,
          attempts: failed ? 3 : 1,
        };
        g.message_deliveries.push(delivery);
      }
    }

    /* ------------------------------------------------ restricted records */
    const flagged = students.filter((s) => s.has_restricted_health_record);
    for (const s of flagged) {
      g.health_records.push({
        tenant_id: tid,
        id: nextId('hlt', scope),
        student_id: s.id,
        condition: cRng.pick(HEALTH_CONDITIONS),
        medication: cRng.bool(0.5) ? 'Salbutamol inhaler, as needed' : null,
        recorded_by: healthOfficer.id,
        recorded_at: at('2025-09-18', 11, 20),
        access_role: 'health_officer',
      });
    }

    if (students.length > 11) {
      g.discipline_cases.push({
        tenant_id: tid,
        id: nextId('dsc', scope),
        student_id: students[10].id,
        summary: cRng.pick(DISCIPLINE_SUMMARIES),
        state: 'investigating',
        opened_on: addDays(cfg.asOf, -14),
        access_role: 'headmaster',
      });
    }

    /* ----------------------------------------------- data subject requests */
    if (guardianIds.length > 4) {
      // One comfortably inside the 30-day SLA...
      g.data_subject_requests.push({
        tenant_id: tid,
        id: nextId('dsr', scope),
        subject_kind: 'guardian',
        subject_id: guardianIds[3],
        kind: 'access',
        received_on: addDays(cfg.asOf, -6),
        due_on: addDays(addDays(cfg.asOf, -6), 30),
        state: 'in_progress',
      });
      // ...and one at day 27, which the queue must be showing as urgent.
      g.data_subject_requests.push({
        tenant_id: tid,
        id: nextId('dsr', scope),
        subject_kind: 'guardian',
        subject_id: guardianIds[4],
        kind: 'erasure',
        received_on: addDays(cfg.asOf, -27),
        due_on: addDays(addDays(cfg.asOf, -27), 30),
        state: 'received',
      });
    }

    /* --------------------------------------------------------- audit log */
    const auditSeed: { actor: 'staff' | 'platform' | 'system'; id: string; action: string; entity: string; entityId: string; ago: number; detail: string }[] = [
      { actor: 'staff', id: head.id, action: 'result_set.published', entity: 'result_set', entityId: g.result_sets[0]?.id ?? 'n/a', ago: 60, detail: 'Term 1 results published' },
      { actor: 'staff', id: accountant.id, action: 'payment.reversed', entity: 'payment', entityId: g.payments.find((p) => p.state === 'reversed')?.id ?? 'n/a', ago: 20, detail: 'Reversal approved by headmaster' },
      { actor: 'staff', id: head.id, action: 'grading_scale.superseded', entity: 'grading_scale', entityId: g.grading_scales[0]?.id ?? 'n/a', ago: 160, detail: 'Version 1 superseded by version 2' },
      { actor: 'system', id: 'system', action: 'invoice.run.completed', entity: 'term', entityId: g.terms[0]?.id ?? 'n/a', ago: 40, detail: 'Termly invoice generation' },
      // Platform actions are written into the TENANT-visible log, not only the
      // platform log. TEN-022 requires the school to see what support did.
      { actor: 'platform', id: 'pfm_support_01', action: 'impersonation.started', entity: 'tenant', entityId: tid, ago: 5, detail: 'Ticket #4821, read-only, 60 minutes' },
      { actor: 'platform', id: 'pfm_support_01', action: 'impersonation.ended', entity: 'tenant', entityId: tid, ago: 5, detail: 'Ticket #4821, ended by operator' },
    ];

    for (const a of auditSeed) {
      g.audit_events.push({
        tenant_id: tid,
        id: nextId('aud', scope),
        actor_kind: a.actor,
        actor_id: a.id,
        action: a.action,
        entity: a.entity,
        entity_id: a.entityId,
        occurred_at: at(addDays(cfg.asOf, -a.ago), 10, 41),
        detail: a.detail,
      });
    }
  }
}

export { TEMPLATES };
