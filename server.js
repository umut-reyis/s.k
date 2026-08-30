const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

let rooms = {}; // Tüm aktif odalar

io.on('connection', (socket) => {
    console.log(`Bir oyuncu bağlandı: ${socket.id}`);

    // Sunucu Kurma
    socket.on('createServer', (data) => {
        let roomId = 'room_' + Math.random().toString(36).substring(2, 7);
        rooms[roomId] = {
            id: roomId,
            name: data.serverName,
            hostSocketId: socket.id,
            hostName: data.playerName,
            players: [{ id: socket.id, name: data.playerName, isHost: true, isAdmin: data.isAdmin, isEliminated: false, sat: false }],
            state: 'LOBBY', // LOBBY, ROTATING, STOPPED, ENDED
            chairs: [],
            round: 1,
            timer: 15
        };

        socket.join(roomId);
        socket.emit('serverCreated', { roomId, room: rooms[roomId] });
        io.emit('updateServerList', getPublicServerList());
    });

    // Sunucu Listesini İsteme
    socket.on('getServerList', () => {
        socket.emit('updateServerList', getPublicServerList());
    });

    // Sunucuya Katılma
    socket.on('joinServer', (data) => {
        let room = rooms[data.roomId];
        if (!room) {
            socket.emit('alert', 'Sunucu bulunamadı!');
            return;
        }
        if (room.state !== 'LOBBY') {
            socket.emit('alert', 'Bu sunucuda oyun çoktan başladı!');
            return;
        }
        if (room.players.length >= 20) {
            socket.emit('alert', 'Sunucu dolu!');
            return;
        }

        socket.join(data.roomId);
        room.players.push({
            id: socket.id,
            name: data.playerName,
            isHost: false,
            isAdmin: data.isAdmin,
            isEliminated: false,
            sat: false
        });

        io.to(data.roomId).emit('updateLobby', room);
        io.emit('updateServerList', getPublicServerList());
    });

    // Oda Sahibi Oyunu Başlatır
    socket.on('startMatch', (roomId) => {
        let room = rooms[roomId];
        if (room && room.hostSocketId === socket.id) {
            room.state = 'ROTATING';
            room.round = 1;
            room.players.forEach(p => { p.isEliminated = false; p.sat = false; });
            
            // Sandalyeleri oluştur (oyuncu sayısı - 1)
            generateChairs(room);
            
            io.to(roomId).emit('matchStarted', room);
            io.emit('updateServerList', getPublicServerList());

            // Müzik durma döngüsünü başlat
            startMusicTimer(room);
        }
    });

    // Oyuncu Sandalyeye Oturmaya Çalışır
    tryToSitCommmand(socket, rooms);

    // Sohbet Mesajı
    socket.on('chatMessage', (data) => {
        if (data.roomId && rooms[data.roomId]) {
            io.to(data.roomId).emit('newChat', { sender: data.sender, text: data.text, isAdmin: data.isAdmin, isHost: data.isHost });
        }
    });

    // Bağlantı Kopması
    socket.on('disconnect', () => {
        for (let roomId in rooms) {
            let room = rooms[roomId];
            let pIndex = room.players.findIndex(p => p.id === socket.id);
            if (pIndex !== -1) {
                room.players.splice(pIndex, 1);
                if (room.players.length === 0) {
                    delete rooms[roomId];
                } else {
                    if (room.hostSocketId === socket.id) {
                        room.hostSocketId = room.players[0].id;
                        room.players[0].isHost = true;
                    }
                    io.to(roomId).emit('updateLobby', room);
                }
                io.emit('updateServerList', getPublicServerList());
                break;
            }
        }
    });
});

function getPublicServerList() {
    let list = [];
    for (let id in rooms) {
        list.push({
            id: rooms[id].id,
            name: rooms[id].name,
            host: rooms[id].hostName,
            players: rooms[id].players.length,
            max: 20,
            inGame: rooms[id].state !== 'LOBBY'
        });
    }
    return list;
}

function generateChairs(room) {
    let activePlayersCount = room.players.filter(p => !p.isEliminated).length;
    let chairCount = Math.max(1, activePlayersCount - 1);
    room.chairs = [];
    const radius = 6.5;
    for (let i = 0; i < chairCount; i++) {
        const angle = (i / chairCount) * Math.PI * 2;
        room.chairs.push({
            id: i,
            x: Math.cos(angle) * radius,
            z: Math.sin(angle) * radius,
            angle: angle,
            occupiedBy: null
        });
    }
}

function startMusicTimer(room) {
    let musicDuration = Math.random() * 3 + 4; // 4 ile 7 saniye arası müzik çalar
    setTimeout(() => {
        if (!rooms[room.id] || room.state !== 'ROTATING') return;
        room.state = 'STOPPED';
        io.to(room.id).emit('musicStopped', room);

        // Oyuncuların oturması için 1.5 saniye tanı, sonra elenenleri belirle
        setTimeout(() => {
            if (!rooms[room.id] || room.state !== 'STOPPED') return;
            evaluateRound(room);
        }, 1500);

    }, musicDuration * 1000);
}

function tryToSitCommmand(socket, rooms) {
    socket.on('trySit', (roomId) => {
        let room = rooms[roomId];
        if (!room || room.state !== 'STOPPED') return;

        let player = room.players.find(p => p.id === socket.id);
        if (!player || player.isEliminated || player.sat) return;

        // En yakın boş sandalyeyi bul
        let availableChairs = room.chairs.filter(c => !c.occupiedBy);
        // Burada istemciden gelen konuma göre de eşleştirme yapılabilir, basitçe boş sandalyeyi veriyoruz:
        if (availableChairs.length > 0) {
            let chair = availableChairs[0];
            chair.occupiedBy = player.id;
            player.sat = true;
            io.to(roomId).emit('playerSatSuccess', { playerId: player.id, chairId: chair.id });
        }
    });
}

function evaluateRound(room) {
    let activePlayers = room.players.filter(p => !p.isEliminated);
    
    activePlayers.forEach(p => {
        if (!p.sat) {
            p.isEliminated = true;
        }
    });

    let remainingAlive = room.players.filter(p => !p.isEliminated);

    if (remainingAlive.length <= 1) {
        room.state = 'ENDED';
        let winner = remainingAlive[0] ? remainingAlive[0].name : "Kimse";
        io.to(room.id).emit('gameOver', { winner });
    } else {
        // Yeni tur hazırlığı
        room.state = 'WAITING_NEXT_ROUND';
        io.to(room.id).emit('roundResult', room);

        setTimeout(() => {
            if (!rooms[room.id]) return;
            room.state = 'ROTATING';
            room.players.forEach(p => p.sat = false);
            generateChairs(room);
            io.to(room.id).emit('nextRoundStarted', room);
            startMusicTimer(room);
        }, 4000);
    }
}

server.listen(3000, () => {
    console.log('Sunucu 3000 portunda çalışıyor!');
});
