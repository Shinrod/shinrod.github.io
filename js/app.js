// js/app.js
// Full integrated Cémantix multiplayer script with WebRTC mesh, username persistence,
// shared target-word sync, and synchronized guesses (All + Recent).
//
// Assumptions:
// - HTML contains elements with IDs used below (username, guess, compute, newWord, etc.)
// - Signaling server behavior similar to prior example (welcome, peer-joined, peer-left, offer, answer, ice).
// - Peers trust sender's distance value for guesses (no re-computation required).
//
// Important: secret target word is never sent to the visible chat log. Only console.log() used for local debug.

import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0";

///////////////////////
// Game state
///////////////////////
let embedder = null;
let targetWord = null;          // string
let targetEmbedding = null;     // numeric array (sent/received over network)
let guesses = [];               // array of { word, distance, author }

function hasTargetWord() {
    return targetWord !== null && targetEmbedding !== null;
}

///////////////////////
// UI elements
///////////////////////
const hintEl = document.getElementById("hint");
const usernameInput = document.getElementById("username");
const peerCountEl = document.getElementById("peer-count");
const recentTableSelector = "#recentGuessTable tbody";
const allTableSelector = "#guessTable tbody";

///////////////////////
// Username persistence & local value
///////////////////////
let myName = "Anonymous";

// load saved username before connecting so welcome shows correct name
const saved = localStorage.getItem("username");
if (saved && saved.trim() !== "") {
    myName = saved.trim();
    usernameInput.value = myName;
} else {
    myName = "Anonymous";
    usernameInput.value = "";
}

usernameInput.addEventListener("blur", (e) => {
    const newName = usernameInput.value.trim() || "Anonymous";

    if (newName !== myName) {
        const oldName = myName; // remember old username
        myName = newName;

        localStorage.setItem("username", myName);

        // Broadcast name update to peers (if channels exist)
        for (const id in channels) {
            const ch = channels[id];
            if (ch && ch.readyState === "open") {
                ch.send(JSON.stringify({
                    type: "set-username",
                    oldName: oldName,
                    newName: myName
                }));
            }
        }

        log(`Nouveau pseudo: ${myName}`)
        updatePeerList();
    }
});

///////////////////////
// Logging helper (local UI log only - not for secrets)
///////////////////////
function log(msg) {
    const li = document.createElement("li");
    li.textContent = msg;
    document.getElementById("log").appendChild(li);
}

///////////////////////
// Similarity helpers (same as your original transforms)
///////////////////////
function cosineSimilarity(a, b) {
    const dot = a.reduce((s, x, i) => s + x * b[i], 0);
    const magA = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
    const magB = Math.sqrt(b.reduce((s, x) => s + x * x, 0));
    return dot / (magA * magB);
}

function trimmedCosineSimilarity(a, b, topTrimRatio = 0.045, botTrimRatio = 0) {
    if (a.length !== b.length) {
        throw new Error("Embedding dimension mismatch");
    }

    const diffs = a.map((x, i) => Math.abs(x - b[i]));

    // Sort diffs while keeping original indices
    const sorted = diffs
        .map((value, index) => ({ value, index }))
        .sort((x, y) => x.value - y.value);

    const n = a.length;
    const trimTopN = Math.floor(n * topTrimRatio);
    const trimBotN = Math.floor(n * botTrimRatio);

    // Keep only the middle %
    const kept = sorted.slice(trimBotN, n - trimTopN);

    // Build trimmed vectors
    const aTrim = kept.map(obj => a[obj.index]);
    const bTrim = kept.map(obj => b[obj.index]);

    // Standard cosine similarity on trimmed vectors
    const dot = aTrim.reduce((s, x, i) => s + x * bTrim[i], 0);
    const magA = Math.sqrt(aTrim.reduce((s, x) => s + x * x, 0));
    const magB = Math.sqrt(bTrim.reduce((s, x) => s + x * x, 0));

    return dot / (magA * magB);
}

function similarityScale(sim) {
    const a = 30;
    const center = 0.3;
    return 1 / (1 + Math.exp(-a * (sim - center)));
}

function computeProgress(simPercent) {
    if (simPercent < 25) return 0;
    const normalized = (simPercent - 25) / (100 - 25);
    const gamma = 0.6;
    return Math.pow(normalized, gamma) * 100;
}

// Get the emoji to display depending on the percentage
function getEmoji(percent, word) {
    if (percent < 5) return "🥶";
    if (percent < 10) return "🧊";
    if (percent < 25) return "💧";
    if (percent < 40) return "🌱";
    if (percent < 60) return "🌲";
    if (percent < 80) return "🔥";
    if (word != targetWord) return "🥵";
    return "🎉";
}

function isCorrectWord(input) {
    if (!targetWord) return false;
    const w = input.trim().toLowerCase();
    return w === targetWord.toLowerCase();
}

///////////////////////
// Table rendering & update logic
///////////////////////
function renderTable(guessesList, tableSelector) {
    const tableBody = document.querySelector(tableSelector);
    tableBody.innerHTML = "";

    for (const g of guessesList) {
        const sim = 1 - g.distance;
        const logSim = similarityScale(sim);
        const similarityPercent = logSim * 100;

        const row = document.createElement("tr");

        const wordCell = document.createElement("td");
        wordCell.textContent = g.word.padStart(20, " ");
        wordCell.style.textAlign = "right";
        wordCell.style.whiteSpace = "pre";
        wordCell.style.fontFamily = "monospace";

        const simCell = document.createElement("td");
        simCell.textContent = similarityPercent.toFixed(2) + "%";
        simCell.style.textAlign = "right";
        simCell.style.whiteSpace = "pre";
        simCell.style.fontFamily = "monospace";

        // Prevent words that are not target to be displayed at '100%' similarity
        if (simCell.textContent == '100%' & !isCorrectWord(g.word)) {
            simCell.textContent = "99.99%";
        }

        const emojiCell = document.createElement("td");
        emojiCell.textContent = getEmoji(similarityPercent, g.word);
        emojiCell.style.textAlign = "right";
        emojiCell.style.whiteSpace = "pre";
        emojiCell.style.fontFamily = "monospace";

        const progressCell = document.createElement("td");
        if (similarityPercent > 25) {
            const container = document.createElement("div");
            container.className = "progress-container";

            const bar = document.createElement("div");
            bar.className = "progress-bar";
            bar.style.width = computeProgress(similarityPercent) + "%";

            container.appendChild(bar);
            progressCell.appendChild(container);
        }

        row.appendChild(wordCell);
        row.appendChild(simCell);
        row.appendChild(emojiCell);
        row.appendChild(progressCell);

        tableBody.appendChild(row);

        if (isCorrectWord(g.word)) revealWholeWord();
    }
}

function updateGuessList() {
    // --- RECENT GUESSES (last 3) ---
    const recent = guesses.filter(g => {
        if (g.author === myName) return true; // local guesses always
        const simPercent = similarityScale(1 - g.distance) * 100; // displayed similarity
        return simPercent >= 25; // remote guesses only if displayed similarity >= 25%
    });
    renderTable(recent.slice(-3).reverse(), recentTableSelector); // newest first

    // --- ALL GUESSES (sorted by distance) ---
    const sorted = [...guesses].sort((a, b) => a.distance - b.distance);
    renderTable(sorted, allTableSelector);
}


///////////////////////
// Embedding function (using loaded embedder)
// Note: embedder(word) -> tensor-like output with tolist() as before
///////////////////////
async function embedWord(word) {
    if (!embedder) throw new Error("Embedder not loaded");
    const output = await embedder(word);
    const tokens = output.tolist()[0]; // array of token vectors
    // average token vectors
    const vector = tokens.reduce((acc, t) => acc.map((x, i) => x + t[i]));
    return vector.map(x => x / tokens.length);
}


///////////////////////
// Hashing function
///////////////////////
const HASH_KEY = 12345; // arbitrary number for reversible XOR

function hashWord(word) {
    return Array.from(word).map(c => c.charCodeAt(0) ^ HASH_KEY)
                         .map(n => n.toString(16).padStart(2, "0"))
                         .join("");
}

function unhashWord(hash) {
    const chars = [];
    for (let i = 0; i < hash.length; i += 2) {
        const n = parseInt(hash.slice(i, i + 2), 16);
        chars.push(String.fromCharCode(n ^ HASH_KEY));
    }
    return chars.join("");
}

///////////////////////
// Pick new target word (host action)
// Broadcast target-word (word + embedding) to peers but do NOT log it to chat
///////////////////////
let frenchWords = [];

async function loadWords() {
    const res = await fetch("words.txt");
    const text = await res.text();

    // Split on newlines, trim, and remove empty lines
    frenchWords = text
        .split("\n")
        .map(w => w.trim())
        .filter(w => w.length > 0);

    console.log(`Loaded ${frenchWords.length} words.`);
}

await loadWords();

async function pickNewWord() {
    targetWord = frenchWords[Math.floor(Math.random() * frenchWords.length)];
    targetEmbedding = await embedWord(targetWord);
    guesses = []; // reset guesses locally
    updateGuessList();
    hintEl.textContent = "Et c'est parti !";

    // Reset revealed letters
    revealed = new Array(targetWord.length).fill(false);
    displayHiddenWord();

    // Broadcast to all peers with current guess list (empty at first)
    broadcastTargetWord();

    console.log("Picked new target word (host only):", hashWord(targetWord));
    log(`${myName} a généré un nouveau mot`);
}

///////////////////////
// Guess handling (local & broadcast)
// - Compute similarity locally for local guesses
// - Accept remote guess distances as-is (user trusts sender)
///////////////////////
async function checkGuess() {
    const input = document.getElementById("guess");
    const guess = input.value.trim();
    if (!guess) return;
    if (!hasTargetWord()) pickNewWord();

    // compute embedding & distance locally
    const guessEmbedding = await embedWord(guess);
    const similarity = trimmedCosineSimilarity(guessEmbedding, targetEmbedding);
    const distance = 1 - similarity;

    maybeRevealRandomLetter(guess, similarity);

    const guessObj = { word: guess, distance, author: myName };
    // Add locally
    guesses.push(guessObj);
    updateGuessList();

    // Broadcast guess to peers
    broadcastMessage({ type: "guess", guess: guessObj });

    input.value = "";
}

async function wordSimilarity(word1, word2) {
    const word1Embedding = await embedWord(word1);
    const word2Embedding = await embedWord(word2);
    const similarity = trimmedCosineSimilarity(word1Embedding, word2Embedding);

    const logSim = similarityScale(similarity);
    const similarityPercent = logSim * 100;
    return similarityPercent;
}


///////////////////////
// Word hint
///////////////////////
function normalizeWord(w) {
    return w
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

function isSameWord(a, b) {
    return normalizeWord(a) === normalizeWord(b);
}

function isValidGuess(word) {
    const w = normalizeWord(word);
    return /^[a-z]+$/.test(w); // only letters
}

let revealed = [];   // array of booleans matching each letter of targetWord
let hiddenWordEl = document.getElementById("hiddenWord");

function displayHiddenWord(override = null) {
    const container = document.getElementById("hiddenWord");

    if (override) {
        container.textContent = override;
        return;
    }

    // Default behavior: show blocks + revealed letters
    const display = targetWord
        .split("")
        .map((ch, i) => (revealed[i] ? ch : "⬛"))
        .join("");

    container.textContent = display;
}


function revealRandomLetter() {
    // Collect index of unrevealed letters
    const hiddenIndexes = revealed
        .map((r, i) => (!r ? i : null))
        .filter(i => i !== null);

    if (hiddenIndexes.length === 0) return; // nothing to reveal

    const idx = hiddenIndexes[Math.floor(Math.random() * hiddenIndexes.length)];
    revealed[idx] = true;

    displayHiddenWord();
}

// Reveal a random letter when guessing if the criterias are met
function maybeRevealRandomLetter(guess, similarity) {
    // Displayed similarity
    const logSim = similarityScale(similarity);
    const similarityPercent = logSim * 100;

    // Word do not only contain letters
    if (!isValidGuess(guess)) return;

    // Guess already in list
    if (guesses.some(g => isSameWord(g.word, guess))) return;

    if (similarityPercent >= 98) {
        revealRandomLetter();
    }
}

function revealWholeWord() {
    if (!targetWord) return;

    // Mark all letters as revealed
    revealed = revealed.map(() => true);

    // Add emoji decoration
    const decorated = `🎉 ${targetWord} 🎉`;

    // Update the visual display
    displayHiddenWord(decorated);
}


///////////////////////
// WebRTC / Signaling (mesh)
///////////////////////
let socket = null;
let peerId = null;
let peers = {};    // peerId -> RTCPeerConnection
let channels = {}; // peerId -> RTCDataChannel
let peerNames = {}; // peerId -> username
const room = "global";

// Connect immediately (so signaling request appears right away)
function connect() {
    socket = new WebSocket(`wss://test-web-server-801x.onrender.com/ws/${room}`);

    socket.onopen = () => {
        // nothing here specific, welcome will arrive from server
    };

    socket.onmessage = async (event) => {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
            case "welcome":
                peerId = msg.peer_id;
                log(`Partie rejointe en tant que: ${myName}`);
                // If signaling server provides peer count info and says we are first, auto-pick
                // (fallback: do nothing; host may be a human clicking New Word)
                if (typeof msg.peers_count !== "undefined") {
                    if (msg.peers_count === 0) {
                        // I'm first — pick a new word automatically
                        // Only auto-pick if model already loaded, otherwise pick once loaded
                        if (embedder) {
                            pickNewWord();
                        } else {
                            // pick once model loads (set a flag)
                            waitForModelPickOnLoad = true;
                        }
                    }
                }
                break;

            case "peer-joined":
                createOfferTo(msg.peer_id);
                break;

            case "peer-left":
                log(`${peerNames[msg.peer_id]} a quitté la partie`);

                if (peers[msg.peer_id]) peers[msg.peer_id].close();
                delete peers[msg.peer_id];
                delete channels[msg.peer_id];
                delete peerNames[msg.peer_id];
                updatePeerCount();
                updatePeerList();
                break;

            case "offer":
                await receiveOffer(msg.from, msg.sdp);
                break;

            case "answer":
                if (peers[msg.from]) await peers[msg.from].setRemoteDescription(msg.sdp);
                break;

            case "ice":
                if (peers[msg.from]) await peers[msg.from].addIceCandidate(msg.candidate);
                break;

            default:
                // ignore unknown signaling messages
                break;
        }

        updatePeerCount();
        updatePeerList();
    };

    socket.onerror = (e) => {
        console.error("WebSocket error", e);
    };

    socket.onclose = () => {
        console.warn("Signaling socket closed");
    };
}

function updatePeerCount() {
    peerCountEl.textContent = Object.keys(peers).length + 1;
}

function updatePeerList() {
    const listEl = document.getElementById("peer-list");
    listEl.innerHTML = "";

    const li = document.createElement("li");
    li.textContent = `${myName} (moi)`
    listEl.appendChild(li);

    // Loop through all connected peers
    for (const id in peerNames) {
        const li = document.createElement("li");
        li.textContent = peerNames[id] || id; // username or fallback to peer ID
        listEl.appendChild(li);
    }
}

function createPeerConnection(targetId) {
    const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            socket.send(JSON.stringify({
                type: "ice",
                target: targetId,
                candidate: e.candidate
            }));
        }
    };

    // When an incoming datachannel is created by remote peer
    pc.ondatachannel = (e) => {
        setupDataChannel(targetId, e.channel);
    };

    peers[targetId] = pc;
    updatePeerCount();
    updatePeerList();
    return pc;
}

function setupDataChannel(peerIdParam, channel) {
    channels[peerIdParam] = channel;

    channel.onopen = () => {
        channel.send(JSON.stringify({ type: "set-username", name: myName }));
        // Broadcast to all peers that this user joined
        sendPeerJoinedLogTo(peerIdParam, myName);
        sendTargetWordTo(peerIdParam);
    };

    channel.onmessage = (evt) => {
        handleDataMessage(peerIdParam, evt.data);
    };

    channel.onclose = () => {
        // channel closed
    };

    channel.onerror = (err) => {
        console.warn("DataChannel error", err);
    };
}

// Offerer side: create datachannel then offer
async function createOfferTo(targetId) {
    const pc = createPeerConnection(targetId);

    const channel = pc.createDataChannel("cemantix-" + targetId);
    setupDataChannel(targetId, channel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.send(JSON.stringify({
        type: "offer",
        target: targetId,
        sdp: pc.localDescription
    }));
}

// Answerer side: set remote, create answer
async function receiveOffer(fromId, offer) {
    const pc = createPeerConnection(fromId);
    await pc.setRemoteDescription(offer);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.send(JSON.stringify({
        type: "answer",
        target: fromId,
        sdp: pc.localDescription
    }));

    // Note: pc.ondatachannel above will handle the incoming data channel
}

///////////////////////
// Broadcast helper (send to all open channels)
///////////////////////
function broadcastMessage(obj) {
    const str = JSON.stringify(obj);
    for (const id in channels) {
        const ch = channels[id];
        if (ch && ch.readyState === "open") {
            ch.send(str);
        }
    }
}

///////////////////////
// Incoming DataChannel message handling (game-aware)
///////////////////////
function handleDataMessage(fromId, data) {
    // First try to parse JSON
    let parsed = null;
    try {
        parsed = JSON.parse(data);
    } catch (e) {
        // Not JSON → treat as public chat message
        log(`${peerNames[fromId] || fromId}: ${data}`);
        return;
    }

    // Recognized JSON -> handle known message types quietly (no chat leak)
    switch (parsed.type) {
        case "set-username":
            const oldName = parsed.oldName || peerNames[fromId] || fromId;
            const newName = parsed.newName;

            // Update our local map
            peerNames[fromId] = newName;

            // Log the change only if the name actually changed
            if (oldName !== newName & newName != undefined) {
                log(`${oldName} s'est renommé ${newName}`);
                updatePeerList();
            }
            return;

        case "target-word":
            // Accept the new target word and embedding
            targetWord = parsed.word;
            targetEmbedding = parsed.embedding;

            // Replace local guess list with the one from the sender
            if (Array.isArray(parsed.guesses)) {
                guesses = parsed.guesses;
            } else {
                guesses = [];
            }

            hintEl.textContent = "Et c'est parti !";
            updateGuessList();
            console.log("Received target word and guesses from peer:", hashWord(targetWord));
            log(`${parsed.user} a généré un nouveau mot`);
            return;

        case "guess":
            // parsed.guess expected shape: { word, distance, author }
            if (parsed.guess && typeof parsed.guess.word === "string" && typeof parsed.guess.distance === "number") {
                // Accept sender's distance as trusted
                guesses.push(parsed.guess);
                updateGuessList();
            } else {
                console.warn("Malformed guess message from", fromId, parsed);
            }
            return;
        
        case "peer-joined-log":
            peerNames[fromId] = parsed.user
            log(`${parsed.user} a rejoint la partie`);
            updatePeerList();
            return;

        default:
            // Unknown JSON-ish message → treat as chat (safe fallback)
            log(`${peerNames[fromId] || fromId}: ${data}`);
            return;
    }
}

///////////////////////
// Model loading & initialization
///////////////////////
let waitForModelPickOnLoad = false;

async function loadModel() {
    hintEl.textContent = "Loading model...";
    try {
        embedder = await pipeline("feature-extraction", "Xenova/sentence-camembert-large");
        hintEl.textContent = "Partie prête !";
        // If flagged to pick a word (we were first before model loaded), do it now
        if (waitForModelPickOnLoad) {
            waitForModelPickOnLoad = false;
            await pickNewWord();
        }
    } catch (e) {
        hintEl.textContent = "Echec du lancement de la partie";
        console.error("Model load error:", e);
    }
}

///////////////////////
// Wire UI buttons & start connection + model load
///////////////////////
document.getElementById("compute").addEventListener("click", checkGuess);
document.getElementById("newWord").addEventListener("click", pickNewWord);
document.getElementById("guess").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        checkGuess();
        e.preventDefault();
    }
});

// Sends the current target word and guess list to a specific peer
function sendTargetWordTo(peerId) {
    const ch = channels[peerId];
    if (!ch || ch.readyState !== "open") return;

    if (hasTargetWord()) {
        const msg = {
            type: "target-word",
            user: myName,
            word: targetWord,
            embedding: targetEmbedding,
            guesses: guesses // include all current guesses
        };
        ch.send(JSON.stringify(msg));
    }
}

// Broadcast the current target word and guess list to all connected peers
function broadcastTargetWord() {
    if (!hasTargetWord()) return;

    for (const peerId in channels) {
        sendTargetWordTo(peerId); // each channel handles its own open check and sends guesses
    }
}

// Send a "peer joined" log to a specific peer only
function sendPeerJoinedLogTo(peerId, username) {
    const ch = channels[peerId];
    if (!ch || ch.readyState !== "open") return;

    const msg = {
        type: "peer-joined-log",
        user: username
    };

    ch.send(JSON.stringify(msg));
}

// Start signaling immediately (so the WebSocket request appears in network tab)
connect();

// Start loading model (asynchronously)
loadModel();
