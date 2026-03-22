# Next.js Agentic Travel Planner ✈️

A modern, Agentic Retrieval-Augmented Generation (RAG) travel planning application built with Next.js and the Vercel AI SDK. It utilizes generative UI (GenUI) to create interactive travel itineraries, fetch real-time flight data, and construct cost estimations.

## Features

- **Agentic Conversational State**: Dynamically extracts user preferences (Origin, Destination, Duration, Style) through slot-filling without rigid forms.
- **Generative UI (GenUI)**: Instead of raw text, the AI streams interactive React components (Option Cards, Flight Cards, Transport Recommenders) directly into the chat interface.
- **Real-Time Data (RAG)**: Integrates Tavily Search API for up-to-date attraction hours and ticket pricing.
- **Flight Prices**: Connects to the Google Flights API via SerpApi for accurate, real-world flight recommendations.
- **Smart Context & Localization**: Implicitly handles currency conversions, non-EEA tourist pricing (for Malaysian/international users) at EU attractions (e.g., the Louvre), and distance-based transport fallbacks.
- **Local LLM Support**: Designed to run seamlessly with local models via Ollama (e.g., Qwen 3.5).

## Tech Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router, React 18)
- **AI SDK**: [Vercel AI SDK](https://sdk.vercel.ai/) (`ai/react`)
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
   ```
3. Start your local Ollama instance (ensure your target model is pulled).
4. Run the development server:
   ```bash
   npm run dev
   ```
5. Open [http://localhost:3000](http://localhost:3000)

## License
MIT
