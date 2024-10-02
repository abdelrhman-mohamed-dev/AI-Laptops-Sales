import "cheerio";
import { TogetherAIEmbeddings } from "@langchain/community/embeddings/togetherai";
import { PineconeStore } from "@langchain/pinecone";
import { Pinecone as PineconeClient } from "@pinecone-database/pinecone";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import dotenv from "dotenv";

dotenv.config();

// In-memory store for conversation history
let conversationHistory = [];

export function toAsciiId(title) {
  return Buffer.from(title, "utf-8").toString("base64").replace(/=+$/, "");
}

export async function POST(req) {
  try {
    const { userPrompt } = await req.json();

    const pinecone = new PineconeClient();
    const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX);

    const embeddings = new TogetherAIEmbeddings({
      model: "togethercomputer/m2-bert-80M-8k-retrieval",
    });

    const vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
      pineconeIndex,
      maxConcurrency: 5,
    });

    const retriever = vectorStore.asRetriever({ k: 5 });

    // Update prompt to include conversation history
    const prompt = ChatPromptTemplate.fromMessages([
      [
        "system",
        "أنت مندوب مبيعات خبير في تقديم أفضل الحلول للمستخدمين. لديك قائمة بأحدث أجهزة اللابتوب مع تفاصيل المواصفات والأسعار.",
      ],
      [
        "human",
        "هذه هي المحادثة السابقة:\n{history}\n\nسؤال المستخدم الحالي: {question}\n\nالسياق: {context}\n\nالرجاء الرد على السؤال الحالي مع مراعاة المحادثة السابقة. تحدث بالمصرية العامية:",
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

    const retrievedDocs = await retriever.invoke(userPrompt);

    // Prepare conversation history
    const historyText = conversationHistory
      .map((entry) => `${entry.role}: ${entry.content}`)
      .join("\n");

    const results = await ragChain.invoke({
      history: historyText,
      question: userPrompt,
      context: retrievedDocs,
    });

    // Update conversation history
    conversationHistory.push({ role: "human", content: userPrompt });
    conversationHistory.push({ role: "assistant", content: results });

    // Keep only the last 10 messages to limit context size
    if (conversationHistory.length > 10) {
      conversationHistory = conversationHistory.slice(-10);
    }

    return Response.json({
      retrievedDocs,
      question: userPrompt,
      results,
      history: conversationHistory,
    });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// The GET function remains unchanged
export async function GET(req) {
  try {
    // Initialize Pinecone and get the index
    const pinecone = new PineconeClient();
    const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX); // Index name from your environment variables

    const embeddings = new TogetherAIEmbeddings({
      model: "togethercomputer/m2-bert-80M-8k-retrieval", // Default model for embedding
    });

    const vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
      pineconeIndex,
      maxConcurrency: 5, // Adjust concurrency if needed
    });

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const storeManhwaInPinecone = async () => {
      const batchSize = 20; // Define the batch size
      for (let i = 0; i < Laptops.length; i += batchSize) {
        const batch = Laptops.slice(i, i + batchSize);

        for (const laptop of batch) {
          const doc = new Document({
            pageContent: `Name (AR): ${laptop.name_ar}\nName (EN): ${laptop.name_en}\nPrice: ${laptop.price}\nIn Stock: ${laptop.in_stock}\nAdditional Features: ${laptop.additional_features}`,
            metadata: {
              name_ar: laptop.name_ar,
              name_en: laptop.name_en,
              price: laptop.price,
              quantity: laptop.quantity,
              in_stock: laptop.in_stock,
              additional_features: laptop.additional_features,
            },
          });

          // const id = manhwa.title.replace(/\s+/g, "-").toLowerCase();
          const id = toAsciiId(laptop.name_ar); // Convert title to ASCII ID
          await vectorStore.addDocuments([doc], { ids: [id] });

          console.log(`Stored laptop: ${laptop.name_en}`);
        }

        console.log(`Stored batch of ${batch.length} laptop.`);
        // Wait for 1 minute before processing the next batch
        await sleep(500); // 60000 ms = 1 minute
      }

      console.log("All laptop data stored in Pinecone.");
      return "All laptop data stored in Pinecone.";
    };

    await storeManhwaInPinecone();

    return new Response(
      JSON.stringify({ message: "All laptops data stored in Pinecone." }),
      { status: 200 }
    );
  } catch (error) {
    console.error("Error storing laptop data in Pinecone:", error);
    return new Response(
      JSON.stringify({
        error: "Error occurred while storing labtop data.",
      }),
      { status: 500 }
    );
  }
}

function generateNumberStrings(arrayLength) {
  return Array.from({ length: arrayLength }, (_, i) => (i + 1).toString());
}
