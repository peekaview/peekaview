var app = require('express')();

// Add Express middleware for regular HTTP endpoints
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'https://peekaview.de');
    res.header('Access-Control-Allow-Origin', 'https://*.peekaview.de'); 
    res.header('Access-Control-Allow-Origin', 'http://localhost:5173');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    next();
});

var http = require('http').createServer(app);
var io = require('socket.io')(http, {
    maxHttpBufferSize: 1e8,
    perMessageDeflate: {
        threshold: 32768
    },
    cors: {
        origin: ["http://localhost:5173", "https://*.peekaview.de", "https://peekaview.de"],
        methods: ["GET", "POST", "PUT", "DELETE"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: true
    }
});

var peers = {}
var roomdb = {}
//const { createServer } = require("http");
//const { Server } = require("socket.io");

app.get('/remoteviewer', (req, res) => {
    res.sendFile(__dirname + '/display.html');
})

io.on('connection', (socket)=> {
    socket.on("join-message", (roomId) => {
        socket.join(roomId);
        console.log("User "+socket.id+" joined in a room : " + roomId);
        roomdb[socket.id] = roomId

        peers[socket.id] = socket

        // Asking all other clients to setup the peer connection receiver
        for(let id in peers) {
            if(id === socket.id) continue
            //if(roomdb[id] && roomdb[socket.id] && roomdb[id] != roomdb[socket.id])return
            console.log('sending init receive to ' + socket.id)
            peers[id].emit('initReceive', socket.id)
        }
    })

        socket.on('signal', data => {
            console.log('sending signal from ' + socket.id + ' to ')
            if(!peers[data.socket_id])return
            if(roomdb[data.socket_id] && roomdb[socket.id] && roomdb[data.socket_id] != roomdb[socket.id])return

            peers[data.socket_id].emit('signal', {
                socket_id: socket.id,
                signal: data.signal
            })
        })


        socket.on('initSend', init_socket_id => {
            console.log('INIT SEND by ' + socket.id + ' for ' + init_socket_id)
            if(roomdb[init_socket_id] && roomdb[socket.id] && roomdb[init_socket_id] != roomdb[socket.id])return

            peers[init_socket_id].emit('initSend', socket.id)
        })

        socket.on('disconnect', () => {
            console.log('socket disconnected ' + socket.id)
            socket.broadcast.emit('removePeer', socket.id)
            delete peers[socket.id]
        })

    socket.on("screen-pause", function(data) {
        data = JSON.parse(data);
        var room = data.room;
        socket.broadcast.to(room).emit('screen-pause', data);
    })

    socket.on("reset", function(data) {
        data = JSON.parse(data);
        var room = data.room;
        socket.broadcast.to(room).emit('reset', data);
    })

    socket.on("mouse-move", function(data) {
        var room = JSON.parse(data).room;
        io.in(room).volatile.emit("mouse-move", data);
        //socket.to(room).emit("mouse-move", data);
    })

    socket.on("rectangle", function(data) {
        var room = JSON.parse(data).room;
        socket.broadcast.to(room).emit("rectangle", data);
    })

    socket.on("mouse-wheel", function(data) {
        var room = JSON.parse(data).room;
        socket.broadcast.to(room).emit("mouse-wheel", data);
    })

    socket.on("mouse-click", function(data) {
        var room = JSON.parse(data).room;
        socket.broadcast.to(room).emit("mouse-click", data);
    })

    socket.on("mouse-down", function(data) {
        var room = JSON.parse(data).room;
        //socket.broadcast.to(room).emit("mouse-down", data);
        io.in(room).volatile.emit("mouse-down", data);
    })

    socket.on("mouse-leftclick", function(data) {
        var room = JSON.parse(data).room;
        io.in(room).emit("mouse-leftclick", data);
    })

    socket.on("mouse-dblclick", function(data) {
        var room = JSON.parse(data).room;
        socket.broadcast.to(room).emit("mouse-dblclick", data);
    })

    socket.on("mouse-up", function(data) {
        var room = JSON.parse(data).room;
        //socket.broadcast.to(room).emit("mouse-up", data);
        io.in(room).volatile.emit("mouse-up", data);
    })

    socket.on("electroncmd", function(data) {
        var electronsession = JSON.parse(data).electronsession;
        socket.broadcast.to(electronsession).emit("electroncmd", data);
    })

    socket.on("type", function(data) {
        var room = JSON.parse(data).room;
        socket.broadcast.to(room).emit("type", data);
    })

    socket.on("copy", function(data) {
        var room = JSON.parse(data).room;
        socket.broadcast.to(room).emit("copy", data);
    })

    socket.on("paste", function(data) {
        var room = JSON.parse(data).room;
        socket.broadcast.to(room).emit("paste", data);
    })

    socket.on("pastefile", function(data) {
        var room = JSON.parse(data).room;
        //socket.broadcast.to(room).emit("pastefile", data);
        io.in(room).emit("pastefile", data);
    })

    socket.on("cut", function(data) {
        var room = JSON.parse(data).room;
        socket.broadcast.to(room).emit("cut", data);
    })

    socket.on("getclipboard", function(data) {
        console.log(data);
        var obj = JSON.parse(data);
        socket.to(obj.socketid).emit("getclipboard", data);
    })


})

var server_port = 3000;
http.listen(server_port, () => {
    console.log("Started on : "+ server_port);
})