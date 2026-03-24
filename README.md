# Next.js Agentic Travel Planner ✈️

A modern, Agentic Retrieval-Augmented Generation (RAG) travel planning application built with Next.js and the Vercel AI SDK. It utilizes generative UI (GenUI) to create interactive travel itineraries, fetch real-time flight data, and construct cost estimations.

## Features

- **Agentic RAG (Self-Correction)**: Implements **Corrective RAG (CRAG)** patterns. The agent evaluates search results in real-time; if relevance is low, it automatically rewrites the query and re-retrieves data.
- **Self-Reflection (Self-RAG)**: Features a built-in "Judge" that audits generated answers for groundedness and factuality, specifically blocking common travel hallucinations (e.g., visa policies).
- **Evaluation Framework (LLM-as-a-Judge)**: A robust batch testing suite using the **RAG Triad** (Context Relevance, Groundedness, Answer Relevance) plus a specialized **Factuality** metric.
- **Generative UI (GenUI)**: Instead of raw text, the AI streams interactive React components (Option Cards, Flight Cards, Transport Recommenders, **Interactive Maps**, and **Hotel Carousels**) directly into the chat interface.
- **Real-Time Data (RAG)**: Integrates Tavily Search API with 2026 freshness filters for up-to-date attraction info.
- **Interactive Maps & Geocoding**: Utilizes Google Maps Platform for dynamic location tagging and precision geocoding to ensure all coordinates are accurate.
- **Flight Prices**: Connects to the Google Flights API via SerpApi for accurate, real-world flight recommendations.
- **Local LLM Support**: Designed for high-performance use with local models via Ollama.

## Evaluation

The project includes a comprehensive evaluation suite to prevent regressions and improve agent accuracy.

### Running Evaluations

Ensure your dev server is running, then execute:

```bash
npm run eval
```

This runs a batch of test cases (defined in `src/lib/eval-test-cases.ts`) through the judge and outputs a detailed report on context relevance, groundedness, and factuality.

## Tech Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router, React 19)
- **AI SDK**: [Vercel AI SDK](https://sdk.vercel.ai/) (`ai/react`)
- **Maps**: [Google Maps Platform](https://mapsplatform.google.com/)
- **LLM Interface**: [Ollama](https://ollama.com/) (Local deployment)
- **External APIs**:
  - [Tavily](https://tavily.com/) (Real-time web search)
  - [SerpApi](https://serpapi.com/) (Google Flights integration)

## Getting Started

1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env.local` file and add your API keys:
   ```env
   TAVILY_API_KEY=your_tavily_key
   SERPAPI_API_KEY=your_serpapi_key
   NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_maps_key
   ```
3. Start your local Ollama instance (ensure your target model is pulled).
4. Run the development server:
   ```bash
   npm run dev
   ```
5. Open [http://localhost:3000](http://localhost:3000)

## License
MIT
