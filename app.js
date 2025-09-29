const express = require("express");
// const { Server } = require("socket.io");
const http = require("http");
const cors = require("cors");
const axios = require("axios");
const bodyParser = require('body-parser');
const app = express();

app.use(cors({
    origin:process.env.environment === "development" ? ["http://localhost:8081","http://localhost:3000"] : 
    [
        "https://late-developers.com",
        "https://uko-app.com",
        "https://uko.netlify.app",
        "https://uko-app.co.ke",
        "https://www.late-developers.com",
        "https://www.uko-app.com",
        "https://www.uko.netlify.app",
        "https://www.uko-app.co.ke"
    ]
}));
app.use(bodyParser.json({ limit : '30000mb' }));       // to support JSON-encoded bodies

app.use( bodyParser.urlencoded({
    limit : '1000mb',// to support URL-encoded bodies
    extended : true
}));
const allowedIPs = [
    '127.0.0.1',           // localhost
    '::1'        // example external IP
    // Add more IPs as needed
];

const liveIP = [
    "188.191.147.95",'41.90.45.219','41.90.33.6'
]
const allowedHostnames = [
    "uko-app.co.ke",
    "www.uko-app.co.ke",
    "late-developers.com",
    "uko-app.com",
    "uko.netlify.app",
    "www.late-developers.com",
    "www.uko-app.com",
    "www.uko.netlify.app"
    // Add more as needed
];
// Middleware to restrict access by IP
function ipWhitelist(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
    const hostname = req.hostname || req.headers.host;

    if(process.env.environment === "development"){
        if (allowedIPs.includes(ip)) {
            return next();
        }
    }else{
        if (liveIP.includes(ip)) {
            return next();
        }        
    }

    return res.status(403).json({ error: 'Forbidden: Your IP is not allowed.' });
}

// // Apply to all routes (or specific routes)
// app.use(ipWhitelist);

const server = http.createServer(app);
const { configDotenv } = require('dotenv');
configDotenv()
const io = require("socket.io")(server,
{
    cors : {
        origin : process.env.environment === "development" ? 
        ["http://localhost:8081","http://localhost:3000"] : 
        [
            "https://late-developers.com",
            "https://uko-app.com",
            "https://uko.netlify.app",
            "https://uko-app.co.ke",
            "https://www.late-developers.com",
            "https://www.uko-app.com",
            "https://www.uko.netlify.app",
            "https://www.uko-app.co.ke"
        ]
    }
})

io.on("connection", async(socket) => {

    let joinedRoom = []
    socket.on("user", id => {
        console.log("joining : " + id)
        socket.join(id)
        joinedRoom.push(id)
    })
    // socket.on("callback", (id, data) => {
    //     console.log("send to callback : " + id)
    //     io.to(id).emit("callback", data)
    // })

    socket.on("disconnecting", () => {
        console.log("disconnecting")
        if (joinedRoom.length > 0) {
            joinedRoom.forEach(room => {
                console.log(`leaving room: ${room}`);
                socket.leave(room);
            })

        }
        // socket.emit("close-page", "you")
    })
    socket.on("disconnect",() => {
        console.log("disconnect...")
        if (joinedRoom.length > 0) {
            joinedRoom.forEach(room => {
                console.log(`leaving room: ${room}`);
                socket.leave(room);
            })

        }      
        // socket.emit("close-page", "hey")
    })

    socket.on("destroy",(room) => {

        const index = joinedRoom.findIndex(id => room === id)
        if(index > -1){
            console.log(`leaving room: ${room}`);
            joinedRoom.splice(index,1)
            socket.leave(room);
        }
        console.log(`already left room: ${room}`);

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
        console.log("Webhook received:", req.body);
        const session = req.body.Body.stkCallback.MerchantRequestID
        // Check if the session room exists and has clients
        const room = io.sockets.adapter.rooms.get(session);
        if (room && room.size > 0) {
            // Emit data to client
            io.to(session).emit("callback", { data: req.body.Body.stkCallback });
            console.log(`Emitted callback to session: ${session}`);
            return res.status(200).json({ status: true });
        } else {
            console.log(`No clients in session room: ${session}`);
            return res.status(500).json({ status: false, message:"token null" });
        }
        
    }catch(error){
        return res.status(500).json({ status: false, message : error.message });
    }

});

app.get("/",(req,res) => {
    return res.send("Hello sockets")
})
app.post("/node-test",(req,res) => {
    return res.status(200).json({data:req.body})
})

app.get("/test",(req,res) => {
    console.log("Hello $50")
    const ip = req.ip || req.connection.remoteAddress;
    const hostname = req.hostname || req.headers.host;
    return res.status(200).json({"Hello":"Emporer",
        "IP":ip,
        "Hostname":hostname,
    })
})
  server.listen(process.env.PORT, () => {
    console.log("listening at " + process.env.PORT)
  })