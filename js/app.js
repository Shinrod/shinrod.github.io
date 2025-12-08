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
    document.getElementById("hint").textContent = "A new word has been chosen. Start guessing!";
    console.log("Target word (debug):", targetWord);
}

// Update the displayed guess list
function updateGuessList() {
    const ul = document.getElementById("guessList");
    ul.innerHTML = "";

    // Sort guesses by distance ascending
    guesses.sort((a,b) => a.distance - b.distance);

    for (const g of guesses) {
        const li = document.createElement("li");
        li.textContent = `${g.word} → Distance: ${g.distance.toFixed(4)} (Similarity: ${(1-g.distance).toFixed(4)})`;
        ul.appendChild(li);
    }
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
