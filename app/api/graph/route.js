import { tool } from "@langchain/core/tools";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import { StateGraph, StateGraphArgs } from "@langchain/langgraph";
import { MemorySaver, Annotation } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { NextResponse } from "next/server";
import dotenv from "dotenv";

dotenv.config();

export async function GET(req) {
    try {
        const GraphState = Annotation.Root({
            messages: Annotation({
                reducer: (x, y) => x.concat(y),
            }),
        });

        const search = new TavilySearchResults({
            maxResults: 2,
        });

        const weatherTool = tool(
            async ({ query }) => {
                if (
                    query.toLowerCase().includes("sf") ||
                    query.toLowerCase().includes("san francisco")
                ) {
                    return "It's 60 degrees and foggy.";
                }
                return "It's 90 degrees and sunny.";
            },
            {
                name: "weather",
                description: "Call to get the current weather for a location.",
                schema: z.object({
                    query: z
                        .string()
                        .describe("The query to use in your search."),
                }),
            }
        );

        const tools = [search];
        const toolNode = new ToolNode(tools);

        const model = new ChatGoogleGenerativeAI({
            model: "gemini-1.5-pro",
            maxOutputTokens: 2048,
            apiKey: process.env.GOOGLE_API_KEY,
        }).bindTools(tools);

        //when it stop
        function shouldContinue(state) {
            const messages = state.messages;
            const lastMessage = messages[messages.length - 1];

            if (lastMessage.tool_calls?.length) {
                return "tools";
            }
            return "__end__";
        }

        async function callModel(state) {
            const messages = state.messages;
            const response = await model.invoke(messages);

            return { messages: [response] };
        }

        const workflow = new StateGraph(GraphState)
            .addNode("agent", callModel)
            .addNode("tools", toolNode)
            .addEdge("__start__", "agent")
            .addConditionalEdges("agent", shouldContinue)
            .addEdge("tools", "agent");

        const checkpointer = new MemorySaver();

        const app = workflow.compile({ checkpointer });

        const finalState = await app.invoke(
            {
                messages: [
                    new HumanMessage("who is winning gold olympics 2024"),
                ],
            },
            { configurable: { thread_id: "42" } }
        );

        return NextResponse.json({
            response: finalState,
        });
    } catch (error) {
        console.log(error);
        return NextResponse.json(error.message);
    }
}
