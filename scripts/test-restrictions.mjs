async function testRestriction() {
  console.log("Testing Malaysia -> Israel restriction...");
  
  const payload = {
    messages: [
      { role: 'user', content: '我计划从吉隆坡出发去以色列玩4天。' }
    ]
  };

  try {
    const response = await fetch('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error("Request failed:", response.statusText);
      return;
    }

    // Read stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let result = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      result += decoder.decode(value, { stream: true });
    }

    console.log("Response Received:");
    console.log(result);

    // Vercel AI SDK Data Stream format: 0:"text"
    if (result.includes("护照") || result.includes("内政部") || result.includes("无效")) {
      console.log("✅ SUCCESS: Restriction warning triggered.");
    } else {
      console.log("❌ FAILURE: No restriction warning found.");
    }
  } catch (error) {
    console.error("Test error:", error);
  }
}

testRestriction();
