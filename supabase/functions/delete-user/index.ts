import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return new Response(JSON.stringify({ error: 'No authorization header' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

        const userClient = createClient(supabaseUrl, supabaseAnonKey, {
            global: { headers: { Authorization: authHeader } },
        });

        const { data: { user }, error: userError } = await userClient.auth.getUser();
        if (userError || !user) {
            return new Response(JSON.stringify({ error: 'Unauthorized user token' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const { data: profile, error: profileError } = await userClient
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();

        if (profileError || profile?.role !== 'admin') {
            return new Response(JSON.stringify({ error: 'Admin access required' }), {
                status: 403,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const { targetUserId } = await req.json();
        if (!targetUserId) {
            return new Response(JSON.stringify({ error: 'targetUserId is required' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        if (targetUserId === user.id) {
            return new Response(JSON.stringify({ error: 'Cannot delete your own account' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const adminClient = createClient(supabaseUrl, supabaseServiceKey);

        // Get the target email for logging
        const { data: targetProfile } = await adminClient.from('profiles').select('email').eq('id', targetUserId).single();

        // Delete user from auth.users (cascades to profiles)
        const { error: deleteError } = await adminClient.auth.admin.deleteUser(targetUserId);

        if (deleteError) {
            return new Response(JSON.stringify({ error: 'Failed to delete user', details: deleteError.message }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // Log the deletion
        await adminClient.from('audit_logs').insert({
            actor_id: user.id,
            action: 'user_deleted',
            target_email: targetProfile?.email || targetUserId,
        });

        return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message || 'Unknown error' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
});
