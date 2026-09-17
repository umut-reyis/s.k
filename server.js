const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(__dirname));

const players = {};
const worldBlocks = [];

io.on('connection', (socket) => {
    // Yeni oyuncuya haritayı gönder
    socket.emit('initWorld', { players, blocks: worldBlocks });

    // Oyuncu katıldı
    socket.on('joinGame', (userData) => {
        players[socket.id] = {
            id: socket.id,
            username: userData.username || 'Oyuncu',
            x: 0, y: 0.9, z: 0,
            rotX: 0, rotY: 0
        };
        socket.broadcast.emit('playerJoined', players[socket.id]);
    });

    // Oyuncu hareketi
    socket.on('playerMove', (moveData) => {
        if (players[socket.id]) {
            Object.assign(players[socket.id], moveData);
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    // Blok koyma
    socket.on('placeBlock', (blockData) => {
        worldBlocks.push(blockData);
        io.emit('blockPlaced', blockData);
    });

    // Silah ateşleme / Ses senkronizasyonu
    socket.on('shootGun', (shootData) => {
        socket.broadcast.emit('playerShot', { playerId: socket.id, audio: shootData.audio });
    });

    // Ayrılma
    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('playerLeft', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu ${PORT} portunda aktif!`));
