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
  skip: (req) => req.method === "POST" && req.path.startsWith("/mpesa/")
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

io.on("connection", async(socket) => {
    console.log("socketing...")
    // let joinedRoom = []
    // let remoteRoom = []
    socket.on("user", id => {
        console.log("joining : " + id)
        socket.join(id)
        // a B2C result / timeout that arrived before the browser joined is replayed straight away
        const cached = b2cResults.get(id)
        if (cached) socket.emit(cached.event, { data: cached.data })
        // joinedRoom.push(id)
    })
    socket.on("remote", id => {
        console.log("joining remote : " + id)
        // socket.join(id)
        socket.join(id)
        // remoteRoom.push(id)
    })
    socket.on("mobile-login", id => {
        console.log("for mobile login : " + id)
        socket.join(id)
    })
    socket.on("tv-login", (id, user) => {
        console.log("for tv login : " + id)
        io.to(id).emit("user-login",user);
        socket.join(id)
        //login in tv
        
    })
    socket.on("remove-mobile-login", id => {
        console.log("for mobile login leave: " + id)
        io.to(id).emit("feedback-user-login",id);
        socket.leave(id)
    })
    socket.on("Route", (id, route, url,state) => {
        console.log("routing to : " + id)
        // Check room membership (Socket.IO v4)
        // const room = io.sockets.adapter.rooms.get(id);
        // console.log("Room members for", id, ":", room ? Array.from(room) : "no such room");

        // io.to(id).emit(route, {url,state})
        console.log(route,url,state);
        io.to(id).emit("Route", url,state)
    })

    socket.on("PLAY", (id, value) => {
        console.log("playing : " + id)
        io.to(id).emit("PLAY", value)
    })

    socket.on("SLIDE", (id, value) => {
        console.log("sliding : " + id)
        io.to(id).emit("SLIDE", value)
    })

    socket.on("SUBTITLE", (id, value) => {
        console.log("subtitle : " + id)
        io.to(id).emit("SUBTITLE", value)
    })

    socket.on("MUTE", (id, value) => {
        console.log("muting : " + id)
        io.to(id).emit("MUTE", value)
    })

    socket.on("Bar", (id, route, url,state) => {
        console.log("bar routing to : " + id)
        // Check room membership (Socket.IO v4)
        // const room = io.sockets.adapter.rooms.get(id);
        // console.log("Room members for", id, ":", room ? Array.from(room) : "no such room");

        // io.to(id).emit(route, {url,state})
        io.to(id).emit("Bar", {url,state})
    })
    socket.on("MovieDetail", (id, route, url,state) => {
        // console.log("bar routing to : " + id)
        // Check room membership (Socket.IO v4)
        // const room = io.sockets.adapter.rooms.get(id);
        // console.log("Room members for", id, ":", room ? Array.from(room) : "no such room");

        io.to(id).emit(route, {url,state})
        // io.to(id).emit("Bar", {url,state})
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

  // Webhook endpoint to receive external events
app.post("/mpesa/callback", (req, res) => {
    try{
    // console.log(req)
        // console.log("Webhook received:", req.body);
        const session = req.body.Body.stkCallback.MerchantRequestID
      
        // Emit data to client
        io.to(session).emit("callback", { data: req.body.Body.stkCallback });
        // io.to(req.body.Body.stkCallback.).emit("callback", { data: req.body});
      
        return res.status(200).json({ status: true });
    }catch(error){
        return res.status(500).json({ status: false, message : error.message });
    }

});
// ---------------------------------------------------------------- M-PESA B2C (wallet withdrawals)
// The shop API sends the B2C payment request with ResultURL = <sockets>/mpesa/results and QueueTimeOutURL = <sockets>/mpesa/timeout.
// Daraja posts { Result: { ConversationID, OriginatorConversationID, ResultCode, ResultDesc, TransactionID, ResultParameters, ... } }.
// Each payload is emitted ("results" / "timeout" → { data: Result }) into the rooms named after BOTH ids — the browser joins either
// with socket.emit("user", id) — and cached for 24 h so:
//   * a browser that joins after Daraja answered still gets it (replayed on "user" join above), and
//   * the shop API can verify what a browser relays: GET /mpesa/results/:id (header x-sockets-key = SOCKETS_API_KEY).
// Optional: MPESA_ALLOWED_IPS=comma,separated Safaricom callback IPs → other senders get 403.
const B2C_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const b2cResults = new Map() // ConversationID | OriginatorConversationID → { event, data, received_at }
const allowedIps = (process.env.MPESA_ALLOWED_IPS || "").split(",").map((ip) => ip.trim()).filter(Boolean)

const b2cIds = (result) => [result?.ConversationID, result?.OriginatorConversationID].filter((id) => typeof id === "string" && id.length > 0)

function rememberB2C(event, result) {
    const now = Date.now()
    for (const [id, entry] of b2cResults) {
        if (now - entry.at > B2C_CACHE_TTL_MS) b2cResults.delete(id)
    }
    const entry = { event, data: result, received_at: new Date(now).toISOString(), at: now }
    for (const id of b2cIds(result)) {
        const prev = b2cResults.get(id)
        if (prev && prev.event === "results" && event === "timeout") continue // a real result beats a late timeout
        b2cResults.set(id, entry)
    }
}

function fromAllowedIp(req) {
    if (!allowedIps.length) return true
    const ip = (req.ip || req.socket.remoteAddress || "").replace(/^::ffff:/, "")
    return allowedIps.includes(ip)
}

function relayB2C(event) {
    return (req, res) => {
        try {
            if (!fromAllowedIp(req)) {
                console.warn(`b2c ${event} refused from ${req.ip}`)
                return res.status(403).json({ ResultCode: 1, ResultDesc: "Forbidden" })
            }
            const result = req.body?.Result || req.body?.Body?.Result
            const ids = b2cIds(result)
            if (!ids.length) return res.status(400).json({ ResultCode: 1, ResultDesc: "Missing ConversationID / OriginatorConversationID" })
            rememberB2C(event, result)
            io.to(ids).emit(event, { data: result })
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

// shop API → verify a relayed result by ConversationID or OriginatorConversationID
app.get("/mpesa/results/:id", (req, res) => {
    const key = process.env.SOCKETS_API_KEY
    if (key && req.get("x-sockets-key") !== key) return res.status(401).json({ status: false, message: "Invalid key" })
    const entry = b2cResults.get(req.params.id)
    if (!entry) return res.status(404).json({ status: false, message: "No result for this id yet" })
    return res.status(200).json({ status: true, event: entry.event, received_at: entry.received_at, data: entry.data })
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