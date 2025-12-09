// Connect to FastAPI WebSocket server
let socket = new WebSocket("wss://test-web-server-801x.onrender.com/ws");

// WebRTC connection
let pc = new RTCPeerConnection({
    iceServers: [{urls: "stun:stun.l.google.com:19302"}]
});

let channel;

// Incoming DataChannel
pc.ondatachannel = e => {
    channel = e.channel;
    channel.onmessage = msg => log("Them: " + msg.data);
};

// Send ICE candidates
pc.onicecandidate = e => {
    if (e.candidate)
        socket.send(JSON.stringify({type: "candidate", candidate: e.candidate}));
};

// Receive signaling messages
socket.onmessage = async event => {
    const data = JSON.parse(event.data);

    if (data.type === "offer") {
        await pc.setRemoteDescription(data);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.send(JSON.stringify(pc.localDescription));
    }

    else if (data.type === "answer") {
        await pc.setRemoteDescription(data);
    }

    else if (data.type === "candidate") {
        if (data.candidate) {
            try {
                await pc.addIceCandidate(data.candidate);
            } catch (err) {
                console.warn("Error adding ICE candidate:", err);
            }
        }
    }
};

// Start WebRTC and send offer
document.getElementById("start").onclick = async () => {
    channel = pc.createDataChannel("chat");
    channel.onmessage = msg => log("Them: " + msg.data);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.send(JSON.stringify(pc.localDescription));
};

// Send chat messages
document.getElementById("send").onclick = () => {
    let txt = document.getElementById("msg").value;
    channel.send(txt);
    log("Me: " + txt);
};

function log(msg) {
    let li = document.createElement("li");
    li.textContent = msg;
    document.getElementById("log").appendChild(li);
}
