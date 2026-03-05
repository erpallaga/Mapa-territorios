import { useState } from 'react'
import { cn } from '../lib/utils'

export function UserAvatar({ user, className }) {
    const [error, setError] = useState(false)
    const nameStr = user?.full_name || user?.email || '?'
    const initials = nameStr.charAt(0).toUpperCase()

    if (user?.avatar_url && !error) {
        return (
            <img
                src={user.avatar_url}
                alt={nameStr}
                className={className}
                onError={() => setError(true)}
            />
        )
    }

    // Fallback: colored circle with first letter
    return (
        <div
            className={cn("flex items-center justify-center bg-indigo-500 text-white font-semibold rounded-full shrink-0", className)}
            title={nameStr}
        >
            {initials}
        </div>
    )
}
