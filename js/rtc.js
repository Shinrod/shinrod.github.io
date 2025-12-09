let socket;
let peerId = null;
let peers = {};      // peerId -> RTCPeerConnection
let channels = {};   // peerId -> RTCDataChannel
let room = "global";

const peerCountEl = document.getElementById("peer-count");

// Logging utility
function log(msg) {
    let li = document.createElement("li");
    li.textContent = msg;
    document.getElementById("log").appendChild(li);
}

// Update the peer counter
function updatePeerCount() {
    peerCountEl.textContent = Object.keys(peers).length;
}

// Connect to signaling server
function connect() {
    socket = new WebSocket(`wss://test-web-server-801x.onrender.com/ws/${room}`);

    socket.onmessage = async (event) => {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
            case "welcome":
                peerId = msg.peer_id;
                log(`My ID: ${peerId}`);
                break;

            case "peer-joined":
                log(`Peer joined: ${msg.peer_id}`);
                createOfferTo(msg.peer_id);
                break;

            case "peer-left":
                log(`Peer left: ${msg.peer_id}`);
                if (peers[msg.peer_id]) {
                    peers[msg.peer_id].close();
                    delete peers[msg.peer_id];
                }
                if (channels[msg.peer_id]) delete channels[msg.peer_id];
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
        channels[targetId] = e.channel;
        e.channel.onmessage = (msg) => log(`${targetId}: ${msg.data}`);
    };

    peers[targetId] = pc;
    updatePeerCount();
    return pc;
}

// Create an offer to a new peer
async function createOfferTo(targetId) {
    const pc = createPeerConnection(targetId);

    const channel = pc.createDataChannel("chat-" + targetId);
    channels[targetId] = channel;
    channel.onmessage = (msg) => log(`${targetId}: ${msg.data}`);

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
}

// Send chat messages to all connected peers
document.getElementById("send").onclick = () => {
    const msg = document.getElementById("msg").value;
    for (const id in channels) {
        channels[id].send(msg);
    }
    log(`Me: ${msg}`);
};
