'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { marked } from 'marked'
import { v4 as uuidv4 } from 'uuid'
import { PlusCircle, Send, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function AIAgentChatbot() {
    const [messages, setMessages] = useState([])
    const [input, setInput] = useState('')
    const [isTyping, setIsTyping] = useState(false)
    const [sessionId, setSessionId] = useState('')
    const [error, setError] = useState('')
    const scrollAreaRef = useRef(null)
    const router = useRouter()

    useEffect(() => {
        const newSessionId = uuidv4()
        setSessionId(newSessionId)
        // window.history.pushState({}, '', `/chat/${newSessionId}`)
    }, [])

    useEffect(() => {
        scrollToBottom()
    }, [messages])

    const scrollToBottom = () => {
        if (scrollAreaRef.current) {
            const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]')
            if (scrollContainer) {
                scrollContainer.scrollTop = scrollContainer.scrollHeight
            }
        }
    }
    const handleSubmit = async (e) => {
        e.preventDefault()
        if (input.trim() === '') return

        const userMessage = {
            id: Date.now(),
            text: input.trim(),
            sender: 'user'
        }

        setMessages(prevMessages => [...prevMessages, userMessage])
        setInput('')
        setIsTyping(true)
        setError('')

        try {
            const response = await fetch('/api/rag', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ userPrompt: input.trim(), sessionId }),
            })

            if (!response.ok) {
                throw new Error('Failed to get response from AI Agent')
            }

            const responseData = await response.json()
            console.log('Response Data:', responseData)

            setMessages(responseData.history.map((entry, index) => ({
                id: index,
                text: entry.content,
                sender: entry.role === 'human' ? 'user' : 'agent'
            })))

        } catch (error) {
            console.error('Error:', error)
            setError('Sorry, I encountered an error. Please try again.')
        } finally {
            setIsTyping(false)
        }
    }

    const startNewChat = () => {
        const newSessionId = uuidv4()
        setSessionId(newSessionId)
        setMessages([])
        // Update URL without navigation
        // window.history.pushState({}, '', `/chat/${newSessionId}`)
    }
    return (
        <div className="flex flex-col md:flex-row h-screen bg-gray-100">
            {/* Sidebar */}
            <div className="w-full md:w-64 bg-gray-800 text-white p-4">
                <Button onClick={startNewChat} className="w-full mb-4 bg-gray-700 hover:bg-gray-600">
                    <PlusCircle className="mr-2 h-4 w-4" /> New Chat
                </Button>
                <div className="text-sm opacity-50">Chat history will appear here</div>
            </div>

            {/* Main content */}
            <div className="flex-1 flex flex-col">
                <Card className="flex-1 flex flex-col overflow-hidden">
                    <CardHeader className="bg-white shadow-sm z-10">
                        <CardTitle className="text-xl font-semibold text-right">دور علي الابتوب المناسب بالذكاء الاصطناعي</CardTitle>
                    </CardHeader>
                    <CardContent className="flex-1 p-0 overflow-hidden">
                        <ScrollArea className="h-full" ref={scrollAreaRef}>
                            <div className="p-4">
                                {messages.map(message => (
                                    <div
                                        key={message.id}
                                        className={`mb-4 ${message.sender === 'user' ? 'text-right' : 'text-left'}`}
                                    >
                                        <div
                                            dir='rtl'
                                            className={`inline-block p-3 rounded-lg ${message.sender === 'user'
                                                ? 'bg-primary text-primary-foreground'
                                                : 'bg-secondary text-secondary-foreground'
                                                } max-w-[80%]`}
                                            dangerouslySetInnerHTML={{
                                                __html: message.sender === 'agent' ? marked(message.text) : message.text
                                            }}
                                        />
                                    </div>
                                ))}
                                {isTyping && (
                                    <div className="text-muted-foreground italic">AI is typing...</div>
                                )}
                                {error && (
                                    <div className="text-destructive mt-2">{error}</div>
                                )}
                            </div>
                        </ScrollArea>
                    </CardContent>
                </Card>

                {/* Input form */}
                <div className="p-4 bg-background border-t">
                    <form onSubmit={handleSubmit} className="flex gap-2">
                        <Input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Type your message..."
                            className="flex-grow"
                            disabled={isTyping}
                        />
                        <Button type="submit" className="bg-primary hover:bg-primary/90" disabled={isTyping}>
                            {isTyping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        </Button>
                    </form>
                </div>
            </div>
        </div>
    )
}