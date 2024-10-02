import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import dotenv from "dotenv";

dotenv.config();

export async function GET(req, route) {
    try {
        const { searchParams } = new URL(req.url);
        const query = searchParams.get("q");

        const llm = new ChatGoogleGenerativeAI({
            model: "gemini-1.5-pro",
            maxOutputTokens: 2048,
            apiKey: process.env.GOOGLE_API_KEY,
        });

        const search = new TavilySearchResults({
            maxResults: 10,
            apiKey: process.env.TAVILY_API_KEY,
        });

        const searchResults = await search.invoke(query);

        const prompt = ` You are an assistant for question-answering tasks. 
                         Use the following pieces of retrieved context to answer the question. 
                         If you don't know the answer,
                         just say that you don't know.
                          Question: "${query}"\n\nContext: "${searchResults}"\n\n Answer: `;

        const response = await llm.invoke(prompt);

        return Response.json({
            query,
            answer: response.content,
            sources: searchResults,
        });
    } catch (error) {
        console.error(error);
        return Response.json(
            { error: "Internal Server Error" },
            { status: 500 }
        );
    }
}
