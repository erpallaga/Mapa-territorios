import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ROLES_VALIDOS = ['user', 'admin'];
// Suficiente para rechazar erratas; la validación de verdad la hace Supabase Auth al enviar.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // Get the authorization header from the request
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return new Response(JSON.stringify({ error: 'No authorization header' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // Create Supabase client with user's JWT token
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

        // User client to verify the caller
        const userClient = createClient(supabaseUrl, supabaseAnonKey, {
            global: { headers: { Authorization: authHeader } },
        });

        const { data: { user }, error: userError } = await userClient.auth.getUser();
        if (userError || !user) {
            return new Response(JSON.stringify({ error: 'Unauthorized user token', details: userError }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // Check if caller is an ACTIVE admin. Desactivar a un admin desde el
        // panel pone is_active=false pero deja role='admin': sin mirar las dos
        // cosas, un admin desactivado podía seguir invitando.
        const { data: profile, error: profileError } = await userClient
            .from('profiles')
            .select('role, is_active')
            .eq('id', user.id)
            .single();

        if (profileError || profile?.role !== 'admin' || profile?.is_active !== true) {
            return new Response(JSON.stringify({ error: 'Admin access required', details: profileError }), {
                status: 403,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // Parse request body
        let body;
        try {
            body = await req.json();
        } catch {
            return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }
        const { siteUrl } = body ?? {};
        // El trigger que acepta la invitación compara el email tal cual con el
        // de la cuenta de Google, que llega en minúsculas: " Ana@X.com" no
        // casaría nunca y la persona se quedaría pendiente de aprobación.
        const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
        if (!email || !EMAIL_RE.test(email)) {
            return new Response(JSON.stringify({ error: 'A valid email is required' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }
        const role = body?.role ?? 'user';
        if (!ROLES_VALIDOS.includes(role)) {
            return new Response(JSON.stringify({ error: `Invalid role (expected one of: ${ROLES_VALIDOS.join(', ')})` }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // Admin client for privileged operations
        const adminClient = createClient(supabaseUrl, supabaseServiceKey);

        // Create invitation record using adminClient to bypass any restrictive RLS
        const { data: invitation, error: invError } = await adminClient
            .from('invitations')
            .insert({
                email,
                role,
                invited_by: user.id,
            })
            .select()
            .single();

        if (invError) {
            return new Response(JSON.stringify({ error: 'Failed to create invitation', details: invError.message }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // Use Supabase Auth admin to invite user by email
        const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
            redirectTo: siteUrl || 'http://localhost:5173',
            data: {
                invitation_token: invitation.token,
                invited_role: role,
            },
        });

        if (inviteError) {
            if (inviteError.message?.includes('already been registered')) {
                await adminClient.from('audit_logs').insert({
                    actor_id: user.id,
                    action: 'invitation_created',
                    target_email: email,
                    details: { role, note: 'User already registered' },
                });

                return new Response(JSON.stringify({
                    success: true,
                    invitation,
                    note: 'User already registered. They can log in directly.',
                }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                });
            }

            return new Response(JSON.stringify({ error: 'Failed to send invitation email', details: inviteError }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // Log the invitation
        await adminClient.from('audit_logs').insert({
            actor_id: user.id,
            action: 'invitation_created',
            target_email: email,
            details: { role },
        });

        return new Response(JSON.stringify({
            success: true,
            invitation,
            emailSent: true,
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
});
