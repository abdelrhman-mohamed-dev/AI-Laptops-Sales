import "cheerio";
import { TogetherAIEmbeddings } from "@langchain/community/embeddings/togetherai";
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { PineconeStore } from "@langchain/pinecone";
import { Pinecone as PineconeClient } from "@pinecone-database/pinecone";
import dotenv from "dotenv";
// import { Laptops } from "@/data/teamx";
import { Laptops } from "@/data/products";
import { Document } from "@langchain/core/documents";

dotenv.config();

export function toAsciiId(title) {
  return Buffer.from(title, "utf-8").toString("base64").replace(/=+$/, ""); // Base64 encode and remove padding
}

export async function POST(req) {
  try {
    const { userPrompt } = await req.json(); // Extracting user prompt from the request body

    const pinecone = new PineconeClient();
    const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX);

    const embeddings = new TogetherAIEmbeddings({
      model: "togethercomputer/m2-bert-80M-8k-retrieval",
    });

    const vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
      pineconeIndex,
      maxConcurrency: 5,
    });

    // Function to store manhwa data in Pinecone
    const storeManhwaInPinecone = async () => {
      for (const manhwa of Laptops) {
        const doc = new Document({
          pageContent: `Title: ${manhwa.title}\nDescription: ${
            manhwa.description
          }\nGenre: ${manhwa.genre.join(", ")}`,
          metadata: {
            title: manhwa.title,
            url: manhwa.url,
            thumbnailUrl: manhwa.thumbnailUrl,
            genre: manhwa.genre,
          },
        });

        const id = manhwa.title.replace(/\s+/g, "-").toLowerCase();
        await vectorStore.addDocuments([doc], { ids: [id] });

        console.log(`Stored manhwa: ${manhwa.title}`);
      }

      console.log("All manhwa data stored in Pinecone.");
      return "All manhwa data stored in Pinecone.";
    };

    // If you need to call the function to store the data:
    // await storeManhwaInPinecone();

    const retriever = vectorStore.asRetriever({
      k: 5,
    });

    const prompt = ChatPromptTemplate.fromMessages([
      [
        "human",
        `أنت مندوب مبيعات خبير في تقديم أفضل الحلول للمستخدمين. لديك قائمة بأحدث أجهزة اللابتوب مع تفاصيل المواصفات والأسعار.
        استخدم المعلومات المقدمة من المستخدم لتحديد أفضل جهاز لابتوب يناسب احتياجاته، سواء كانت للاستخدام اليومي أو الأعمال المكتبية أو الألعاب. قدم توصياتك بناءً على المواصفات، السعر، وتوافر الجهاز في المخزون.
        إذا لم يكن الجهاز المطلوب متوفراً، اقترح أقرب بديل يلبي احتياجاته بنفس الجودة أو أفضل.
        حافظ على إجابتك موجزة وواضحة بحيث تحتوي على الميزات الأساسية للجهاز المقترح.
        تحدث بالمصريه العاميه وليس اللغه العربيه الفصحي.
        السؤال: {question}
        السياق: {context}
        الإجابة:`,
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

    const retrievedDocs = await retriever.invoke(userPrompt); // Using user's prompt for document retrieval

    const results = await ragChain.invoke({
      question: userPrompt,
      context: retrievedDocs,
    });

    return Response.json({ retrievedDocs, question: userPrompt, results });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

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
