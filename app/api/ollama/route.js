import { Ollama } from "@langchain/ollama";

export async function GET(req) {
    try {
        const ollama = new Ollama({
            model: "codeqwen",
            baseUrl: "http://localhost:11434",
        });

        const response = await ollama.invoke("Hello, world!");

        return Response.json(response);
    } catch (error) {
        console.log(error);
        return Response.json({ error: error.message }, { status: 500 });
    }
}
