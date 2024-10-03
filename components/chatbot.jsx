'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { marked } from 'marked';
import { v4 as uuidv4 } from 'uuid'; // Import UUID library

export default function AIAgentChatbot() {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [sessionId, setSessionId] = useState('');
    const scrollAreaRef = useRef(null);

    useEffect(() => {
        // Generate a new session ID when the component mounts
        setSessionId(uuidv4());
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const scrollToBottom = () => {
        if (scrollAreaRef.current) {
            scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (input.trim() === '') return;

        const userMessage = {
            id: Date.now(),
            text: input.trim(),
            sender: 'user'
        };

        setMessages(prevMessages => [...prevMessages, userMessage]);
        setInput('');
        setIsTyping(true);

        try {
            const response = await fetch('/api/rag', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ userPrompt: input.trim(), sessionId }),
            });

            if (!response.ok) {
                throw new Error('Failed to get response from AI Agent');
            }

            const responseData = await response.json();
            const resultsText = responseData.results;
            const conversationHistory = responseData.history;

            // Update messages with the full conversation history
            setMessages(conversationHistory.map((entry, index) => ({
                id: index,
                text: entry.content,
                sender: entry.role === 'human' ? 'user' : 'agent'
            })));

        } catch (error) {
            console.error('Error:', error);
            setMessages(prevMessages => [
                ...prevMessages,
                {
                    id: Date.now() + 1,
                    text: 'Sorry, I encountered an error. Please try again.',
                    sender: 'agent'
                }
            ]);
        } finally {
            setIsTyping(false);
        }
    };

    const startNewChat = () => {
        setSessionId(uuidv4());
        setMessages([]);
    };

    return (
        <div style={{ direction: 'rtl' }} className="flex flex-col h-screen max-w-2xl mx-auto p-4 text-right">
            <h1 className="text-2xl font-bold mb-4">(Beta)ابحث عن لابتوب مع الذكاء الاصطناعي</h1>
            <Button onClick={startNewChat} className="mb-4">Start New Chat</Button>
            <ScrollArea className="flex-grow mb-4 p-4 border rounded-md shadow-2xl " ref={scrollAreaRef}>
                {messages.map(message => (
                    <div
                        key={message.id}
                        style={{ direction: 'rtl' }}
                        className={`mb-2 p-2 rounded-lg ${message.sender === 'user' ? 'bg-blue-100 ml-auto' : 'bg-gray-100'
                            } max-w-[80%] ${message.sender === 'user' ? 'text-right' : 'text-left'}`}
                        dangerouslySetInnerHTML={{
                            __html: message.sender === 'agent' ? marked(message.text) : message.text
                        }}
                    />
                ))}
                {isTyping && (
                    <div className="text-gray-500 italic">جاري البحث ...</div>
                )}
            </ScrollArea>
            <form onSubmit={handleSubmit} className="flex gap-2 shadow-2xl">
                <Input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Type your message..."
                    className="flex-grow"
                />
                <Button type="submit">Send</Button>
            </form>
        </div>
    );
}