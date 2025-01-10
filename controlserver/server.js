var app = require('express')();

// Add Express middleware for regular HTTP endpoints
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', [
        'https://peekaview.de',
        'https://develop.peekaview.de',
        'https://app.peekaview.local',
        'http://localhost:5173'
    ].join(', '));
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
        origin: [
            "http://localhost:5173",
            "https://peekaview.de",
            "https://develop.peekaview.de",
            "https://app.peekaview.local"
        ],
        methods: ["GET", "POST", "PUT", "DELETE"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: true
    }
});

var peers = {}
var roomdb = {}
var presenters = {}
//const { createServer } = require("http");
//const { Server } = require("socket.io");

app.get('/remoteviewer', (req, res) => {
    res.sendFile(__dirname + '/display.html');
})

io.on('connection', (socket)=> {
    socket.on('join', (data) => {
        console.log("join", data, socket.id);
        const roomId = data.roomId;
        socket.join(roomId);
        console.log('User ' + socket.id + ' joined in room: ' + roomId);
        roomdb[socket.id] = roomId;
    
        peers[socket.id] = socket;
    
        if (data.role === "presenter") {
          presenters[roomId] = socket.id; // Speichert die presenter_id für den Raum
          console.log('Presenter in room ' + roomId + ': ' + socket.id);
        }
    
        // Broadcast der presenter_id an alle Teilnehmer im Raum
        const presenter_id = presenters[roomId] || null;
        io.to(roomId).emit('presenterId', presenter_id);
    
        // Senden von 'initReceive' an andere Teilnehmer
        for (let id in peers) {
          if (id === socket.id) continue;
          if (roomdb[id] === roomId) {
            console.log('sending initReceive to ' + id);
            peers[id].emit('initReceive', { socketId: socket.id, role: data.role });
          }
        }
      });

        socket.on('signal', data => {
            console.log('sending signal from ' + socket.id + ' to ' + data.socket_id)
            if(!peers[data.socket_id])return
            if(roomdb[data.socket_id] && roomdb[socket.id] && roomdb[data.socket_id] != roomdb[socket.id])return

            peers[data.socket_id].emit('signal', {
                socket_id: socket.id,
                signal: data.signal
            })
        })

        socket.on('disconnect', () => {
            const roomId = roomdb[socket.id];
            if (presenters[roomId] === socket.id) {
                // Presenter hat den Raum verlassen
                delete presenters[roomId];
                // Informiere alle Teilnehmer, dass der Presenter weg ist
                io.to(roomId).emit('presenterLeft');
            }
            else {
                io.to(roomId).emit('viewerLeft', socket.id);
            }
            
            // Rest Ihres Disconnect-Handlings
            delete peers[socket.id];
            delete roomdb[socket.id];
        });
})

var server_port = 3000;
http.listen(server_port, () => {
    console.log("Started on : "+ server_port);
})