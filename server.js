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

    // Oda oluşturma veya katılma
    socket.on('join_room', (data) => {
        const { roomName, playerName, customBanList } = data;
        
        socket.join(roomName);
        socket.roomName = roomName;
        socket.playerName = playerName;

        if (!rooms[roomName]) {
            rooms[roomName] = { players: [], bannedList: [] };
        }

        // Yasaklı kontrolü
        if (rooms[roomName].bannedList.includes(playerName)) {
            socket.emit('banned_from_room', { message: "Bu sunucuya girişiniz yasaklanmıştır!" });
            socket.disconnect();
            return;
        }

        rooms[roomName].players.push({ id: socket.id, name: playerName });
        io.to(roomName).emit('update_players', rooms[roomName].players);
    });

    // Admin/Host tarafından özel mesajla oyuncu yasaklama (Ban)
    socket.on('kick_or_ban_player', (data) => {
        const { targetSocketId, banReason } = data;
        const roomName = socket.roomName;

        if (!roomName || !rooms[roomName]) return;

        const targetPlayer = rooms[roomName].players.find(p => p.id === targetSocketId);
        if (targetPlayer) {
            // Yasaklı listesine ekle
            rooms[roomName].bannedList.push(targetPlayer.name);

            // Hedef oyuncuya özel yasak mesajını gönder ve bağlantısını kopar
            io.to(targetSocketId).emit('banned_from_room', { 
                message: banReason && banReason.trim() !== "" ? banReason : "Sunucudan yasaklandınız." 
            });
            
            // Sunucudakilere duyuru geç
            io.to(roomName).emit('system_announcement', `${targetPlayer.name} yasaklandı! Sebep: ${banReason}`);

            // Oyuncuyu odadan düşür
            const targetSocket = io.sockets.sockets.get(targetSocketId);
            if (targetSocket) {
                targetSocket.leave(roomName);
                targetSocket.disconnect();
            }

            // Listeden sil
            rooms[roomName].players = rooms[roomName].players.filter(p => p.id !== targetSocketId);
            io.to(roomName).emit('update_players', rooms[roomName].players);
        }
    });

    socket.on('disconnect', () => {
        const roomName = socket.roomName;
        if (roomName && rooms[roomName]) {
            rooms[roomName].players = rooms[roomName].players.filter(p => p.id !== socket.id);
            io.to(roomName).emit('update_players', rooms[roomName].players);
            
            if (rooms[roomName].players.length === 0) {
                delete rooms[roomName];
            }
        }
        console.log(`Kullanıcı ayrıldı: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda aktif!`);
});
