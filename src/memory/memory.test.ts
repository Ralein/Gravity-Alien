import { memoryManager } from "./memory.js";
import { embed } from "./embeddings.js";
import { upsertMemory, queryMemories, deleteUserMemories } from "./vectorStore.js";
import { saveCoreMemory, getCoreMemories } from "./localStore.js";

/**
 * Alien Memory System — Foundation Test Script
 * Run with: npx tsx src/memory/memory.test.ts
 */

async function runTests() {
    console.log("🧪 Starting Memory System Tests...\n");

    const userId = 999999999; // Test user ID

    try {
        // 1. Test Embeddings
        console.log("1️⃣ Testing Embeddings...");
        const vector = await embed("Hello, world!");
        console.log(`   ✅ Generated vector of length ${vector.length}`);

        // 2. Test Supabase Core Memory
        console.log("\n2️⃣ Testing Supabase Core Memory...");
        const factId = await saveCoreMemory(userId, "Testing memory system", "context", 10);
        if (factId) {
            console.log(`   ✅ Saved core memory: ${factId}`);
            const memories = await getCoreMemories(userId);
            const found = memories.find(m => m.fact === "Testing memory system");
            if (found) console.log("   ✅ Successfully retrieved core memory");
            else throw new Error("Could not find saved memory");
        } else {
            console.warn("   ⚠️ Supabase test skipped (check if credentials are set)");
        }

        // 3. Test Pinecone Vector Store
        console.log("\n3️⃣ Testing Pinecone Vector Store...");
        try {
            const vectorId = `test_${Date.now()}`;
            await upsertMemory(vectorId, "This is a test vector memory", {
                userId,
                text: "This is a test vector memory",
                type: "exchange",
                timestamp: new Date().toISOString()
            });
            console.log("   ✅ Upserted to Pinecone");

            const searchResults = await queryMemories("test vector", userId, 1);
            if (searchResults.length > 0) {
                console.log(`   ✅ Query found: "${searchResults[0].text}" (score: ${searchResults[0].score})`);
            } else {
                console.warn("   ⚠️ No results found (might be indexing delay)");
            }
        } catch (err: any) {
            console.warn(`   ⚠️ Pinecone test failed: ${err.message} (check if API key is set)`);
        }

        // 4. Test Memory Manager Flow
        console.log("\n4️⃣ Testing Memory Manager Flow...");
        const history = memoryManager.getSTM(userId);
        console.log(`   Initial STM size: ${history.length}`);

        await memoryManager.addExchange(userId, "My favorite color is blue", "I'll remember that!");
        console.log(`   ✅ Added exchange to MemoryManager`);

        console.log("\n🔍 Fetching relevant context for 'What is my favorite color?'");
        const ctx = await memoryManager.getRelevantContext(userId, "What is my favorite color?");
        const formatted = memoryManager.formatContextBlock(ctx);
        console.log(formatted);

        console.log("\n✅ All tests completed! (Check console for warnings about missing API keys)");
    } catch (err: any) {
        console.error(`\n💥 Tests failed: ${err.message}`);
        process.exit(1);
    }
}

runTests();
