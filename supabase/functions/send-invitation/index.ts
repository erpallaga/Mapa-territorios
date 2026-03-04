import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

        // Check if caller is admin
        const { data: profile, error: profileError } = await userClient
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();

        if (profileError || profile?.role !== 'admin') {
            return new Response(JSON.stringify({ error: 'Admin access required', details: profileError }), {
                status: 403,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // Parse request body
        const { email, role, siteUrl } = await req.json();
        if (!email) {
            return new Response(JSON.stringify({ error: 'Email is required' }), {
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
                role: role || 'user',
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
                invited_role: role || 'user',
            },
        });

        if (inviteError) {
            if (inviteError.message?.includes('already been registered')) {
                await adminClient.from('audit_logs').insert({
                    actor_id: user.id,
                    action: 'invitation_created',
                    target_email: email,
                    details: { role: role || 'user', note: 'User already registered' },
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
            details: { role: role || 'user' },
        });

        return new Response(JSON.stringify({
            success: true,
            invitation,
            emailSent: true,
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
});
