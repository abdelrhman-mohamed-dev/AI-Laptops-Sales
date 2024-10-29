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
import Together from "together-ai";

const together = new Together(process.env.TOGETHER_API_KEY);

dotenv.config();
// In-memory store for conversation histories
const conversationHistories = new Map();
const retrievalResults = new Map();

export function toAsciiId(title) {
  return Buffer.from(title, "utf-8").toString("base64").replace(/=+$/, "");
}
// Add OPTIONS handler for CORS preflight requests
export async function OPTIONS(req) {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400", // 24 hours cache for preflight
    },
  });
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

    // Function to get embeddings using Together AI
    async function getEmbeddings(text) {
      const response = await together.embeddings.create({
        model: "togethercomputer/m2-bert-80M-8k-retrieval",
        input: text,
      });
      return response.data[0].embedding;
    }

    // const embeddings = new TogetherAIEmbeddings({
    //   model: "togethercomputer/m2-bert-80M-8k-retrieval",
    // });

    const vectorStore = await PineconeStore.fromExistingIndex(
      {
        embedQuery: getEmbeddings,
      },
      {
        pineconeIndex,
        maxConcurrency: 20,
      }
    );

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
    // try {
    //   console.log(
    //     "Combined user prompts before embeddings:",
    //     combinedUserPrompts
    //   );

    //   const promptEmbedding = await embeddings.embedQuery(combinedUserPrompts);

    //   console.log(
    //     "Combined prompts after embeddings (vector):",
    //     promptEmbedding.slice(0, 5) + "..."
    //   );
    // } catch (error) {
    //   console.error("Error generating embeddings:", error);
    //   // You might want to return a more specific error response
    //   return Response.json(
    //     {
    //       error: "Failed to generate embeddings",
    //       details: error.message,
    //     },
    //     { status: 500 }
    //   );
    // }

    // Generate embeddings for the combined user prompts
    try {
      const promptEmbedding = await getEmbeddings(combinedUserPrompts);

      console.log(
        "Combined prompts after embeddings (vector):",
        promptEmbedding.slice(0, 5) + "..."
      );
    } catch (error) {
      console.error("Error generating embeddings:", error);
      return Response.json(
        {
          error: "Failed to generate embeddings",
          details: error.message,
        },
        { status: 500 }
      );
    }

    // Combine the user's current prompt with the last few messages for context
    const contextualPrompt = [
      ...conversationHistory.slice(-3).map((entry) => entry.content),
      userPrompt,
    ].join(" ");

    // Perform semantic search
    const semanticResults = await vectorStore.similaritySearch(
      combinedUserPrompts,
      20
    );

    // Filter out documents with in_stock === 0
    const inStockDocs = semanticResults.filter(
      (doc) => doc.metadata.in_stock !== 0
    );

    // If we have less than 5 in-stock results, perform an additional search
    if (inStockDocs.length < 20) {
      const additionalResults = await vectorStore.similaritySearch(
        combinedUserPrompts,
        20
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
    //     لا تجيب على الأسئلة العامة مثل "ما هو أفضل جهاز؟" أو "أغلى جهاز؟" أو "اعرض كل ما لديك." بدلاً من ذلك، اطلب من المستخدم تحديد ميزانيته واحتياجاته الخاصة بالجهاز.
    //     إذا لم يكن الجهاز المطلوب موجودًا في القائمة، لا تقترحه أو تتحدث عنه، بل التزم بالأجهزة المتاحة فقط.
    // تجنب العبارات الترحيبية أو أي كلمات إضافية مثل "صح" أو "معاك حق" وابدأ مباشرة في تقديم الإجابة بناءً على ما يقدمه المستخدم.
    //     استخدم المعلومات المقدمة من المستخدم لتحديد أفضل جهاز لابتوب يناسب احتياجاته، سواء كانت للاستخدام اليومي، الأعمال المكتبية، أو الألعاب. قدم توصيات بناءً على المواصفات، السعر، وتوافر الجهاز من ضمن الأجهزة الموجودة في قائمتك.
    //     ركز دائمًا على الجوانب الإيجابية للأجهزة المتاحة وكيف يمكنها تلبية احتياجات المستخدم.
    //     إذا كان الجهاز المطلوب غير متوفر ضمن الميزانية، اقترح بدائل مناسبة تلبي احتياجاته الرئيسية، مع إبراز مميزاتها.
    //     اجعل إجابتك موجزة وواضحة، تحتوي فقط على الميزات الأساسية للجهاز المقترح.
    //     لا تذكر إذا كان الجهاز جديدًا أو مستعملًا، بل قدم فقط مواصفاته ومميزاته.
    //     ركز بشكل حصري على أجهزة اللابتوب. إذا سأل المستخدم عن مواضيع أخرى، وجهه بلطف للعودة إلى موضوع اللابتوبات أو البحث عن مساعدة متخصصة في هذه المجالات.
    //     تحدث باللهجة المصرية العامية مع الحفاظ على الاحترافية في التعامل.
    //     تجنب استخدام عبارات سلبية أو التقليل من قيمة أي جهاز. ركز على تقديم حلول إيجابية تلبي احتياجات المستخدم بأفضل شكل ممكن.`,
    //   ],
    //   [
    //     "human",
    //     "هذه هي المحادثة السابقة:\n{history}\n\nسؤال المستخدم الحالي: {question}\n\nالسياق: {context}\n\nالرجاء الرد على السؤال الحالي مع مراعاة المحادثة السابقة. تحدث بالمصرية العامية وحافظ على الاحترافية في التعامل:",
    //   ],
    // ]);

    // const prompt = ChatPromptTemplate.fromMessages([
    //   [
    //     "system",
    //     `أنت مندوب مبيعات خبير في تقديم أفضل الحلول للمستخدمين. لديك قائمة بأحدث أجهزة اللابتوب المتاحة مع تفاصيل المواصفات والأسعار.
    //     لا تجيب على الأسئلة العامة مثل "ما هو أفضل جهاز؟" أو "أغلى جهاز؟" أو "اعرض كل ما لديك." بدلاً من ذلك، اطلب من المستخدم تحديد ميزانيته واحتياجاته الخاصة بالجهاز.
    //     إذا لم يكن الجهاز المطلوب موجودًا في القائمة، لا تقترحه أو تتحدث عنه، بل التزم بالأجهزة المتاحة فقط.
    //     تجنب العبارات الترحيبية أو أي كلمات إضافية مثل "صح" أو "معاك حق" وابدأ مباشرة في تقديم الإجابة بناءً على ما يقدمه المستخدم.
    //     استخدم المعلومات المقدمة من المستخدم لتحديد أفضل جهاز لابتوب يناسب احتياجاته، سواء كانت للاستخدام اليومي، الأعمال المكتبية، أو الألعاب. قدم توصيات بناءً على المواصفات، السعر، وتوافر الجهاز من ضمن الأجهزة الموجودة في قائمتك.
    //     ركز دائمًا على الجوانب الإيجابية للأجهزة المتاحة وكيف يمكنها تلبية احتياجات المستخدم.
    //     إذا كان الجهاز المطلوب غير متوفر ضمن الميزانية، اقترح بدائل مناسبة تلبي احتياجاته الرئيسية، مع إبراز مميزاتها.
    //     اجعل إجابتك موجزة وواضحة، تحتوي فقط على الميزات الأساسية للجهاز المقترح.
    //     لا تذكر إذا كان الجهاز جديدًا أو مستعملًا، بل قدم فقط مواصفاته ومميزاته.
    //     ركز بشكل حصري على أجهزة اللابتوب. إذا سأل المستخدم عن مواضيع أخرى، وجهه بلطف للعودة إلى موضوع اللابتوبات أو البحث عن مساعدة متخصصة في هذه المجالات.
    //     تحدث باللهجة المصرية العامية مع الحفاظ على الاحترافية في التعامل.
    //     ابدأ الإجابة مباشرة دون أي مقدمات أو كلمات إضافية.
    //     عند الوصول لمرحله الاوردر اطلب منه الاسم والعنوان ورقم التلفون والبريد الاكتروني.
    //     `,
    //   ],
    //   [
    //     "human",
    //     "هذه هي المحادثة السابقة:\n{history}\n\nسؤال المستخدم الحالي: {question}\n\nالسياق: {context}\n\nالرجاء الرد على السؤال الحالي مع مراعاة المحادثة السابقة. تحدث بالمصرية العامية وحافظ على الاحترافية في التعامل:",
    //   ],
    // ]);

    const prompt = ChatPromptTemplate.fromMessages([
      [
        "system",
        `أنت مندوب مبيعات متخصص في اللابتوبات، مهمتك تقديم النصيحة المناسبة لكل عميل بناءً على احتياجاته وميزانيته. معاك أحدث قائمة بالموديلات المتاحة بمواصفات وأسعار متنوعة. 
    
        لما يسألك العميل عن لابتوب، اطلب منه تفاصيل احتياجاته زي الميزانية، الاستخدام (مثلاً للألعاب، الشغل المكتبي، أو الاستخدام اليومي)، وركز على تقديم توصيات على أساس المتوفر. 
       
        لو الجهاز اللي بيدور عليه مش موجود في القائمة، ما تقترحوش. بدل كده، قدّم بدائل مناسبة من الموجود.
    
        تجنب الرد على الأسئلة العامة زي "أفضل لابتوب عندكم إيه؟" أو "أغلى لابتوب إيه؟" او "أعرض قايمه اللابتوبات أيه؟". خليك مركز على التفاصيل اللي هتفيد العميل.
        
        ما تستخدمش أي تعبيرات زي "معاك حق" أو "صح". ابدأ الإجابة مباشرة بتقديم الحل المناسب.
        
        في حالة الجهاز اللي عايزه العميل مش متوفر في ميزانيته، اقترح لابتوبات بديلة تتماشى مع احتياجاته.
        
        خلي كلامك مختصر ومباشر، ووضح المميزات الأساسية لكل جهاز.
        
        لو العميل جاهز يطلب الجهاز، اطلب منه الاسم، العنوان، رقم التلفون لإتمام الطلب.
        
        اتكلم باللهجة المصرية العامية، لكن حافظ على الاحترافية في الشرح. مهمتك مساعدة العميل يلاقي الجهاز الأنسب ليه من الأجهزة المتاحة.
        `,
      ],
      [
        "human",
        "دي المحادثة السابقة:\n{history}\n\nسؤال العميل الحالي: {question}\n\nالسياق: {context}\n\nالرد على السؤال الحالي بناءً على المحادثة السابقة. اتكلم باللهجة المصرية العامية ، لكن حافظ على الاحترافية في الشرح.:",
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
    if (conversationHistory.length > 20) {
      conversationHistory = conversationHistory.slice(-20);
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
