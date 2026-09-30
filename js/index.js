const express = require("express");
// const { Server } = require("socket.io");
const http = require("http");
const cors = require("cors");
const axios = require("axios");
const bodyParser = require('body-parser');
const rateLimit = require("express-rate-limit");
const app = express();
// Create a rate limiter: 100 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,                 // limit each IP to 100 requests per window
  standardHeaders: true,    // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false,     // Disable `X-RateLimit-*` headers
  message: {
    status: 429,
    error: "Too many requests, please try again later."
  },
  // Daraja posts every STK callback and B2C result from a handful of Safaricom IPs — never rate-limit those.
  // /chat/emit is likewise exempt here and metered by chatEmitLimiter instead: every chat message in the
  // shop arrives from the one API server, so a 100-per-15-minutes ceiling keyed on its IP would silence
  // chat within minutes of a busy evening starting.
  skip: (req) => req.method === "POST" && (req.path.startsWith("/mpesa/") || req.path === "/chat/emit")
});

// Generous but finite: enough for a real conversation load, low enough that a leaked SOCKETS_API_KEY cannot
// turn the relay into an open broadcast tap.
const chatEmitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.CHAT_EMIT_PER_MINUTE || 600),
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 429, error: "Too many chat relays, slow down." }
});

// Render sits behind one proxy: trust it so req.ip (rate limit key, MPESA_ALLOWED_IPS) is the real caller.
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 1));
// Apply to all requests
app.use(limiter);
app.use(cors({
    origin:["http://localhost:8081","http://localhost:3000","http://localhost:8008", "https://uko-app.co.ke","https://shop.uko-app.co.ke","eden.uko-app.co.ke"]
}));
app.use(bodyParser.json({ limit : '30000mb' }));       // to support JSON-encoded bodies

app.use( bodyParser.urlencoded({
    limit : '1000mb',// to support URL-encoded bodies
    extended : true
}));

const server = http.createServer(app);
const { configDotenv } = require('dotenv');
configDotenv()
const io = require("socket.io")(server,
{
    cors : {
        origin :["http://localhost:8081","http://localhost:3000", "https://uko-app.co.ke","https://shop.uko-app.co.ke","https://eden.uko-app.co.ke"]
    }
})

// ---------------------------------------------------------------- inbound limits on the sockets themselves
// express-rate-limit above only sees HTTP. A socket.io client pays one HTTP handshake and then holds an open
// pipe, so every event after it was unmetered: a looping tab (or a script) could emit joins or chat reads as
// fast as the event loop would take them and this process would serve every one. Two limits close that:
//   * a token bucket per socket  — a burst is fine, a sustained flood is not;
//   * a connection cap per IP    — one address cannot hold the server's file descriptors open by itself.
// Both are env-tunable because the movies/TV remote is chattier than the shop (PLAY / SLIDE / SUBTITLE while
// scrubbing), and a limit that breaks the remote would be worse than the flood it prevents.
const EVENT_BURST = Number(process.env.SOCKET_EVENT_BURST || 30)       // events a socket may fire back-to-back
const EVENT_PER_SEC = Number(process.env.SOCKET_EVENT_PER_SEC || 10)   // sustained rate the bucket refills at
const MAX_PER_IP = Number(process.env.SOCKET_MAX_CONNECTIONS_PER_IP || 20)  // 0 disables
const MAX_ROOMS = Number(process.env.SOCKET_MAX_ROOMS || 20)           // rooms one socket may hold at once
const STRIKES_ALLOWED = Number(process.env.SOCKET_STRIKES || 20)       // dropped events before the socket is cut

const connectionsPerIp = new Map()

function socketIp(socket) {
    // Render terminates TLS one hop in front, so the handshake address is the proxy; x-forwarded-for's first
    // entry is the real client. Matches app.set("trust proxy", ...) used for the HTTP limiter.
    const fwd = socket.handshake.headers["x-forwarded-for"]
    const ip = (typeof fwd === "string" && fwd.split(",")[0].trim()) || socket.handshake.address || ""
    return ip.replace(/^::ffff:/, "")
}

io.use((socket, next) => {
    const ip = socketIp(socket)
    const open = connectionsPerIp.get(ip) || 0
    if (MAX_PER_IP > 0 && open >= MAX_PER_IP) {
        console.warn(`socket refused: ${ip} already holds ${open} connections`)
        return next(new Error("Too many connections from this address"))
    }
    connectionsPerIp.set(ip, open + 1)
    socket.data.ip = ip
    socket.data.tokens = EVENT_BURST
    socket.data.refilledAt = Date.now()
    socket.data.strikes = 0
    socket.data.rooms = 0
    socket.once("disconnect", () => {
        const left = (connectionsPerIp.get(ip) || 1) - 1
        if (left > 0) connectionsPerIp.set(ip, left)
        else connectionsPerIp.delete(ip)
    })
    next()
})

/** True when this packet is within the socket's budget. Spends a token, or drops the packet and warns the
 *  client; a socket that keeps overrunning is disconnected rather than left to hammer the loop. */
function withinBudget(socket, eventName) {
    const d = socket.data
    const now = Date.now()
    d.tokens = Math.min(EVENT_BURST, d.tokens + ((now - d.refilledAt) / 1000) * EVENT_PER_SEC)
    d.refilledAt = now
    if (d.tokens >= 1) {
        d.tokens -= 1
        return true
    }
    d.strikes += 1
    socket.emit("rate-limited", { event: eventName, retry_in_ms: Math.ceil(1000 / EVENT_PER_SEC) })
    if (d.strikes >= STRIKES_ALLOWED) {
        console.warn(`socket ${socket.id} from ${d.ip} cut after ${d.strikes} dropped events`)
        socket.disconnect(true)
    }
    return false
}

/** Room cap, so a socket cannot subscribe to everything it can guess the name of. */
function canJoin(socket) {
    if (MAX_ROOMS > 0 && socket.data.rooms >= MAX_ROOMS) {
        console.warn(`socket ${socket.id} from ${socket.data.ip} refused a room: already in ${socket.data.rooms}`)
        return false
    }
    socket.data.rooms += 1
    return true
}

io.on("connection", async(socket) => {
    console.log("socketing...")
    // Every inbound event on this socket passes the token bucket first. Over budget is dropped, not queued:
    // the client is told so it can back off, and nothing downstream has to know about the limit.
    socket.use((packet, next) => {
        if (withinBudget(socket, packet[0])) next()
    })
    // let joinedRoom = []
    // let remoteRoom = []
    socket.on("user", id => {
        console.log("joining : " + id)
        // Chat rooms are off-limits here — "user" takes any name the caller invents, which is safe only
        // because an M-PESA room name carries 128 bits the payer generated. "user:<id>" is guessable, so it
        // is joined through join-chat with a signed token instead.
        if (typeof id !== "string" || CHAT_ROOM.test(id)) return
        // an M-PESA callback / payout Result that arrived before the browser joined its "<id>$<key>" room is replayed
        // straight away — already delivered, so there is no room to stay in
        const cached = mpesaResults.get(id)
        if (cached) return socket.emit(cached.event, { data: cached.data })
        if (!canJoin(socket)) return
        socket.join(id)
        // joinedRoom.push(id)
    })

    // ---- chat: join your own room, and only yours -------------------------------------------------
    // The shop API mints { room, exp, sig } for the signed-in user (GET /api/chat/socket-token) and the
    // browser presents it here. sig is HMAC-SHA256(SOCKETS_API_KEY, "<room>.<exp>") — the same secret the
    // APIs sign M-PESA webhook keys with — so the relay can tell "this user" from "anyone who can count"
    // without holding a session store or reaching back to the API on every join.
    socket.on("join-chat", (token) => {
        const { room, exp, sig } = token || {}
        if (!chatTokenValid(room, exp, sig)) {
            console.warn(`join-chat refused for ${socket.data.ip}: ${CHAT_ROOM.test(room || "") ? "bad or expired token" : "bad room"}`)
            return socket.emit("chat-denied", { room: typeof room === "string" ? room : "", reason: "invalid or expired token" })
        }
        if (socket.rooms.has(room)) return socket.emit("chat-joined", { room })
        if (!canJoin(socket)) return socket.emit("chat-denied", { room, reason: "too many rooms" })
        socket.join(room)
        socket.emit("chat-joined", { room })
    })

    socket.on("leave-chat", (room) => {
        if (typeof room !== "string" || !CHAT_ROOM.test(room) || !socket.rooms.has(room)) return
        socket.leave(room)
        socket.data.rooms = Math.max(0, socket.data.rooms - 1)
    })
    socket.on("remote-join", (token) => {
        const { room, exp, sig } = token || {}
        if (!remoteTokenValid(room, exp, sig)) {
            return socket.emit("remote-denied", { room: typeof room === "string" ? room : "", reason: "invalid or expired token" })
        }
        if (socket.rooms.has(room)) return socket.emit("remote-joined", { room })
        if (!canJoin(socket)) return socket.emit("remote-denied", { room, reason: "too many rooms" })
        socket.join(room)
        socket.emit("remote-joined", { room })
    })
    socket.on("remote", id => {
        if (!remoteLegacyOn() || !legacyRoomOk(id) || socket.rooms.has(id) || !canJoin(socket)) return
        socket.join(id)
    })
    socket.on("mobile-login", id => {
        if (!legacyRoomOk(id) || socket.rooms.has(id) || !canJoin(socket)) return
        socket.join(id)
    })
    socket.on("tv-login", (id, user) => {
        if (!legacyRoomOk(id)) return
        io.to(id).emit("user-login",user);
        if (!socket.rooms.has(id) && canJoin(socket)) socket.join(id)
    })
    socket.on("remove-mobile-login", id => {
        if (!legacyRoomOk(id)) return
        io.to(id).emit("feedback-user-login",id);
        if (socket.rooms.has(id)) {
            socket.leave(id)
            socket.data.rooms = Math.max(0, socket.data.rooms - 1)
        }
    })
    socket.on("Route", (id, route, url,state) => {
        if (!mayControl(socket, id)) return
        io.to(id).emit("Route", url,state)
    })

    for (const event of ["PLAY", "SLIDE", "SUBTITLE", "MUTE"]) {
        socket.on(event, (id, value) => {
            if (!mayControl(socket, id)) return
            io.to(id).emit(event, value)
        })
    }

    socket.on("KEY", (id, key) => {
        if (!REMOTE_ROOM.test(id || "") || !socket.rooms.has(id) || !REMOTE_KEYS.has(key)) return
        socket.to(id).emit("KEY", key)   // to the TV, not back to the phone that pressed it
    })

    socket.on("Bar", (id, route, url,state) => {
        if (!mayControl(socket, id)) return
        io.to(id).emit("Bar", {url,state})
    })
    socket.on("MovieDetail", (id, route, url,state) => {
        //the client names the event: only the old navigation names, never an arbitrary one
        if (!mayControl(socket, id) || !["MovieDetail", "Route", "Bar"].includes(route)) return
        io.to(id).emit(route, {url,state})
    })
    // socket.on("callback", (id, data) => {
    //     console.log("send to callback : " + id)
    //     io.to(id).emit("callback", data)
    // })

    socket.on("disconnecting", (room) => {
        console.log("disconnecting")
        // if (joinedRoom.length > 0) {
        //     joinedRoom.forEach(room => {
        //         console.log(`leaving room: ${room}`);
        //         socket.leave(room);
        //     })
        // }
        // if (remoteRoom.length > 0) {
        //     remoteRoom.forEach(room => {
        //         console.log(`leaving room: ${room}`);
                
        //     })
        // }
        socket.leave(room);
        // socket.emit("close-page", "you")
    })
    socket.on("disconnect",(room) => {
        console.log("disconnect...")
        // if (joinedRoom.length > 0) {
        //     joinedRoom.forEach(room => {
        //         console.log(`leaving room: ${room}`);
        //         socket.leave(room);
        //     })

        // }    
        // if (remoteRoom.length > 0) {
        //     remoteRoom.forEach(room => {
        //         console.log(`leaving room: ${room}`);
                
        //     })
        // }  
        socket.leave(room);
        // socket.emit("close-page", "hey")
    })

    socket.on("destroy",(room) => {
        // joinedRoom no longer exists (see above) — referencing it threw and crashed the process
        console.log(`leaving room: ${room}`);
        socket.leave(room);
    })
    
  });

//   {    
//     "Body": {        
//        "stkCallback": {            
//           "MerchantRequestID": "29115-34620561-1",            
//           "CheckoutRequestID": "ws_CO_191220191020363925",            
//           "ResultCode": 0,            
//           "ResultDesc": "The service request is processed successfully.",            
//           "CallbackMetadata": {                
//              "Item": [{                        
//                 "Name": "Amount",                        
//                 "Value": 1.00                    
//              },                    
//              {                        
//                 "Name": "MpesaReceiptNumber",                        
//                 "Value": "NLJ7RT61SV"                    
//              },                    
//              {                        
//                 "Name": "TransactionDate",                        
//                 "Value": 20191219102115                    
//              },                    
//              {                        
//                 "Name": "PhoneNumber",                        
//                 "Value": 254708374149                    
//              }]            
//           }        
//        }    
//     }
//  }

// ---------------------------------------------------------------- M-PESA webhooks → per-payment rooms (STK push + B2C)
// The browser makes a random key (crypto.getRandomValues), sends it to the API with the STK push / withdrawal and joins
//   "<MerchantRequestID>$<key>"                                   STK push   → event "callback"
//   "<ConversationID>$<key>" and "<OriginatorConversationID>$<key>"  B2C payout → events "results" / "timeout"
// The API gives Daraja webhook URLs ending in ?key=<key>&sig=<HMAC-SHA256(SOCKETS_API_KEY, key)>:
//   MPESA_CALLBACK_URL=<sockets>/mpesa/callback, MPESA_RESULT_URL=<sockets>/mpesa/results, MPESA_TIMEOUT_URL=<sockets>/mpesa/timeout
// Here a post whose sig does not match gets 401. The key alone proves nothing (the payer generated it); the sig is what
// stops a user posting a forged "paid" callback or "failed" payout Result. A valid payload is emitted into the room(s), the
// room is emptied, and it is cached 24 h under the same room name so a browser that joins late still gets it and the APIs can
// verify a relayed Result: GET /mpesa/results/:room (header x-sockets-key = SOCKETS_API_KEY).
// Without SOCKETS_API_KEY (local development) posts are still relayed but cached as verified: false, which the APIs never settle.
// Optional extra: MPESA_ALLOWED_IPS=comma,separated Safaricom callback IPs (see fromAllowedIp).
const crypto = require("crypto")
const RESULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const ROOM_KEY = /^[A-Za-z0-9_-]{16,128}$/
const mpesaResults = new Map() // "<id>$<key>" → { event, data, received_at, at, verified }
const allowedIps = (process.env.MPESA_ALLOWED_IPS || "").split(",").map((ip) => ip.trim()).filter(Boolean)

function sameText(given, expected) {
    if (!expected || typeof given !== "string") return false
    const a = Buffer.from(given), b = Buffer.from(expected)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function keyMatches(given) {
    return sameText(given, process.env.SOCKETS_API_KEY)
}

// ---------------------------------------------------------------- chat rooms
// "user:<id>" — one room per signed-in account, and unlike an M-PESA room the name is trivially guessable,
// so joining one takes a token the API signed. Nothing here trusts the socket's word for who it is.
const CHAT_ROOM = /^user:[0-9]{1,20}$/
// movies phone <-> TV remote: "remote:<users.id>", joined only with a token the movies user service signs
// (POST /user/remote/token/android) - same HMAC scheme as chat
const REMOTE_ROOM = /^remote:[0-9]{1,20}$/

/** A join token is good when it names a room of the right kind, has not expired, and its HMAC matches. */
function signedRoomValid(pattern, room, exp, sig) {
    const secret = process.env.SOCKETS_API_KEY
    if (!secret) return false                       // unsigned == unauthenticated; refuse rather than trust
    if (typeof room !== "string" || !pattern.test(room)) return false
    const expiry = Number(exp)
    if (!Number.isFinite(expiry) || expiry * 1000 <= Date.now()) return false
    return sameText(sig, crypto.createHmac("sha256", secret).update(`${room}.${expiry}`).digest("hex"))
}
const chatTokenValid = (room, exp, sig) => signedRoomValid(CHAT_ROOM, room, exp, sig)
const remoteTokenValid = (room, exp, sig) => signedRoomValid(REMOTE_ROOM, room, exp, sig)

// The old remote joined a room named after the user's EMAIL with no proof at all, so anyone who knew an email
// could watch and drive that user's TV - and "remote" / "mobile-login" / "tv-login" joined ANY name, including
// "user:<id>" chat rooms (skipping join-chat's token). Old app builds still use it, so it stays for the rollout
// (REMOTE_LEGACY=off turns it off once the new phone + TV apps are out), but never for a signed or M-PESA room.
const remoteLegacyOn = () => String(process.env.REMOTE_LEGACY || "on").toLowerCase() !== "off"
const legacyRoomOk = (id) => typeof id === "string" && id.length > 0 && id.length <= 320
    && !CHAT_ROOM.test(id) && !REMOTE_ROOM.test(id) && !id.includes("$")
// where the remote may send: a signed room only from a socket inside it; a legacy room while legacy is on
const mayControl = (socket, id) => REMOTE_ROOM.test(id || "") ? socket.rooms.has(id) : (remoteLegacyOn() && legacyRoomOk(id))
// the phone's D-pad / touchpad (movies PRD #12) - signed rooms only
const REMOTE_KEYS = new Set(["up", "down", "left", "right", "select", "back", "home", "playpause"])

/** { key, verified } for a correctly signed webhook URL, or { status } to refuse it. */
function checkHook(req) {
    const key = req.query.key
    if (typeof key !== "string" || !ROOM_KEY.test(key)) return { status: 400 }
    const secret = process.env.SOCKETS_API_KEY
    if (!secret) return { key, verified: false }
    const sig = crypto.createHmac("sha256", secret).update(key).digest("hex")
    return sameText(req.query.sig, sig) ? { key, verified: true } : { status: 401 }
}

function remember(rooms, event, data, verified) {
    const now = Date.now()
    for (const [room, entry] of mpesaResults) {
        if (now - entry.at > RESULT_CACHE_TTL_MS) mpesaResults.delete(room)
    }
    const entry = { event, data, received_at: new Date(now).toISOString(), at: now, verified }
    for (const room of rooms) {
        const prev = mpesaResults.get(room)
        if (prev && prev.event === "results" && event === "timeout") continue // a real result beats a late timeout
        mpesaResults.set(room, entry)
    }
}

/** Emit into the room(s), then empty them: the payment is settled, nobody needs to stay subscribed. */
function deliver(rooms, event, data) {
    io.to(rooms).emit(event, { data })
    io.in(rooms).socketsLeave(rooms)
}

function fromAllowedIp(req) {
    if (!allowedIps.length) return true
    const ip = (req.ip || req.socket.remoteAddress || "").replace(/^::ffff:/, "")
    return allowedIps.includes(ip)
}

function refuse(res, name, req, status) {
    console.warn(`mpesa ${name} refused from ${req.ip}: ${status === 401 ? "bad signature" : "missing / invalid key"}`)
    return res.status(status).json({ ResultCode: 1, ResultDesc: status === 401 ? "Unauthorized" : "Missing or invalid key" })
}

// STK push callback → "<MerchantRequestID>$<key>"
app.post("/mpesa/callback", (req, res) => {
    try {
        const hook = checkHook(req)
        if (hook.status) return refuse(res, "callback", req, hook.status)
        const cb = req.body?.Body?.stkCallback
        if (typeof cb?.MerchantRequestID !== "string" || !cb.MerchantRequestID) return res.status(400).json({ ResultCode: 1, ResultDesc: "Missing MerchantRequestID" })
        const room = `${cb.MerchantRequestID}$${hook.key}`
        remember([room], "callback", cb, hook.verified)
        deliver([room], "callback", cb)
        console.log(`stk callback → ${cb.MerchantRequestID} · ResultCode ${cb.ResultCode} ${cb.ResultDesc || ""}`)
        return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" })
    } catch (error) {
        return res.status(500).json({ ResultCode: 1, ResultDesc: error.message })
    }
});

const b2cIds = (result) => [result?.ConversationID, result?.OriginatorConversationID].filter((id) => typeof id === "string" && id.length > 0)

// B2C Result / queue timeout → "<ConversationID>$<key>" and "<OriginatorConversationID>$<key>"
function relayB2C(event) {
    return (req, res) => {
        try {
            const hook = checkHook(req)
            if (hook.status) return refuse(res, event, req, hook.status)
            // if (!fromAllowedIp(req)) {
            //     console.warn(`b2c ${event} refused from ${req.ip}`)
            //     return res.status(403).json({ ResultCode: 1, ResultDesc: "Forbidden" })
            // }
            const result = req.body?.Result || req.body?.Body?.Result
            const ids = b2cIds(result)
            if (!ids.length) return res.status(400).json({ ResultCode: 1, ResultDesc: "Missing ConversationID / OriginatorConversationID" })
            const rooms = ids.map((id) => `${id}$${hook.key}`)
            remember(rooms, event, result, hook.verified)
            deliver(rooms, event, result)
            console.log(`b2c ${event} → ${ids.join(" | ")} · ResultCode ${result.ResultCode} ${result.ResultDesc || ""}`)
            return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" })
        } catch (error) {
            return res.status(500).json({ ResultCode: 1, ResultDesc: error.message })
        }
    }
}

//after withdrawal - result (success or failure, e.g. ResultCode 2001)
app.post("/mpesa/results", relayB2C("results"));
//after withdrawal - request timed out in Daraja's queue
app.post("/mpesa/timeout", relayB2C("timeout"));

// shop / shelves / delivery API → verify a relayed Result by room "<ConversationID or OriginatorConversationID>$<key>"
app.get("/mpesa/results/:room", (req, res) => {
    if (process.env.SOCKETS_API_KEY && !keyMatches(req.get("x-sockets-key"))) return res.status(401).json({ status: false, message: "Invalid key" })
    const entry = mpesaResults.get(req.params.room)
    if (!entry || entry.event === "callback") return res.status(404).json({ status: false, message: "No result for this id yet" })
    return res.status(200).json({ status: true, event: entry.event, received_at: entry.received_at, data: entry.data, verified: entry.verified })
});
// shop API → whoever is connected. The message is already written to the database and answered to the
// sender before this is called, so a failure here costs the recipient a few seconds of latency (the fallback
// poll still picks it up) and never the message itself. Rooms are NOT emptied afterwards, unlike a payment:
// a conversation is not settled by one delivery.
app.post("/chat/emit", chatEmitLimiter, (req, res) => {
    if (!process.env.SOCKETS_API_KEY) return res.status(503).json({ status: false, message: "SOCKETS_API_KEY is not set" })
    if (!keyMatches(req.get("x-sockets-key"))) {
        console.warn(`chat emit refused from ${req.ip}: bad key`)
        return res.status(401).json({ status: false, message: "Invalid key" })
    }
    const rooms = Array.isArray(req.body?.rooms) ? req.body.rooms.filter((r) => typeof r === "string" && CHAT_ROOM.test(r)) : []
    if (!rooms.length) return res.status(400).json({ status: false, message: "rooms must hold one or more user:<id>" })
    const data = req.body?.data
    if (!data || typeof data !== "object") return res.status(400).json({ status: false, message: "data is required" })
    io.to(rooms).emit("chat", { data })
    return res.status(200).json({ status: true, rooms: rooms.length })
});

app.post("/node-test",(req,res) => {
    return res.status(200).json({data:req.body})
})

app.get("/test",(req,res) => {
    console.log("Hello $50")
    return res.status(200).json({"Hello":"Emporer"})
})
server.listen(process.env.PORT, () => {
    console.log("listening at " + process.env.PORT)
})