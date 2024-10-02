// Import necessary libraries and components

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatMessageHistory } from "langchain/stores/message/in_memory";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { Ollama } from "@langchain/ollama";

// Create a chat history to store messages
const mainChatMessageHistory = new ChatMessageHistory();

// Define the main function that handles POST requests

export async function POST(req) {
    try {
        // Get the user's question from the request

        const { question } = await req.json();
        // Set up the AI model (Ollama) with specific configurations
        const model = new Ollama({
            model: "codeqwen",
            baseUrl: "http://localhost:11434",
            stream: true,
        });

        // Add the user's question to the chat history
        await mainChatMessageHistory.addMessage(new HumanMessage(question));
        // Create a stream to handle the AI's response
        const stream = new ReadableStream({
            async start(controller) {
                let fullResponse = "";
                let buffer = "";
                let lastWord = "";
                // Process the AI's response in chunks

                for await (const chunk of await model.stream(question)) {
                    fullResponse += chunk;
                    buffer += chunk;
                    // Split the buffer into words
                    console.log(chunk);
                    const words = buffer.split(/\s+/);
                    // If we have 15 or more words, send them to the client
                    if (words.length >= 15) {
                        const completeWords = words.slice(0, -1).join(" ");
                        controller.enqueue(
                            new TextEncoder().encode(
                                JSON.stringify({
                                    text: completeWords,
                                    lastWord: lastWord,
                                })
                            )
                        );
                        // Keep the last word in the buffer

                        buffer = words[words.length - 1];
                        lastWord = completeWords.split(/\s+/).pop();
                    }
                }
                // Send any remaining content

                if (buffer) {
                    controller.enqueue(
                        new TextEncoder().encode(
                            JSON.stringify({
                                text: buffer,
                                lastWord: lastWord,
                                isLast: true,
                            })
                        )
                    );
                }
                // Add the AI's full response to the chat history
                await mainChatMessageHistory.addMessage(
                    new AIMessage(fullResponse)
                );
                controller.close();
            },
        });
        // Return the stream as the response

        return new Response(stream, {
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        // Handle any errors and return an error response

        console.error(error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
