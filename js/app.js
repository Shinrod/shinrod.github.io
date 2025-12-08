import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0";

let embedder;

async function loadModel() {
    document.getElementById("result").textContent = "Loading CamemBERT...";
    embedder = await pipeline("feature-extraction", "Xenova/sentence-camembert-large");
    document.getElementById("result").textContent = "Model loaded!";
}

async function embedWord(word) {
    console.log("Embedding:", word);

    const output = await embedder(word);

    // output is a Tensor, convert it to a nested JS array
    const arr = output.tolist()[0];  
    // arr is now: [ [token_embed], [token_embed], ... ]

    // Average over tokens
    const vector = arr.reduce((acc, val) => acc.map((x, i) => x + val[i]));
    return vector.map((x) => x / arr.length);
}

function cosineSimilarity(a, b) {
    const dot = a.reduce((s, x, i) => s + x * b[i], 0);
    const magA = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
    const magB = Math.sqrt(b.reduce((s, x) => s + x * x, 0));
    return dot / (magA * magB);
}

async function computeDistance() {
    const w1 = document.getElementById("word1").value;
    const w2 = document.getElementById("word2").value;

    if (!w1 || !w2) return alert("Please enter both words!");

    const e1 = await embedWord(w1);
    const e2 = await embedWord(w2);

    const similarity = cosineSimilarity(e1, e2);
    const distance = 1 - similarity;

    document.getElementById("result").textContent =
        `Distance: ${distance.toFixed(4)} (Similarity: ${similarity.toFixed(4)})`;
}

document.getElementById("compute").onclick = computeDistance;

loadModel();
