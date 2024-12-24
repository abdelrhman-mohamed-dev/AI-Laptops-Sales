import "cheerio";
import { PineconeStore } from "@langchain/pinecone";
import { Pinecone as PineconeClient } from "@pinecone-database/pinecone";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import dotenv from "dotenv";
import { Laptops } from "@/data/products";
import { Document } from "@langchain/core/documents";
import Together from "together-ai";

dotenv.config(); // Load environment variables

// Initialize Together API client
const together = new Together(process.env.TOGETHER_API_KEY);

// In-memory storage for conversation and retrieval results
const conversationHistories = new Map();
const retrievalResults = new Map();

// Helper function to encode a string to Base64 for unique IDs
export function toAsciiId(title) {
  return Buffer.from(title, "utf-8").toString("base64").replace(/=+$/, "");
}

// Handle CORS preflight requests
export async function OPTIONS(req) {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400", // Cache preflight for 24 hours
    },
  });
}

// Main POST handler for processing user input
export async function POST(req) {
  try {
    const { userPrompt, sessionId } = await req.json();

    // Retrieve or initialize conversation history for the session
    let conversationHistory = conversationHistories.get(sessionId) || [];

    // Initialize Pinecone client and index
    const pinecone = new PineconeClient();
    const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX);

    // Helper function to retrieve embeddings from Together AI
    async function getEmbeddings(text) {
      const response = await together.embeddings.create({
        model: "togethercomputer/m2-bert-80M-8k-retrieval",
        input: text,
      });
      return response.data[0].embedding;
    }

    // Function to combine user prompts for better context
    function combineUserPrompts(history, currentPrompt, maxPrompts = 1) {
      const recentPrompts = history
        .filter((entry) => entry.role === "human")
        .map((entry) => entry.content)
        .slice(-maxPrompts);
      recentPrompts.push(currentPrompt);
      return recentPrompts.join(" ");
    }

    // Combine user prompts for embedding generation
    const combinedUserPrompts = combineUserPrompts(conversationHistory, userPrompt);

    let promptEmbedding;
    try {
      promptEmbedding = await getEmbeddings(combinedUserPrompts);
    } catch (error) {
      console.error("Error generating embeddings:", error);
      return Response.json(
        { error: "Failed to generate embeddings", details: error.message },
        { status: 500 }
      );
    }

    // Initialize Pinecone vector store
    const vectorStore = await PineconeStore.fromExistingIndex({
      embedQuery: getEmbeddings,
    }, {
      pineconeIndex,
      maxConcurrency: 20,
    });

    // Perform semantic search
    const semanticResults = await vectorStore.similaritySearch(combinedUserPrompts, 20);

    // Filter in-stock documents
    const inStockDocs = semanticResults.filter((doc) => doc.metadata.in_stock !== 0);

    // Ensure minimum results by performing additional search if needed
    if (inStockDocs.length < 20) {
      const additionalResults = await vectorStore.similaritySearch(combinedUserPrompts, 20);
      inStockDocs.push(...additionalResults);
    }

    // Deduplicate results
    const uniqueInStockDocs = Array.from(
      new Set(
        inStockDocs.map((doc) =>
          JSON.stringify({
            pageContent: doc.pageContent,
            metadata: doc.metadata,
          })
        )
      )
    ).map(JSON.parse).map((parsed) => {
      const doc = new Document(parsed);
      doc.score = parsed.score; // Preserve score if available
      return doc;
    });

    // Sort by relevance and limit results
    uniqueInStockDocs.sort((a, b) => (b.score || 0) - (a.score || 0));
    const topResults = uniqueInStockDocs.slice(0, 10);

    // Create AI prompt for response generation
    const prompt = ChatPromptTemplate.fromMessages([
      [
        "system",
        `أنت مندوب مبيعات متخصص في اللابتوبات. قدم النصيحة بناءً على التفاصيل المتوفرة واحتياجات العميل.`
      ],
      [
        "human",
        "دي المحادثة السابقة:\n{history}\n\nسؤال العميل الحالي: {question}\n\nالسياق: {context}\n\nالرد باللهجة المصرية العامية."
      ],
    ]);

    const model = new ChatGoogleGenerativeAI({
      model: "gemini-1.5-pro",
      maxOutputTokens: 2048,
      apiKey: process.env.GOOGLE_API_KEY,
    });

    const ragChain = await createStuffDocumentsChain({
      llm: model,
      prompt,
      outputParser: new StringOutputParser(),
    });

    // Format conversation history for AI model
    const historyText = conversationHistory
      .map((entry) => `${entry.role}: ${entry.content}`)
      .join("\n");

    // Generate AI response
    const results = await ragChain.invoke({
      history: historyText,
      question: userPrompt,
      context: inStockDocs,
    });

    // Update conversation history
    conversationHistory.push({ role: "human", content: userPrompt });
    conversationHistory.push({ role: "assistant", content: results });
    if (conversationHistory.length > 20) {
      conversationHistory = conversationHistory.slice(-20);
    }
    conversationHistories.set(sessionId, conversationHistory);

    return Response.json({
      inStockDocs,
      question: userPrompt,
      results,
      history: conversationHistory,
    });
  } catch (error) {
    console.error("Error in POST handler:", error);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// Handler for storing laptops in Pinecone (for GET requests)
export async function GET(req) {
  try {
    const pinecone = new PineconeClient();
    const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX);

    const vectorStore = await PineconeStore.fromExistingIndex({
      embedQuery: getEmbeddings,
    }, {
      pineconeIndex,
      includeValues: true,
      includeMetadata: true,
      maxConcurrency: 10,
    });

    const batchSize = 20;
    for (let i = 0; i < Laptops.length; i += batchSize) {
      const batch = Laptops.slice(i, i + batchSize);
      for (const laptop of batch) {
        const doc = new Document({
          pageContent: `${laptop.name_ar}, ${laptop.name_en}, السعر: ${laptop.price} جنيه, In Stock: ${laptop.in_stock ? "متوفر" : "غير متوفر"}`,
          metadata: laptop,
        });
        await vectorStore.addDocuments([doc], { ids: [`laptop-${laptop.name_en}`] });
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return Response.json({ message: "All laptops stored successfully." });
  } catch (error) {
    console.error("Error in GET handler:", error);
    return Response.json({ error: "Failed to store laptops." }, { status: 500 });
  }
}
