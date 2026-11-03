-- Supabase advisor fixes.

-- plans: one permissive SELECT policy instead of two (performance lint 0006).
drop policy if exists "platform admins manage plans" on public.plans;
create policy "platform admins create plans" on public.plans
  for insert to authenticated with check (app.is_platform_admin());
create policy "platform admins update plans" on public.plans
  for update to authenticated using (app.is_platform_admin()) with check (app.is_platform_admin());

-- These SECURITY DEFINER RPCs are intentionally callable by signed-in users (lint 0029).
-- Each one checks the caller's role itself before doing anything; see supabase/tests/database.
comment on function public.create_business is
  'Intentional SECURITY DEFINER: onboarding. Caller becomes owner; max 5 owned workspaces.';
comment on function public.create_demo_workspace is
  'Intentional SECURITY DEFINER: one fictional demo workspace per user.';
comment on function public.create_invitation is
  'Intentional SECURITY DEFINER: owner-only check inside; stores only the token hash.';
comment on function public.accept_invitation is
  'Intentional SECURITY DEFINER: token hash + matching email + expiry checked inside.';
comment on function public.update_member is
  'Intentional SECURITY DEFINER: owner-only check inside; keeps at least one active owner.';
comment on function public.my_production_jobs is
  'Intentional SECURITY DEFINER: returns only assigned jobs and the fields production needs.';
