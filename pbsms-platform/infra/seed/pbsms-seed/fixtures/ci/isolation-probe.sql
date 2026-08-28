-- NFR-QA-020 probe. Every query must return 0.
-- Run as an ordinary application role, never as superuser or BYPASSRLS.

SELECT set_config('app.tenant_id', 'tnt_sunrise', false);

SELECT 'students' AS probe, count(*) AS leaked FROM public.students WHERE tenant_id <> 'tnt_sunrise';
SELECT 'guardians' AS probe, count(*) AS leaked FROM public.guardians WHERE tenant_id <> 'tnt_sunrise';
SELECT 'payments' AS probe, count(*) AS leaked FROM public.payments WHERE tenant_id <> 'tnt_sunrise';
SELECT 'result_lines' AS probe, count(*) AS leaked FROM public.result_lines WHERE tenant_id <> 'tnt_sunrise';
SELECT 'health_records' AS probe, count(*) AS leaked FROM public.health_records WHERE tenant_id <> 'tnt_sunrise';
SELECT 'audit_events' AS probe, count(*) AS leaked FROM public.audit_events WHERE tenant_id <> 'tnt_sunrise';
SELECT 'users' AS probe, count(*) AS leaked FROM public.users WHERE tenant_id <> 'tnt_sunrise';
SELECT 'access_links' AS probe, count(*) AS leaked FROM public.access_links WHERE tenant_id <> 'tnt_sunrise';
SELECT 'password_reset_tokens' AS probe, count(*) AS leaked FROM public.password_reset_tokens WHERE tenant_id <> 'tnt_sunrise';

-- Write-side: inserting another tenant's row must be rejected by WITH CHECK,
-- not merely filtered out on read.
DO $$
BEGIN
  INSERT INTO public.students (tenant_id, id, school_id, admission_no, first_name, middle_name, last_name, sex, date_of_birth, admitted_on, status, has_restricted_health_record)
  VALUES ('tnt_brightfuture', 'stu_probe_9999', NULL, 'PROBE/0000', 'Probe', NULL, 'Row', 'F', '2015-01-01', '2025-09-09', 'active', false);
  RAISE EXCEPTION 'RLS FAILURE: cross-tenant INSERT succeeded';
EXCEPTION
  WHEN insufficient_privilege OR check_violation THEN
    RAISE NOTICE 'ok: cross-tenant INSERT rejected';
END $$;