import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import {
    Users, Mail, Clock, Shield, ShieldCheck, UserX, UserCheck,
    Send, X, RefreshCw, ChevronDown, Search, AlertCircle
} from 'lucide-react'
import { cn } from '../lib/utils'

export function AdminPanel() {
    const [activeTab, setActiveTab] = useState('users')

    return (
        <div className="admin-panel">
            <div className="admin-header">
                <h1 className="admin-title">Panel de Administración</h1>
                <p className="admin-subtitle">Gestión de usuarios, invitaciones y actividad</p>
            </div>

            <div className="admin-tabs">
                <button
                    className={cn("admin-tab", activeTab === 'users' && "admin-tab-active")}
                    onClick={() => setActiveTab('users')}
                >
                    <Users className="w-4 h-4" />
                    <span>Usuarios</span>
                </button>
                <button
                    className={cn("admin-tab", activeTab === 'invitations' && "admin-tab-active")}
                    onClick={() => setActiveTab('invitations')}
                >
                    <Mail className="w-4 h-4" />
                    <span>Invitaciones</span>
                </button>
                <button
                    className={cn("admin-tab", activeTab === 'logs' && "admin-tab-active")}
                    onClick={() => setActiveTab('logs')}
                >
                    <Clock className="w-4 h-4" />
                    <span>Actividad</span>
                </button>
            </div>

            <div className="admin-content">
                {activeTab === 'users' && <UsersTab />}
                {activeTab === 'invitations' && <InvitationsTab />}
                {activeTab === 'logs' && <LogsTab />}
            </div>
        </div>
    )
}

/* ─────────────── USERS TAB ─────────────── */
function UsersTab() {
    const [users, setUsers] = useState([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const { user: currentUser } = useAuth()

    async function loadUsers() {
        setLoading(true)
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .order('created_at', { ascending: false })

        if (error) console.error('Error loading users:', error)
        setUsers(data || [])
        setLoading(false)
    }

    useEffect(() => { loadUsers() }, [])

    async function toggleRole(userId, currentRole) {
        const newRole = currentRole === 'admin' ? 'user' : 'admin'
        const { error } = await supabase
            .from('profiles')
            .update({ role: newRole, updated_at: new Date().toISOString() })
            .eq('id', userId)

        if (!error) {
            const targetUser = users.find(u => u.id === userId)
            await supabase.from('audit_logs').insert({
                actor_id: currentUser.id,
                action: 'role_changed',
                target_email: targetUser?.email,
                details: { from: currentRole, to: newRole }
            })
            loadUsers()
        }
    }

    async function toggleActive(userId, isActive) {
        const { error } = await supabase
            .from('profiles')
            .update({ is_active: !isActive, updated_at: new Date().toISOString() })
            .eq('id', userId)

        if (!error) {
            const targetUser = users.find(u => u.id === userId)
            await supabase.from('audit_logs').insert({
                actor_id: currentUser.id,
                action: isActive ? 'user_deactivated' : 'user_activated',
                target_email: targetUser?.email,
            })
            loadUsers()
        }
    }

    const filteredUsers = users.filter(u =>
        u.email?.toLowerCase().includes(search.toLowerCase()) ||
        u.full_name?.toLowerCase().includes(search.toLowerCase())
    )

    return (
        <div>
            <div className="admin-section-header">
                <div className="admin-search">
                    <Search className="w-4 h-4 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Buscar por nombre o email..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="admin-search-input"
                    />
                </div>
                <button onClick={loadUsers} className="admin-btn-icon" title="Refrescar">
                    <RefreshCw className="w-4 h-4" />
                </button>
            </div>

            {loading ? (
                <div className="admin-loading">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                </div>
            ) : (
                <div className="admin-table-wrapper">
                    <table className="admin-table">
                        <thead>
                            <tr>
                                <th>Usuario</th>
                                <th>Rol</th>
                                <th>Estado</th>
                                <th>Registro</th>
                                <th>Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredUsers.map(u => (
                                <tr key={u.id}>
                                    <td>
                                        <div className="admin-user-cell">
                                            <img
                                                src={u.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.full_name || u.email)}&background=6366f1&color=fff`}
                                                alt=""
                                                className="admin-avatar"
                                            />
                                            <div>
                                                <div className="admin-user-name">{u.full_name || 'Sin nombre'}</div>
                                                <div className="admin-user-email">{u.email}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td>
                                        <span className={cn("admin-badge", u.role === 'admin' ? "admin-badge-admin" : "admin-badge-user")}>
                                            {u.role === 'admin' ? <ShieldCheck className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
                                            {u.role}
                                        </span>
                                    </td>
                                    <td>
                                        <span className={cn("admin-badge", u.is_active ? "admin-badge-active" : "admin-badge-inactive")}>
                                            {u.is_active ? 'Activo' : 'Inactivo'}
                                        </span>
                                    </td>
                                    <td className="admin-date">
                                        {new Date(u.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
                                    </td>
                                    <td>
                                        {u.id !== currentUser.id && (
                                            <div className="admin-actions">
                                                <button
                                                    onClick={() => toggleRole(u.id, u.role)}
                                                    className="admin-btn-sm admin-btn-role"
                                                    title={u.role === 'admin' ? 'Cambiar a user' : 'Cambiar a admin'}
                                                >
                                                    {u.role === 'admin' ? <Shield className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                                                </button>
                                                <button
                                                    onClick={() => toggleActive(u.id, u.is_active)}
                                                    className={cn("admin-btn-sm", u.is_active ? "admin-btn-deactivate" : "admin-btn-activate")}
                                                    title={u.is_active ? 'Desactivar' : 'Activar'}
                                                >
                                                    {u.is_active ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {filteredUsers.length === 0 && (
                        <div className="admin-empty">No se encontraron usuarios</div>
                    )}
                </div>
            )}
        </div>
    )
}

/* ─────────────── INVITATIONS TAB ─────────────── */
function InvitationsTab() {
    const [invitations, setInvitations] = useState([])
    const [loading, setLoading] = useState(true)
    const [email, setEmail] = useState('')
    const [role, setRole] = useState('user')
    const [sending, setSending] = useState(false)
    const [message, setMessage] = useState(null)
    const { user: currentUser } = useAuth()

    async function loadInvitations() {
        setLoading(true)
        const { data, error } = await supabase
            .from('invitations')
            .select('*, inviter:invited_by(email, full_name)')
            .order('created_at', { ascending: false })

        if (error) console.error('Error loading invitations:', error)
        setInvitations(data || [])
        setLoading(false)
    }

    useEffect(() => { loadInvitations() }, [])

    async function sendInvitation(e) {
        e.preventDefault()
        if (!email.trim()) return
        setSending(true)
        setMessage(null)

        try {
            const { data: { session } } = await supabase.auth.getSession()

            const response = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-invitation`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${session.access_token}`,
                    },
                    body: JSON.stringify({
                        email: email.trim(),
                        role,
                        siteUrl: window.location.origin,
                    }),
                }
            )

            const result = await response.json()

            if (response.ok) {
                setMessage({ type: 'success', text: `Invitación enviada a ${email}` })
                setEmail('')
                loadInvitations()
            } else {
                setMessage({ type: 'error', text: result.error || 'Error al enviar invitación' })
            }
        } catch (error) {
            setMessage({ type: 'error', text: 'Error de conexión' })
        } finally {
            setSending(false)
        }
    }

    async function revokeInvitation(invId, invEmail) {
        const { error } = await supabase
            .from('invitations')
            .update({ status: 'revoked', revoked_at: new Date().toISOString() })
            .eq('id', invId)

        if (!error) {
            await supabase.from('audit_logs').insert({
                actor_id: currentUser.id,
                action: 'invitation_revoked',
                target_email: invEmail,
            })
            loadInvitations()
        }
    }

    const statusColors = {
        pending: 'admin-badge-pending',
        accepted: 'admin-badge-active',
        revoked: 'admin-badge-inactive',
    }

    const statusLabels = {
        pending: 'Pendiente',
        accepted: 'Aceptada',
        revoked: 'Revocada',
    }

    return (
        <div>
            {/* Invitation Form */}
            <form onSubmit={sendInvitation} className="admin-invite-form">
                <div className="admin-invite-fields">
                    <div className="admin-invite-email">
                        <Mail className="admin-invite-icon" />
                        <input
                            type="email"
                            placeholder="Email del nuevo usuario..."
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="admin-invite-input"
                            required
                        />
                    </div>
                    <select
                        value={role}
                        onChange={(e) => setRole(e.target.value)}
                        className="admin-invite-select"
                    >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                    </select>
                    <button type="submit" disabled={sending} className="admin-btn-primary">
                        {sending ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                        ) : (
                            <>
                                <Send className="w-4 h-4" />
                                <span>Enviar invitación</span>
                            </>
                        )}
                    </button>
                </div>
                {message && (
                    <div className={cn("admin-message", message.type === 'error' ? "admin-message-error" : "admin-message-success")}>
                        {message.type === 'error' ? <AlertCircle className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                        {message.text}
                    </div>
                )}
            </form>

            {/* Invitations List */}
            {loading ? (
                <div className="admin-loading">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                </div>
            ) : (
                <div className="admin-table-wrapper">
                    <table className="admin-table">
                        <thead>
                            <tr>
                                <th>Email</th>
                                <th>Rol</th>
                                <th>Estado</th>
                                <th>Invitado por</th>
                                <th>Fecha</th>
                                <th>Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {invitations.map(inv => (
                                <tr key={inv.id}>
                                    <td className="admin-user-email font-medium">{inv.email}</td>
                                    <td>
                                        <span className={cn("admin-badge", inv.role === 'admin' ? "admin-badge-admin" : "admin-badge-user")}>
                                            {inv.role}
                                        </span>
                                    </td>
                                    <td>
                                        <span className={cn("admin-badge", statusColors[inv.status])}>
                                            {statusLabels[inv.status]}
                                        </span>
                                    </td>
                                    <td className="admin-user-email">
                                        {inv.inviter?.full_name || inv.inviter?.email || '—'}
                                    </td>
                                    <td className="admin-date">
                                        {new Date(inv.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
                                    </td>
                                    <td>
                                        {inv.status === 'pending' && (
                                            <button
                                                onClick={() => revokeInvitation(inv.id, inv.email)}
                                                className="admin-btn-sm admin-btn-deactivate"
                                                title="Revocar invitación"
                                            >
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {invitations.length === 0 && (
                        <div className="admin-empty">No hay invitaciones aún</div>
                    )}
                </div>
            )}
        </div>
    )
}

/* ─────────────── LOGS TAB ─────────────── */
function LogsTab() {
    const [logs, setLogs] = useState([])
    const [loading, setLoading] = useState(true)

    async function loadLogs() {
        setLoading(true)
        const { data, error } = await supabase
            .from('audit_logs')
            .select('*, actor:actor_id(email, full_name)')
            .order('created_at', { ascending: false })
            .limit(100)

        if (error) console.error('Error loading logs:', error)
        setLogs(data || [])
        setLoading(false)
    }

    useEffect(() => { loadLogs() }, [])

    const actionLabels = {
        user_registered: '🆕 Registro',
        user_logout: '👋 Logout',
        role_changed: '🔄 Cambio de rol',
        user_deactivated: '🚫 Desactivado',
        user_activated: '✅ Activado',
        invitation_created: '📧 Invitación enviada',
        invitation_revoked: '❌ Invitación revocada',
    }

    return (
        <div>
            <div className="admin-section-header">
                <h3 className="admin-section-title">Últimas 100 acciones</h3>
                <button onClick={loadLogs} className="admin-btn-icon" title="Refrescar">
                    <RefreshCw className="w-4 h-4" />
                </button>
            </div>

            {loading ? (
                <div className="admin-loading">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                </div>
            ) : (
                <div className="admin-table-wrapper">
                    <table className="admin-table">
                        <thead>
                            <tr>
                                <th>Fecha</th>
                                <th>Actor</th>
                                <th>Acción</th>
                                <th>Objetivo</th>
                                <th>Detalles</th>
                            </tr>
                        </thead>
                        <tbody>
                            {logs.map(log => (
                                <tr key={log.id}>
                                    <td className="admin-date whitespace-nowrap">
                                        {new Date(log.created_at).toLocaleString('es-ES', {
                                            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                                        })}
                                    </td>
                                    <td className="admin-user-email">
                                        {log.actor?.full_name || log.actor?.email || '—'}
                                    </td>
                                    <td>
                                        <span className="admin-log-action">
                                            {actionLabels[log.action] || log.action}
                                        </span>
                                    </td>
                                    <td className="admin-user-email">{log.target_email || '—'}</td>
                                    <td className="admin-date">
                                        {log.details ? (
                                            <span className="admin-log-details">
                                                {Object.entries(log.details).map(([k, v]) => `${k}: ${v}`).join(', ')}
                                            </span>
                                        ) : '—'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {logs.length === 0 && (
                        <div className="admin-empty">No hay actividad registrada aún</div>
                    )}
                </div>
            )}
        </div>
    )
}
