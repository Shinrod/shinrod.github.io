import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0";

let embedder;
let targetWord = null;
let targetEmbedding = null;
let guesses = []; // { word, distance, author }

const recentTable = document.querySelector("#recentGuessTable tbody");
const allTable = document.querySelector("#guessTable tbody");
const peerCountEl = document.getElementById("peer-count");
const hintEl = document.getElementById("hint");

let myName = "Anonymous";

// --- WebRTC state ---
let socket;
let peerId = null;
let peers = {};
let channels = {};
let peerNames = {};
const room = "global";

// --- HTML elements ---
const usernameInput = document.getElementById("username");
usernameInput.oninput = (e) => {
    myName = e.target.value.trim() || "Anonymous";
    for (const id in channels) {
        channels[id].send(JSON.stringify({ type: "set-username", name: myName }));
    }
};

// --- Utility functions ---
function log(msg) {
    const li = document.createElement("li");
    li.textContent = msg;
    document.getElementById("log").appendChild(li);
}

function updatePeerCount() {
    peerCountEl.textContent = Object.keys(peers).length;
}

function cosineSimilarity(a, b) {
    const dot = a.reduce((s, x, i) => s + x * b[i], 0);
    const magA = Math.sqrt(a.reduce((s, x) => s + x*x, 0));
    const magB = Math.sqrt(b.reduce((s, x) => s + x*x, 0));
    return dot / (magA * magB);
}

function similarityScale(sim) {
    const a = 20; 
    const center = 0.2;
    return 1 / (1 + Math.exp(-a * (sim - center)));
}

function computeProgress(simPercent) {
    if (simPercent < 25) return 0;
    const normalized = (simPercent - 25) / (100 - 25);
    const gamma = 0.6;
    return Math.pow(normalized, gamma) * 100;
}

// --- Table rendering ---
function renderTable(guessesList, tableBody) {
    tableBody.innerHTML = "";
    for (const g of guessesList) {
        const sim = 1 - g.distance;
        const logSim = similarityScale(sim);
        const similarityPercent = (logSim * 100).toFixed(2);

        const row = document.createElement("tr");

        const wordCell = document.createElement("td");
        wordCell.textContent = g.word.padStart(20, " ");
        wordCell.style.textAlign = "right";
        wordCell.style.whiteSpace = "pre";
        wordCell.style.fontFamily = "monospace";

        const simCell = document.createElement("td");
        simCell.textContent = similarityPercent + "%";
        simCell.style.textAlign = "right";
        simCell.style.whiteSpace = "pre";
        simCell.style.fontFamily = "monospace";

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

function updateGuessList() {
    // Last 3 guesses (recent)
    const recent = guesses.filter(g => g.author === myName || (g.author !== myName && 1-g.distance > 0.25)).slice(-3).reverse();
    renderTable(recent, recentTable);

    // All guesses
    const sorted = [...guesses].sort((a,b)=>a.distance-b.distance);
    renderTable(sorted, allTable);
}

// --- Word embedding ---
async function embedWord(word) {
    const output = await embedder(word);
    const tokens = output.tolist()[0];
    const vector = tokens.reduce((acc, t) => acc.map((x,i)=>x+t[i]));
    return vector.map(x => x/tokens.length);
}

// --- Handle local guess ---
async function checkGuess() {
    const guess = document.getElementById("guess").value.trim();
    if (!guess || !targetWord) return alert("Please enter a word!");
    const guessEmbedding = await embedWord(guess);
    const similarity = cosineSimilarity(guessEmbedding, targetEmbedding);
    const distance = 1 - similarity;

    // Add to local
    const guessObj = { word: guess, distance, author: myName };
    guesses.push(guessObj);
    updateGuessList();

    // Broadcast to peers
    broadcastMessage({ type: "guess", ...guessObj });
    document.getElementById("guess").value = "";
}

// --- Pick new word (first player only) ---
async function pickNewWord() {
    const frenchWords = ["chat","chien","maison","voiture","pomme","fleur","livre","soleil","montagne","école","bonbon","ordinateur","amour","détester","rapide"];
    targetWord = frenchWords[Math.floor(Math.random()*frenchWords.length)];
    targetEmbedding = await embedWord(targetWord);
    guesses = [];
    updateGuessList();
    hintEl.textContent = "Et c'est parti !";
    log(`You picked the target word: ${targetWord} (debug)`);

    // Broadcast target word
    broadcastMessage({ type: "target-word", word: targetWord, embedding: targetEmbedding });
}

// --- WebRTC setup ---
function connect() {
    socket = new WebSocket(`wss://test-web-server-801x.onrender.com/ws/${room}`);
    socket.onmessage = async (event) => {
        const msg = JSON.parse(event.data);
        switch(msg.type){
            case "welcome": peerId=msg.peer_id; log(`Joined as ${myName}`); break;
            case "peer-joined": createOfferTo(msg.peer_id); break;
            case "peer-left": 
                log(`${peerNames[msg.peer_id]||msg.peer_id} left`);
                if(peers[msg.peer_id]) peers[msg.peer_id].close();
                delete peers[msg.peer_id]; delete channels[msg.peer_id]; delete peerNames[msg.peer_id];
                updatePeerCount();
                break;
            case "offer": await receiveOffer(msg.from, msg.sdp); break;
            case "answer": if(peers[msg.from]) await peers[msg.from].setRemoteDescription(msg.sdp); break;
            case "ice": if(peers[msg.from]) await peers[msg.from].addIceCandidate(msg.candidate); break;
        }
        updatePeerCount();
    };
}

// --- Peer connection ---
function createPeerConnection(targetId) {
    const pc = new RTCPeerConnection({ iceServers:[{urls:"stun:stun.l.google.com:19302"}] });
    pc.onicecandidate = e => { if(e.candidate) socket.send(JSON.stringify({ type:"ice", target:targetId, candidate:e.candidate })); };
    pc.ondatachannel = e => setupDataChannel(targetId, e.channel);
    peers[targetId] = pc;
    updatePeerCount();
    return pc;
}

function setupDataChannel(id, channel) {
    channels[id] = channel;
    channel.onopen = () => channel.send(JSON.stringify({ type:"set-username", name:myName }));
    channel.onmessage = msg => handleDataMessage(id, msg.data);
}

function handleDataMessage(peerId, data){
    try{
        const parsed = JSON.parse(data);
        switch(parsed.type){
            case "set-username": peerNames[peerId] = parsed.name; return;
            case "target-word": targetWord=parsed.word; targetEmbedding=parsed.embedding; hintEl.textContent="Et c'est parti !"; return;
            case "guess": guesses.push(parsed); updateGuessList(); return;
        }
    } catch{}
}

// --- Offer / Answer ---
async function createOfferTo(targetId){
    const pc = createPeerConnection(targetId);
    const channel = pc.createDataChannel("cemantix-" + targetId);
    setupDataChannel(targetId, channel);
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    socket.send(JSON.stringify({ type:"offer", target:targetId, sdp:pc.localDescription }));
}

async function receiveOffer(fromId, offer){
    const pc = createPeerConnection(fromId);
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
    socket.send(JSON.stringify({ type:"answer", target:fromId, sdp:pc.localDescription }));
}

// --- Broadcast helper ---
function broadcastMessage(obj){
    for(const id in channels) channels[id].send(JSON.stringify(obj));
}

// --- Load model and init ---
async function loadModel(){
    hintEl.textContent="Loading model...";
    embedder = await pipeline("feature-extraction","Xenova/sentence-camembert-large");
    hintEl.textContent="Model loaded!";
}

// connect immediately
connect();

// then load the model asynchronously
loadModel();


// --- Event listeners ---
document.getElementById("compute").addEventListener("click", checkGuess);
document.getElementById("newWord").addEventListener("click", pickNewWord);
document.getElementById("guess").addEventListener("keydown", e=>{ if(e.key==="Enter"){ checkGuess(); e.preventDefault(); }});
