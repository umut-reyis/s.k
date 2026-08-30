const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

let servers = [
    { id: 101, name: "Genel Lobi 1", host: "Sistem", players: 1, max: 20, inGame: false }
];

// Odadan ayrılma mantığını ortak fonksiyon yaptık
function handlePlayerLeave(socket) {
    if (socket.data.currentServerId) {
        const srv = servers.find(s => s.id === socket.data.currentServerId);
        if (srv) {
            srv.players = Math.max(0, srv.players - 1);
            // Oda boşaldıysa ve genel lobi değilse sunucuyu tamamen sil
            if (srv.players === 0 && srv.id !== 101) {
                servers = servers.filter(s => s.id !== srv.id);
            }
            io.emit('server-list-update', servers);
        }
        socket.data.currentServerId = null;
    }
}

io.on('connection', (socket) => {
    console.log(`Bir oyuncu bağlandı: ${socket.id}`);

    socket.emit('server-list-update', servers);

    socket.on('get-servers', () => {
        socket.emit('server-list-update', servers);
    });

    socket.on('create-server', (data) => {
        const newSrv = {
            id: Date.now(),
            name: data.serverName,
            host: data.playerName,
            players: 1,
            max: 20,
            inGame: false
        };
        servers.unshift(newSrv);
        socket.join(newSrv.id);
        socket.data.currentServerId = newSrv.id;
        socket.data.playerName = data.playerName;
        
        io.emit('server-list-update', servers);
        socket.emit('server-joined', { server: newSrv, isHost: true });
    });

    socket.on('join-server', (serverId) => {
        const srv = servers.find(s => s.id === serverId);
        if (srv && !srv.inGame && srv.players < srv.max) {
            socket.join(srv.id);
            socket.data.currentServerId = srv.id;
            srv.players++;
            io.emit('server-list-update', servers);
            socket.emit('server-joined', { server: srv, isHost: false });
        } else {
            socket.emit('alert', 'Sunucu dolu veya halihazırda oyunda!');
        }
    });

    // İstemciden "Ayrıl" komutu geldiğinde tetiklenir
    socket.on('leave-server', (serverId) => {
        socket.leave(serverId);
        handlePlayerLeave(socket);
    });

    // Bağlantı koptuğunda (sayfa kapatma vb.) hayalet sunucuyu temizler
    socket.on('disconnect', () => {
        console.log(`Bir oyuncu ayrıldı: ${socket.id}`);
        handlePlayerLeave(socket);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});
