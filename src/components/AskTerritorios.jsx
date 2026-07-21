import { useState, useRef, useEffect } from 'react'
import { Sparkles, X, Loader2, Send } from 'lucide-react'
import { supabase } from '../lib/supabase'

// Renderizado ligero del markdown que devuelve el modelo (negritas, listas,
// encabezados y párrafos). Construye elementos React directamente, sin
// dangerouslySetInnerHTML, para no introducir una dependencia nueva ni
// riesgo de inyección de HTML.
function renderInline(text, keyPrefix) {
    const parts = text.split(/(\*\*[^*]+\*\*)/g)
    return parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={`${keyPrefix}-b${i}`}>{part.slice(2, -2)}</strong>
        }
        return <span key={`${keyPrefix}-t${i}`}>{part}</span>
    })
}

// En móvil el teclado del sistema se superpone al viewport sin cambiar las
// unidades vh/dvh, por lo que un modal con altura fija se sale de la pantalla.
// Seguimos el VisualViewport para conocer el área realmente visible y ajustar
// el alto y la posición del modal justo encima del teclado.
function useVisualViewport() {
    const [viewport, setViewport] = useState(null)

    useEffect(() => {
        const vv = typeof window !== 'undefined' ? window.visualViewport : null
        if (!vv) return

        const update = () => setViewport({ height: vv.height, offsetTop: vv.offsetTop })
        update()
        vv.addEventListener('resize', update)
        vv.addEventListener('scroll', update)
        return () => {
            vv.removeEventListener('resize', update)
            vv.removeEventListener('scroll', update)
        }
    }, [])

    return viewport
}

function renderMarkdownLite(text) {
    const lines = text.split('\n')
    const elements = []
    let listBuffer = []

    const flushList = () => {
        if (listBuffer.length === 0) return
        elements.push(
            <ul key={`ul-${elements.length}`} className="list-disc list-inside space-y-0.5">
                {listBuffer.map((item, i) => (
                    <li key={i}>{renderInline(item, `li-${elements.length}-${i}`)}</li>
                ))}
            </ul>
        )
        listBuffer = []
    }

    lines.forEach((line) => {
        const trimmed = line.trim()
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            listBuffer.push(trimmed.slice(2))
            return
        }
        flushList()
        if (trimmed === '') return
        const heading = trimmed.match(/^#+\s*(.+)/)
        if (heading) {
            elements.push(
                <p key={`h-${elements.length}`} className="font-semibold">
                    {renderInline(heading[1], `h-${elements.length}`)}
                </p>
            )
        } else {
            elements.push(
                <p key={`p-${elements.length}`}>{renderInline(trimmed, `p-${elements.length}`)}</p>
            )
        }
    })
    flushList()

    return elements
}

export function AskTerritorios() {
    const [isOpen, setIsOpen] = useState(false)
    const [messages, setMessages] = useState([]) // { role: 'user' | 'assistant', content: string }
    const [question, setQuestion] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const scrollRef = useRef(null)
    const viewport = useVisualViewport()

    // Constrain the overlay to the actually-visible area so the sheet never
    // grows past the viewport or hides behind the on-screen keyboard.
    const overlayStyle = viewport
        ? { top: viewport.offsetTop, height: viewport.height, bottom: 'auto' }
        : undefined

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
    }, [messages, loading, isOpen])

    const handleSubmit = async (e) => {
        e.preventDefault()
        const trimmed = question.trim()
        if (!trimmed || loading) return

        const nextMessages = [...messages, { role: 'user', content: trimmed }]
        setMessages(nextMessages)
        setQuestion('')
        setLoading(true)
        setError('')

        try {
            const { data, error: invokeError } = await supabase.functions.invoke('ask-territorios', {
                body: { messages: nextMessages },
            })

            if (invokeError) throw invokeError
            if (data?.error) throw new Error(data.error)

            setMessages([...nextMessages, { role: 'assistant', content: data.answer }])
        } catch (err) {
            console.error('[AskTerritorios] Error:', err)
            setError('No se pudo obtener una respuesta. Inténtalo de nuevo.')
        } finally {
            setLoading(false)
        }
    }

    const handleNewConversation = () => {
        setMessages([])
        setError('')
    }

    return (
        <>
            <button
                onClick={() => setIsOpen(true)}
                className="fixed bottom-[68px] right-4 sm:bottom-6 sm:right-6 z-40 flex items-center gap-2 px-4 py-3 rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700 transition-colors"
                title="Preguntar sobre los territorios"
            >
                <Sparkles className="w-5 h-5" />
                <span className="hidden sm:inline text-sm font-medium">Preguntar</span>
            </button>

            {isOpen && (
                <div
                    className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40"
                    style={overlayStyle}
                    onClick={() => setIsOpen(false)}
                >
                    <div
                        className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-xl flex flex-col h-[85dvh] max-h-full sm:h-[600px]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
                            <div className="flex items-center gap-2">
                                <Sparkles className="w-5 h-5 text-blue-600" />
                                <h3 className="font-semibold text-gray-900">Pregunta sobre los territorios</h3>
                            </div>
                            <div className="flex items-center gap-1">
                                {messages.length > 0 && (
                                    <button
                                        onClick={handleNewConversation}
                                        className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1"
                                    >
                                        Nueva conversación
                                    </button>
                                )}
                                <button
                                    onClick={() => setIsOpen(false)}
                                    className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                                    title="Cerrar"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        </div>

                        {/* Conversación (con scroll) */}
                        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                            {messages.length === 0 && (
                                <p className="text-sm text-gray-400 text-center mt-8">
                                    Pregunta, por ejemplo: "¿Qué territorios están vencidos en la zona X?"
                                </p>
                            )}
                            {messages.map((m, i) => (
                                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div
                                        className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm space-y-1 ${m.role === 'user'
                                            ? 'bg-blue-600 text-white whitespace-pre-wrap'
                                            : 'bg-gray-100 text-gray-800'
                                            }`}
                                    >
                                        {m.role === 'assistant' ? renderMarkdownLite(m.content) : m.content}
                                    </div>
                                </div>
                            ))}
                            {loading && (
                                <div className="flex justify-start">
                                    <div className="bg-gray-100 text-gray-500 rounded-2xl px-4 py-2 text-sm flex items-center gap-2">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Pensando...
                                    </div>
                                </div>
                            )}
                            {error && <p className="text-sm text-red-600 text-center">{error}</p>}
                        </div>

                        {/* Input */}
                        <form
                            onSubmit={handleSubmit}
                            className="flex gap-2 px-5 pt-4 pb-4 border-t border-gray-100 shrink-0"
                            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
                        >
                            <input
                                type="text"
                                value={question}
                                onChange={(e) => setQuestion(e.target.value)}
                                placeholder="Escribe tu pregunta..."
                                disabled={loading}
                                autoFocus
                                className="flex-1 rounded-xl border border-gray-200 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                            />
                            <button
                                type="submit"
                                disabled={loading || !question.trim()}
                                className="flex items-center justify-center w-10 h-10 rounded-xl bg-blue-600 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors shrink-0"
                                title="Enviar"
                            >
                                <Send className="w-4 h-4" />
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </>
    )
}
