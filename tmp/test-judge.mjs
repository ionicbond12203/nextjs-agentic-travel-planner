import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import dotenv from "dotenv";

dotenv.config();

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
});

async function main() {
  try {
    const { text } = await generateText({
      model: google("gemini-1.5-flash") as any,
      prompt: "Respond with 'SUCCESS' if you can read this.",
    });
    console.log("Judge Response:", text);
  } catch (e) {
    console.error("Judge Error:", e.message);
  }
}

main();
