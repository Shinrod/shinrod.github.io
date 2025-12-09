let socket;
let peerId = null;
let myName = "Anonymous";
let peers = {};      // peerId -> RTCPeerConnection
let channels = {};   // peerId -> RTCDataChannel
let peerNames = {};  // peerId -> username
let room = "global";

const peerCountEl = document.getElementById("peer-count");

function log(msg) {
    let li = document.createElement("li");
    li.textContent = msg;
    document.getElementById("log").appendChild(li);
}

function updatePeerCount() {
    peerCountEl.textContent = Object.keys(peers).length;
}

// Get username input element
const usernameInput = document.getElementById("username");

// Set initial name if the input already has a value
myName = usernameInput.value.trim() || "Anonymous";

// Update myName dynamically as user types
usernameInput.oninput = (e) => {
    myName = e.target.value.trim() || "Anonymous";

    // Broadcast username to all connected peers
    for (const id in channels) {
        channels[id].send(JSON.stringify({ type: "set-username", name: myName }));
    }
};

// Connect to signaling server
function connect() {
    socket = new WebSocket(`wss://test-web-server-801x.onrender.com/ws/${room}`);

    socket.onmessage = async (event) => {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
            case "welcome":
                peerId = msg.peer_id;
                log(`You joined as: ${myName}`);
                break;

            case "peer-joined":
                createOfferTo(msg.peer_id);
                break;

            case "peer-left":
                log(`${peerNames[msg.peer_id] || msg.peer_id} left`);
                if (peers[msg.peer_id]) peers[msg.peer_id].close();
                delete peers[msg.peer_id];
                delete channels[msg.peer_id];
                delete peerNames[msg.peer_id];
                updatePeerCount();
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
        }
        updatePeerCount();
    };
}

connect();

// Create a new RTCPeerConnection for a given peer
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

    pc.ondatachannel = (e) => {
        const channel = e.channel;
        channels[targetId] = channel;

        channel.onopen = () => {
            // Send my username immediately
            channel.send(JSON.stringify({ type: "set-username", name: myName }));
        };

        channel.onmessage = (msg) => handleDataMessage(targetId, msg.data);
    };

    peers[targetId] = pc;
    updatePeerCount();
    return pc;
}

// Handle data channel messages
function handleDataMessage(targetId, data) {
    try {
        const parsed = JSON.parse(data);

        if (parsed.type === "set-username") {
            // Update peer's username silently
            peerNames[targetId] = parsed.name;
            return; // do not log anything
        }
    } catch {
        // Not JSON, treat as normal chat
    }

    // Normal chat message
    log(`${peerNames[targetId] || targetId}: ${data}`);
}


// Create an offer to a new peer
async function createOfferTo(targetId) {
    const pc = createPeerConnection(targetId);

    const channel = pc.createDataChannel("chat-" + targetId);
    channels[targetId] = channel;

    channel.onopen = () => {
        // Send my username immediately
        channel.send(JSON.stringify({ type: "set-username", name: myName }));
    };

    channel.onmessage = (msg) => handleDataMessage(targetId, msg.data);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.send(JSON.stringify({
        type: "offer",
        target: targetId,
        sdp: pc.localDescription
    }));
}

// Receive an offer from a peer
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

    // Ensure username is sent over incoming data channel
    pc.ondatachannel = (e) => {
        const channel = e.channel;
        channels[fromId] = channel;

        channel.onopen = () => {
            channel.send(JSON.stringify({ type: "set-username", name: myName }));
        };

        channel.onmessage = (msg) => handleDataMessage(fromId, msg.data);
    };
}

// Send chat messages to all connected peers
document.getElementById("send").onclick = () => {
    const msg = document.getElementById("msg").value;
    for (const id in channels) channels[id].send(msg);
    log(`Me: ${msg}`);
};
