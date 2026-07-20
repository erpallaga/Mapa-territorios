import { useState } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

export function AskTerritorios() {
    const [question, setQuestion] = useState('')
    const [answer, setAnswer] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    const handleSubmit = async (e) => {
        e.preventDefault()
        const trimmed = question.trim()
        if (!trimmed || loading) return

        setLoading(true)
        setError('')
        setAnswer('')

        try {
            const { data, error: invokeError } = await supabase.functions.invoke('ask-territorios', {
                body: { question: trimmed },
            })

            if (invokeError) throw invokeError
            if (data?.error) throw new Error(data.error)

            setAnswer(data.answer)
        } catch (err) {
            console.error('[AskTerritorios] Error:', err)
            setError('No se pudo obtener una respuesta. Inténtalo de nuevo.')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
            <div className="flex items-center gap-2 mb-4">
                <Sparkles className="w-5 h-5 text-blue-600" />
                <h3 className="font-semibold text-gray-900">Pregunta sobre los territorios</h3>
            </div>
            <form onSubmit={handleSubmit} className="flex gap-2">
                <input
                    type="text"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="¿Qué territorios están vencidos en la zona X?"
                    disabled={loading}
                    className="flex-1 rounded-xl border border-gray-200 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                />
                <button
                    type="submit"
                    disabled={loading || !question.trim()}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
                >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Preguntar'}
                </button>
            </form>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            {answer && (
                <p className="mt-3 text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-xl p-4">
                    {answer}
                </p>
            )}
        </div>
    )
}
