-- Endurecimiento de RLS tras la revisión del repo.
--
-- 1. profiles: cualquiera que inicie sesión con Google recibe un perfil
--    (inactivo, pendiente de aprobación) y la política de lectura era `true`,
--    así que podía leer el email y el nombre de todos los usuarios. Ahora cada
--    uno lee el suyo y los admins, todos. Ninguna pantalla que no sea de admin
--    necesita perfiles ajenos.
drop policy if exists "Users can view all profiles" on public.profiles;
create policy "Users view own profile, admins view all"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

-- 2. is_admin(): desactivar a un admin (is_active = false) le dejaba
--    role = 'admin', y todas las políticas seguían dándole permisos de admin.
create or replace function public.is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  return exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and is_active = true
  );
end;
$function$;

-- 3. audit_logs: cualquier usuario autenticado podía insertar filas con
--    cualquier actor_id y cualquier acción (falsificar el registro). Ahora solo
--    en su propio nombre, y un no-admin solo puede registrar su logout, que es
--    lo único que la app escribe por él. Las edge functions y los triggers usan
--    service_role / SECURITY DEFINER y no pasan por esta política.
drop policy if exists "Authenticated users can insert logs" on public.audit_logs;
create policy "Users insert own logs"
  on public.audit_logs for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and (action = 'user_logout' or (select public.is_admin()))
  );

-- 5a. Políticas duplicadas.
drop policy if exists "Admins can view audit logs" on public.audit_logs;        -- igual que "Admins can view all logs"
drop policy if exists "Admins can view all invitations" on public.invitations;  -- cubierta por "Admins can manage invitations" (ALL)

-- 5b. Las funciones SECURITY DEFINER se podían llamar por /rest/v1/rpc, también
--     sin sesión. Las de trigger no las necesita ejecutar nadie: un trigger no
--     comprueba EXECUTE al dispararse. is_admin() la sigue necesitando el rol
--     authenticated porque las políticas la evalúan con sus privilegios.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_profile_post_creation() from public, anon, authenticated;
revoke execute on function public.handle_update_user() from public, anon, authenticated;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
