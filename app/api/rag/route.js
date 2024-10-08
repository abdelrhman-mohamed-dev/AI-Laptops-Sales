import "cheerio";
import { TogetherAIEmbeddings } from "@langchain/community/embeddings/togetherai";
import { PineconeStore } from "@langchain/pinecone";
import { Pinecone as PineconeClient } from "@pinecone-database/pinecone";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import dotenv from "dotenv";
import { Laptops } from "@/data/products";
import { Document } from "@langchain/core/documents";

dotenv.config();
// In-memory store for conversation histories
const conversationHistories = new Map();
const retrievalResults = new Map();

export function toAsciiId(title) {
  return Buffer.from(title, "utf-8").toString("base64").replace(/=+$/, "");
}

export async function POST(req) {
  try {
    // Function to combine user prompts
    function combineUserPrompts(
      conversationHistory,
      currentPrompt,
      maxPrompts = 1
    ) {
      const userPrompts = conversationHistory
        .filter((entry) => entry.role === "human")
        .map((entry) => entry.content)
        .slice(-maxPrompts);

      userPrompts.push(currentPrompt);
      return userPrompts.join(" ");
    }

    const { userPrompt, sessionId } = await req.json();

    // Retrieve or create a new conversation history for this session
    let conversationHistory = conversationHistories.get(sessionId) || [];

    const pinecone = new PineconeClient();
    const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX);

    const embeddings = new TogetherAIEmbeddings({
      model: "togethercomputer/m2-bert-80M-8k-retrieval",
    });

    const vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
      pineconeIndex,
      maxConcurrency: 10,
    });

    // Combine only user prompts
    const combinedUserPrompts = combineUserPrompts(
      conversationHistory,
      userPrompt
    );

    console.log(
      "Combined user prompts before embeddings:",
      combinedUserPrompts
    );

    // Generate embeddings for the combined user prompts
    const promptEmbedding = await embeddings.embedQuery(combinedUserPrompts);

    console.log(
      "Combined prompts after embeddings (vector):",
      promptEmbedding.slice(0, 5) + "..."
    );

    // Combine the user's current prompt with the last few messages for context
    const contextualPrompt = [
      ...conversationHistory.slice(-3).map((entry) => entry.content),
      userPrompt,
    ].join(" ");

    // console.log("Prompt before embeddings:", contextualPrompt);

    // Generate embeddings for the contextual prompt
    // const promptEmbedding = await embeddings.embedQuery(contextualPrompt);

    // console.log(
    //   "Prompt after embeddings (vector):",
    //   promptEmbedding + "...Done..."
    // );

    // Perform semantic search
    const semanticResults = await vectorStore.similaritySearch(
      combinedUserPrompts,
      10
    );

    // Filter out documents with in_stock === 0
    const inStockDocs = semanticResults.filter(
      (doc) => doc.metadata.in_stock !== 0
    );

    // If we have less than 5 in-stock results, perform an additional search
    if (inStockDocs.length < 10) {
      const additionalResults = await vectorStore.similaritySearch(
        combinedUserPrompts,
        10
      );
      inStockDocs.push(...additionalResults);
    }

    // Deduplicate results using a Set with a custom serialization function
    const uniqueInStockDocs = Array.from(
      new Set(
        inStockDocs.map((doc) =>
          JSON.stringify({
            pageContent: doc.pageContent,
            metadata: doc.metadata,
          })
        )
      )
    )
      .map(JSON.parse)
      .map((parsed) => {
        const doc = new Document(parsed);
        doc.score = parsed.score; // Preserve the score if it exists
        return doc;
      });

    // Sort results by relevance (assuming the similarity score is available)
    uniqueInStockDocs.sort((a, b) => (b.score || 0) - (a.score || 0));

    // Limit to top 10 results
    const topResults = uniqueInStockDocs.slice(0, 10);

    console.log(topResults.length, "retrieved documents");
    // console.log(topResults);

    // const prompt = ChatPromptTemplate.fromMessages([
    //   [
    //     "system",
    //     `أنت مندوب مبيعات خبير في تقديم أفضل الحلول للمستخدمين. لديك قائمة بأحدث أجهزة اللابتوب المتاحة مع تفاصيل المواصفات والأسعار.
    //     لا تجيب علي الاسئله العامه مثل احسن جهاز او اغلي جهاز او اعرض كل ما تملك واخبره ان يحدد ميزانيه واستخدام الجهاز.
    //     لو الجهاز المطلوب ليس في القائمه لا تقترحه او تتكلم عنه تكلم عن من في القائمه فقط .
    //     تجنب الترحيب والسلام وادخل الي الموضوع المقدم.
    //     استخدم المعلومات المقدمة من المستخدم لتحديد أفضل جهاز لابتوب يناسب احتياجاته، سواء كانت للاستخدام اليومي أو الأعمال المكتبية أو الألعاب. قدم توصياتك بناءً على المواصفات، السعر، وتوافر الجهاز في المخزون من ضمن الاجهزه المدرجة في قائمتك.
    //     ركز دائماً على الجوانب الإيجابية للأجهزة المتاحة وكيف يمكنها تلبية احتياجات المستخدم.
    //     إذا كان الجهاز المطلوب غير متوفر ضمن الميزانية، اقترح بدائل مناسبة تلبي الاحتياجات الرئيسية للمستخدم وأبرز مميزاتها.
    //     حافظ على إجابتك موجزة وواضحة بحيث تحتوي على الميزات الأساسية للجهاز المقترح.
    //     لا تذكر ما إذا كان الجهاز جديدًا أو مستعملًا، فقط قدم مواصفاته ومميزاته.
    //     ركز حصريًا على موضوع أجهزة اللابتوب. إذا سأل المستخدم عن مواضيع أخرى، اقترح عليه بلطف العودة إلى موضوع اللابتوبات أو البحث عن مساعدة متخصصة في المجالات الأخرى.
    //     تحدث باللهجة المصرية العامية مع الحفاظ على الاحترافية في التعامل.
    //     تجنب استخدام عبارات سلبية أو التقليل من قيمة أي جهاز. ركز على تقديم حلول إيجابية تلبي احتياجات المستخدم بأفضل شكل ممكن.`,
    //   ],
    //   [
    //     "human",
    //     "هذه هي المحادثة السابقة:\n{history}\n\nسؤال المستخدم الحالي: {question}\n\nالسياق: {context}\n\nالرجاء الرد على السؤال الحالي مع مراعاة المحادثة السابقة. تحدث بالمصرية العامية وحافظ على الاحترافية في التعامل:",
    //   ],
    // ]);

    const prompt = ChatPromptTemplate.fromMessages([
      [
        "system",
        `أنت مندوب مبيعات خبير في تقديم أفضل الحلول للمستخدمين. لديك قائمة بأحدث أجهزة اللابتوب المتاحة مع تفاصيل المواصفات والأسعار.
        لا تجيب على الأسئلة العامة مثل "ما هو أفضل جهاز؟" أو "أغلى جهاز؟" أو "اعرض كل ما لديك." بدلاً من ذلك، اطلب من المستخدم تحديد ميزانيته واحتياجاته الخاصة بالجهاز.
        إذا لم يكن الجهاز المطلوب موجودًا في القائمة، لا تقترحه أو تتحدث عنه، بل التزم بالأجهزة المتاحة فقط.
        تجنب العبارات الترحيبية وابدأ مباشرة في الموضوع بناءً على ما يقدمه المستخدم.
        استخدم المعلومات المقدمة من المستخدم لتحديد أفضل جهاز لابتوب يناسب احتياجاته، سواء كانت للاستخدام اليومي، الأعمال المكتبية، أو الألعاب. قدم توصيات بناءً على المواصفات، السعر، وتوافر الجهاز من ضمن الأجهزة الموجودة في قائمتك.
        ركز دائمًا على الجوانب الإيجابية للأجهزة المتاحة وكيف يمكنها تلبية احتياجات المستخدم.
        إذا كان الجهاز المطلوب غير متوفر ضمن الميزانية، اقترح بدائل مناسبة تلبي احتياجاته الرئيسية، مع إبراز مميزاتها.
        اجعل إجابتك موجزة وواضحة، تحتوي فقط على الميزات الأساسية للجهاز المقترح.
        لا تذكر إذا كان الجهاز جديدًا أو مستعملًا، بل قدم فقط مواصفاته ومميزاته.
        ركز بشكل حصري على أجهزة اللابتوب. إذا سأل المستخدم عن مواضيع أخرى، وجهه بلطف للعودة إلى موضوع اللابتوبات أو البحث عن مساعدة متخصصة في هذه المجالات.
        تحدث باللهجة المصرية العامية مع الحفاظ على الاحترافية في التعامل.
        تجنب استخدام عبارات سلبية أو التقليل من قيمة أي جهاز. ركز على تقديم حلول إيجابية تلبي احتياجات المستخدم بأفضل شكل ممكن.`,
      ],
      [
        "human",
        "هذه هي المحادثة السابقة:\n{history}\n\nسؤال المستخدم الحالي: {question}\n\nالسياق: {context}\n\nالرجاء الرد على السؤال الحالي مع مراعاة المحادثة السابقة. تحدث بالمصرية العامية وحافظ على الاحترافية في التعامل:",
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

    const historyText = conversationHistory
      .map((entry) => `${entry.role}: ${entry.content}`)
      .join("\n");

    console.log(inStockDocs.length, "retrievedDocs");

    const results = await ragChain.invoke({
      history: historyText,
      question: userPrompt,
      context: inStockDocs,
    });

    // Update conversation history (only user and AI responses)
    conversationHistory.push({ role: "human", content: userPrompt });
    conversationHistory.push({ role: "assistant", content: results });

    // Keep only the last 10 messages
    if (conversationHistory.length > 10) {
      conversationHistory = conversationHistory.slice(-10);
    }

    // Save the updated history
    conversationHistories.set(sessionId, conversationHistory);

    return Response.json({
      inStockDocs,
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
    // console.log(pineconeIndex);

    const embeddings = new TogetherAIEmbeddings({
      model: "togethercomputer/m2-bert-80M-8k-retrieval", // Default model for embedding
    });

    const vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
      pineconeIndex,
      includeValues: true,
      includeMetadata: true,
      maxConcurrency: 10, // Adjust concurrency if needed
    });

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    // const storeManhwaInPinecone = async () => {
    //   const batchSize = 20; // Define the batch size
    //   for (let i = 0; i < Laptops.length; i += batchSize) {
    //     const batch = Laptops.slice(i, i + batchSize);

    //     for (const laptop of batch) {
    //       const doc = new Document({
    //         pageContent: `${laptop.name_ar}, ${laptop.name_en}, Price: ${laptop.price} جنيه,${laptop.additional_features}, ${laptop.suitable_for}`,
    //         metadata: {
    //           name_ar: laptop.name_ar,
    //           name_en: laptop.name_en,
    //           price: laptop.price,
    //           quantity: laptop.quantity,
    //           in_stock: laptop.in_stock,
    //           additional_features: laptop.additional_features,
    //           suitable_for: laptop.suitable_for,
    //         },
    //       });

    //       // const id = manhwa.title.replace(/\s+/g, "-").toLowerCase();
    //       const id = toAsciiId(laptop.name_ar); // Convert title to ASCII ID
    //       await vectorStore.addDocuments([doc], { ids: [id] });

    //       console.log(`Stored laptop: ${laptop.name_en}`);
    //     }

    //     console.log(`Stored batch of ${batch.length} laptop.`);
    //     // Wait for 1 minute before processing the next batch
    //     await sleep(500); // 60000 ms = 1 minute
    //   }

    //   console.log("All laptop data stored in Pinecone.");
    //   return "All laptop data stored in Pinecone.";
    // };

    const storeLaptopsInPinecone = async () => {
      const batchSize = 20; // Define the batch size

      for (let i = 0; i < Laptops.length; i += batchSize) {
        const batch = Laptops.slice(i, i + batchSize);

        for (let batchIndex = 0; batchIndex < batch.length; batchIndex++) {
          const laptop = batch[batchIndex];

          const doc = new Document({
            pageContent: `${laptop.name_ar}, ${laptop.name_en}, السعر: ${
              laptop.price
            } جنيه, In Stock: ${
              laptop.in_stock === 1 ? "متوفر" : "غير متوفر"
            }, ${laptop.additional_features}, ${laptop.suitable_for}`,
            metadata: {
              name_ar: laptop.name_ar,
              name_en: laptop.name_en,
              price: laptop.price,
              quantity: laptop.quantity,
              in_stock: laptop.in_stock,
              additional_features: laptop.additional_features,
              suitable_for: laptop.suitable_for,
            },
          });

          const id = `laptop-${laptop.name_en}`; // Unique ID based on position in array
          try {
            await vectorStore.addDocuments([doc], { ids: [id] });
            console.log(`Stored laptop: ${laptop.name_en}`);
          } catch (error) {
            console.error(`Error storing laptop ${laptop.name_en}:`, error);
          }
        }

        console.log(`Stored batch of ${batch.length} laptops.`);
        // Wait for 500 milliseconds before processing the next batch
        await sleep(500);
      }

      console.log("All laptop data stored in Pinecone.");
      return "All laptop data stored in Pinecone.";
    };

    await storeLaptopsInPinecone();

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
