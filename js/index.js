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
  }
});

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