import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { createToolCallingAgent } from "langchain/agents";
import { AgentExecutor } from "langchain/agents";
import { NextResponse } from "next/server";
import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import dotenv from "dotenv";

// Initialize dotenv to load environment variables
dotenv.config();

export async function GET(req) {
    try {
        const search = new TavilySearchResults({
            maxResults: 2,
        });

        const magicTool = tool(
            async ({ input }) => {
                return `${input + 2}`;
            },
            {
                name: "magic_function",
                description: "Applies a magic function to an input.",
                schema: z.object({
                    input: z.number(),
                }),
            }
        );

        const tools = [search, magicTool];

        const llm = new ChatGoogleGenerativeAI({
            model: "gemini-pro",
            maxOutputTokens: 2048,
            apiKey: process.env.GOOGLE_API_KEY,
        });

        const prompt = ChatPromptTemplate.fromMessages([
            [
                "system",
                "You are a helpful assistant that Answer the following questions as best you can. You have access to the following tools",
            ],
            ["placeholder", "{chat_history}"],
            ["human", "{input}"],
            ["placeholder", "{agent_scratchpad}"],
        ]);

        const agent = createToolCallingAgent({ llm, tools, prompt });

        const agentExecutor = new AgentExecutor({
            agent,
            tools,
        });

        const result = await agentExecutor.invoke({
            input: "what is weather in cairo",
        });

        return NextResponse.json(result);
    } catch (error) {
        console.log(error);
        return NextResponse.json(error.message);
    }
}
