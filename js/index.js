const express = require("express");
// const { Server } = require("socket.io");
const http = require("http");
const cors = require("cors");
const axios = require("axios");
const bodyParser = require('body-parser');
const app = express();
app.use(cors({
    origin:process.env.environment === "development" ? ["http://localhost:8081","http://localhost:3000"] : ["https://late-developers.com","https://sockets.late-developers.com","https://database.late-developers.com","https://uko-app.com","https://uko-sockets.onrender.com","https://uko.netlify.app","http://localhost:3000"]
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
        origin : process.env.environment === "development" ? ["http://localhost:8081","http://localhost:3000"] : ["https://late-developers.com","https://sockets.late-developers.com","https://database.late-developers.com","https://uko-app.com","https://uko.netlify.app","http://localhost:3000","https://uko-sockets.onrender.com"]
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