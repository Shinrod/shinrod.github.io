import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0";

let embedder;
let targetWord;
let targetEmbedding;
let guesses = []; // array of {word, distance}

// List of French words to pick as target
const frenchWords = [
  "chat","chien","maison","voiture","pomme",
  "fleur","livre","soleil","montagne","école",
  "bonbon","ordinateur","amour","détester","rapide"
];

// Embed a word using the model
async function embedWord(word) {
    const output = await embedder(word);
    const tokens = output.tolist()[0]; // tensor -> array
    const vector = tokens.reduce((acc, t) => acc.map((x, i) => x + t[i]));
    return vector.map(x => x / tokens.length);
}

// Cosine similarity
function cosineSimilarity(a, b) {
    const dot = a.reduce((s, x, i) => s + x * b[i], 0);
    const magA = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
    const magB = Math.sqrt(b.reduce((s, x) => s + x * x, 0));
    return dot / (magA * magB);
}

// Pick a new target word
async function pickNewWord() {
    targetWord = frenchWords[Math.floor(Math.random() * frenchWords.length)];
    targetEmbedding = await embedWord(targetWord);
    guesses = [];
    updateGuessList();
    document.getElementById("hint").textContent = "Et c'est parti !";
    console.log("Target word (debug):", targetWord);
}

// Update the displayed guess lists
function updateGuessList() {
    function computeProgress(simPercent) {
        if (simPercent < 25) return 0;
        const normalized = (simPercent - 25) / (100 - 25);
        const gamma = 0.6; // power-law exponent
        return Math.pow(normalized, gamma) * 100;
    }

    function renderTable(guessesList, tableSelector) {
        const tableBody = document.querySelector(tableSelector);
        tableBody.innerHTML = "";

        for (const g of guessesList) {
            const sim = 1 - g.distance;
            const logSim = similarityScale(sim);
            const similarityPercent = (logSim * 100).toFixed(2);

            const row = document.createElement("tr");

            // Word cell
            const wordCell = document.createElement("td");
            wordCell.textContent = g.word.padStart(20, " ");
            wordCell.style.textAlign = "right";
            wordCell.style.whiteSpace = "pre";
            wordCell.style.fontFamily = "monospace";

            // Similarity cell
            const simCell = document.createElement("td");
            simCell.textContent = similarityPercent + "%";
                simCell.style.textAlign = "right";
            simCell.style.whiteSpace = "pre";
            simCell.style.fontFamily = "monospace";

            // Progress bar cell
            const progressCell = document.createElement("td");
            if (Number(similarityPercent) > 25) {
                const container = document.createElement("div");
                container.className = "progress-container";

                const bar = document.createElement("div");
                bar.className = "progress-bar";
                bar.style.width = computeProgress(Number(similarityPercent)) + "%";

                container.appendChild(bar);
                progressCell.appendChild(container);
            }

            row.appendChild(wordCell);
            row.appendChild(simCell);
            row.appendChild(progressCell);
            tableBody.appendChild(row);
        }
    }

    // Last 3 guesses (newest first)
    const recent = guesses.slice(-3).reverse();
    renderTable(recent, "#recentGuessTable tbody");

    // Full sorted list
    const sortedGuesses = [...guesses].sort((a, b) => a.distance - b.distance);
    renderTable(sortedGuesses, "#guessTable tbody");
}

function similarityScale(sim) {
    const a = 20; // controls steepness
    const center = 0.2; // controls center
    return 1 / (1 + Math.exp(-a * (sim - center)));
}

// Check a guess
async function checkGuess() {
    const guess = document.getElementById("guess").value.trim();
    if (!guess) return alert("Please enter a word!");

    const guessEmbedding = await embedWord(guess);
    const similarity = cosineSimilarity(guessEmbedding, targetEmbedding);
    const distance = 1 - similarity;

    // Add to guesses
    guesses.push({ word: guess, distance });
    updateGuessList();
    document.getElementById("guess").value = ""; // clear input
}

// Load the model and initialize
async function loadModel() {
    document.getElementById("hint").textContent = "Loading model...";
    embedder = await pipeline("feature-extraction", "Xenova/sentence-camembert-large");
    document.getElementById("hint").textContent = "Model loaded!";
    await pickNewWord();
}

// Event listeners
document.getElementById("compute").addEventListener("click", checkGuess);
document.getElementById("newWord").addEventListener("click", pickNewWord);
document.getElementById("guess").addEventListener("keydown", function(e) {
    if (e.key === "Enter") {
        checkGuess();
        e.preventDefault();
    }
});
loadModel();
