const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let rooms = {};

io.on('connection', (socket) => {
    console.log(`Bir kullanıcı bağlandı: ${socket.id}`);

    // Sunucu/Oda Listesini Gönder
    socket.on('get_rooms', () => {
        const roomList = Object.keys(rooms).map(roomName => ({
            roomName,
            host: rooms[roomName].host,
            playerCount: rooms[roomName].players.length
        }));
        socket.emit('room_list', roomList);
    });

    // Oda Oluşturma
    socket.on('create_room', (data) => {
        const { roomName, playerName } = data;
        
        // Eğer aynı isimde oda varsa öncekini temizle veya reddet
        if (rooms[roomName]) {
            delete rooms[roomName];
        }

        socket.join(roomName);
        socket.roomName = roomName;
        socket.playerName = playerName;

        rooms[roomName] = {
            host: playerName,
            players: [{ id: socket.id, name: playerName }],
            bannedList: []
        };

        io.emit('room_list_update', Object.keys(rooms).map(r => ({
            roomName: r,
            host: rooms[r].host,
            playerCount: rooms[r].players.length
        })));

        socket.emit('room_joined', { roomName });
    });

    // Odaya Katılma
    socket.on('join_room', (data) => {
        const { roomName, playerName } = data;
        
        if (!rooms[roomName]) {
            socket.emit('error_message', "Oda bulunamadı!");
            return;
        }

        if (rooms[roomName].bannedList.includes(playerName)) {
            socket.emit('banned_from_room', { message: "Bu sunucuya girişiniz yasaklanmıştır!" });
            return;
        }

        socket.join(roomName);
        socket.roomName = roomName;
        socket.playerName = playerName;

        rooms[roomName].players.push({ id: socket.id, name: playerName });
        
        io.to(roomName).emit('update_players', rooms[roomName].players);
        io.emit('room_list_update', Object.keys(rooms).map(r => ({
            roomName: r,
            host: rooms[r].host,
            playerCount: rooms[r].players.length
        })));
    });

    // Oyuncu Çıkışı veya Bağlantı Kopması
    socket.on('disconnect', () => {
        const roomName = socket.roomName;
        if (roomName && rooms[roomName]) {
            rooms[roomName].players = rooms[roomName].players.filter(p => p.id !== socket.id);
            
            if (rooms[roomName].players.length === 0) {
                delete rooms[roomName];
            } else {
                io.to(roomName).emit('update_players', rooms[roomName].players);
            }

            io.emit('room_list_update', Object.keys(rooms).map(r => ({
                roomName: r,
                host: rooms[r].host,
                playerCount: rooms[r].players.length
            })));
        }
        console.log(`Kullanıcı ayrıldı: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda aktif!`);
});
