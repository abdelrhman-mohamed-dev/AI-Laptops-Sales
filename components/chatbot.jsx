'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { marked } from 'marked';
import { v4 as uuidv4 } from 'uuid'; // Import UUID library
import { PlusCircle, Send } from 'lucide-react';

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
            // Log all the response data to the console
            console.log('Response Data:', responseData);
            console.log('In Stock Docs:', responseData.inStockDocs);
            console.log('Question:', responseData.question);
            console.log('Results:', responseData.results);
            console.log('Conversation History:', responseData.history);

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
        <div className="flex h-screen bg-gray-100">
            <div className="w-64 bg-gray-800 text-white p-4">
                <Button onClick={startNewChat} className="w-full mb-4 bg-gray-700 hover:bg-gray-600">
                    <PlusCircle className="mr-2 h-4 w-4" /> New Chat
                </Button>
                <div className="text-sm opacity-50">Chat history will appear here</div>
            </div>
            <div className="flex-1 flex flex-col">
                <div className="bg-white shadow-sm z-10">
                    <h1 className="text-xl font-semibold p-4 text-right">{"دور علي الابتوب المناسب بالذكاء الاصطناعي"}</h1>
                </div>
                <ScrollArea className="flex-1 p-4" ref={scrollAreaRef}>
                    {messages.map(message => (
                        <div
                            key={message.id}
                            className={`mb-4 ${message.sender === 'user' ? 'text-right' : 'text-left'}`}
                        >
                            <div
                                dir='rtl'
                                className={`text-right inline-block p-3 rounded-lg ${message.sender === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-800'
                                    } max-w-[80%]`}
                                dangerouslySetInnerHTML={{
                                    __html: message.sender === 'agent' ? marked(message.text) : message.text
                                }}
                            />
                        </div>
                    ))}
                    {isTyping && (
                        <div className="text-gray-500 italic">AI is typing...</div>
                    )}
                </ScrollArea>
                <div className="p-4 bg-white border-t">
                    <form onSubmit={handleSubmit} className="flex gap-2">
                        <Input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Type your message..."
                            className="flex-grow"
                        />
                        <Button type="submit" className="bg-green-500 hover:bg-green-600">
                            <Send className="h-4 w-4" />
                        </Button>
                    </form>
                </div>
            </div>
        </div>
    );
}